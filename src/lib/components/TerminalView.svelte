<script lang="ts">
  // One tab's real, live shell — a proper terminal emulator (xterm.js, the
  // same engine VS Code/Hyper/Theia use: correct ANSI/color handling and a
  // lightweight DOM renderer, not something hand-rolled). Mounted once per
  // terminalId the user has actually looked at (TerminalPanel.svelte decides
  // when) and then kept alive — hidden via CSS, never destroyed — for as
  // long as the tab exists, so switching tabs/panes is instant and a
  // backgrounded tab keeps receiving output instead of losing it.
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { SearchAddon, type ISearchResultChangeEvent } from "@xterm/addon-search";
  import { Unicode11Addon } from "@xterm/addon-unicode11";
  import { ClipboardAddon } from "@xterm/addon-clipboard";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import { readClipboard, writeClipboard } from "../platform";
  import { app } from "../state.svelte";
  import { terminalAttach, terminalInput, terminalOpen, terminalResize } from "../ipc";
  import { subscribeTerminal } from "../terminalBus";
  import { deriveTerminalTheme, TERMINAL_THEME_PRESETS, type TerminalColorTheme } from "../theme";
  import { attachShellIntegration, type ShellIntegration } from "../terminalShellIntegration";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import FindBar from "./FindBar.svelte";

  let {
    sessionId,
    terminalId,
    fresh,
    onopened,
    visible,
  }: {
    sessionId: string;
    terminalId: string;
    /** True for a tab this client just minted (the "+ New Tab" path — sends
     * terminal_open); false for one discovered via terminal_list, possibly
     * opened by another peer (sends terminal_attach instead). Only read at
     * mount time. */
    fresh: boolean;
    /** Called once terminal_open has gone out for a `fresh` tab. */
    onopened?: () => void;
    visible: boolean;
  } = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let webglAddon: WebglAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let unsubscribe: (() => void) | null = null;
  let shellIntegration: ShellIntegration | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentCols = 0;
  let lastSentRows = 0;

  // Ctrl/Cmd+F find bar (FindBar.svelte) — the search addon itself has no
  // UI. Decorations (highlighting every match, not just the active one) are
  // what makes onDidChangeResults actually fire — see SEARCH_DECORATIONS.
  let findOpen = $state(false);
  let findQuery = $state("");
  let findInputEl = $state<HTMLInputElement | null>(null);
  let findMatchIndex = $state(-1);
  let findMatchCount = $state(0);

  const SEARCH_DECORATIONS = {
    matchBackground: "#ffd54f",
    matchBorder: "#ffb300",
    matchOverviewRuler: "#ffd54f",
    activeMatchBackground: "#ff7043",
    activeMatchBorder: "#ff5722",
    activeMatchColorOverviewRuler: "#ff7043",
  };

  function openFind() {
    findOpen = true;
    requestAnimationFrame(() => findInputEl?.focus());
  }
  function closeFind() {
    findOpen = false;
    searchAddon?.clearDecorations();
    findMatchIndex = -1;
    findMatchCount = 0;
    term?.focus();
  }
  function findNext() {
    if (findQuery) searchAddon?.findNext(findQuery, { decorations: SEARCH_DECORATIONS, incremental: true });
  }
  function findPrevious() {
    if (findQuery) searchAddon?.findPrevious(findQuery, { decorations: SEARCH_DECORATIONS });
  }

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function currentTheme(): TerminalColorTheme {
    if (app.settings.terminalUseAppTheme) return deriveTerminalTheme(app.settings.accent, app.resolvedTheme);
    const preset = TERMINAL_THEME_PRESETS.find((p) => p.id === app.settings.terminalColorTheme);
    return preset?.colors ?? deriveTerminalTheme(app.settings.accent, app.resolvedTheme);
  }

  // A thunk, so `disabled` reads the selection when the menu opens.
  function menuItems(): ContextMenuItem[] {
    return [
      {
        label: "Copy",
        icon: "copy",
        disabled: !term?.hasSelection(),
        onSelect: () => {
          const sel = term?.getSelection();
          if (sel) void writeClipboard(sel);
        },
      },
      {
        label: "Paste",
        icon: "clipboard-list",
        onSelect: async () => {
          const cid = app.activeConnectionId;
          const text = await readClipboard();
          if (cid && text) terminalInput(cid, sessionId, terminalId, new TextEncoder().encode(text));
        },
      },
      { label: "Select All", icon: "square", onSelect: () => term?.selectAll() },
      {
        label: "Clear Scrollback",
        icon: "trash",
        onSelect: () => term?.clear(),
      },
    ];
  }

  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const connectionId = app.activeConnectionId;
      if (!term || !fitAddon || !connectionId) return;
      fitAddon.fit();
      const { cols, rows } = term;
      if (cols === lastSentCols && rows === lastSentRows) return;
      lastSentCols = cols;
      lastSentRows = rows;
      terminalResize(connectionId, sessionId, terminalId, cols, rows);
    }, 120);
  }

  onMount(() => {
    const connectionId = app.activeConnectionId;
    if (!containerEl || !connectionId) return;

    term = new Terminal({
      fontFamily: cssVar("--code-font-family"),
      fontSize: parseFloat(cssVar("--code-font-size")) || 12.5,
      cursorBlink: true,
      scrollback: 5000,
      theme: currentTheme(),
      // registerMarker/registerDecoration (terminalShellIntegration.ts's
      // command gutter marks) are still proposed xterm.js API — VS Code's
      // own xtermTerminal.ts sets this same flag for the same reason.
      allowProposedApi: true,
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // Wide-char/emoji column width (CJK, combining marks) — no UI, just
    // correct cell measurement.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";

    // OSC 52 clipboard read/write, so a remote tmux/vim inside the terminal
    // can sync with the real system clipboard.
    term.loadAddon(new ClipboardAddon());

    searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddon.onDidChangeResults((e: ISearchResultChangeEvent) => {
      findMatchIndex = e.resultIndex;
      findMatchCount = e.resultCount;
    });

    // GPU-accelerated renderer where available; a software/sandboxed WebGL
    // context can fail to create or die mid-session (onContextLoss), in
    // which case we drop it and fall back to xterm's default DOM renderer
    // rather than leaving the terminal blank.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        webglAddon = null;
      });
      term.loadAddon(webgl);
      webglAddon = webgl;
    } catch {
      webglAddon = null;
    }

    term.open(containerEl);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      // stopPropagation on every branch we intercept here — returning
      // `false` only tells xterm itself not to handle the key, the raw
      // DOM event still bubbles otherwise, which would also trigger
      // ChatPanel's own Ctrl+F (find-in-chat) at the same time as this one.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.stopPropagation();
        openFind();
        return false;
      }
      // VS Code's own bindings for jumping between shell-integration command
      // boundaries (a no-op until at least one OSC 633;D has fired).
      if (e.altKey && e.key === "ArrowUp") {
        e.stopPropagation();
        shellIntegration?.goToPreviousCommand();
        return false;
      }
      if (e.altKey && e.key === "ArrowDown") {
        e.stopPropagation();
        shellIntegration?.goToNextCommand();
        return false;
      }
      return true;
    });

    term.onData((data) => {
      const cid = app.activeConnectionId;
      if (cid) terminalInput(cid, sessionId, terminalId, new TextEncoder().encode(data));
    });

    // The shell's own OSC 0/2 "set title" (a well-behaved prompt, or a
    // fullscreen program like vim/htop) — requirement 3's "latest command
    // name". Falls back to the tab's shell-binary `label` until one arrives.
    term.onTitleChange((title) => {
      const server = app.active;
      const tab = server?.terminalById[terminalId];
      if (server && tab) {
        server.terminalById = { ...server.terminalById, [terminalId]: { ...tab, title: title || undefined } };
      }
    });

    // Registered before the snapshot/chunk subscription below so OSC 633
    // markers in replayed history (not just live output) are picked up too
    // — the snapshot's `history` bytes are the same raw stream a live
    // terminal_output chunk is, shell-integration sequences included.
    shellIntegration = attachShellIntegration(term, (cwd) => {
      const server = app.active;
      const tab = server?.terminalById[terminalId];
      if (server && tab && tab.cwd !== cwd) {
        server.terminalById = { ...server.terminalById, [terminalId]: { ...tab, cwd } };
      }
    });

    // Subscribed before the open/attach request goes out, so the snapshot
    // that request triggers can never be missed (terminalBus.ts).
    unsubscribe = subscribeTerminal(terminalId, (msg) => {
      if (!term) return;
      if (msg.kind === "snapshot") term.reset();
      term.write(msg.bytes);
    });

    // One frame so the container has a committed layout box before fit()
    // measures it — otherwise a tab created while its pane is still 0×0
    // opens the pty at the wrong size.
    requestAnimationFrame(() => {
      if (!term || !fitAddon) return;
      fitAddon.fit();
      const cols = term.cols || 80;
      const rows = term.rows || 24;
      lastSentCols = cols;
      lastSentRows = rows;
      if (fresh) {
        app.active?.registerTerminalTab(sessionId, terminalId);
        terminalOpen(connectionId, sessionId, terminalId, { cols, rows });
        onopened?.();
      } else {
        terminalAttach(connectionId, sessionId, terminalId, cols, rows);
      }
      resizeObserver = new ResizeObserver(scheduleResize);
      if (containerEl) resizeObserver.observe(containerEl);
    });
  });

  onDestroy(() => {
    unsubscribe?.();
    resizeObserver?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    shellIntegration?.dispose();
    term?.dispose();
  });

  // Settings > Appearance > Terminal can change the accent/scheme/preset/
  // switch live — keep the terminal's own palette in step rather than only
  // picking it up on the next tab open. Also drives --term-bg (below), so
  // the fractional leftover strip xterm leaves when the pane's pixel size
  // isn't an exact multiple of the cell grid reads as this theme's own
  // background instead of a mismatched black rectangle.
  $effect(() => {
    void app.settings.accent;
    void app.resolvedTheme;
    void app.settings.terminalUseAppTheme;
    void app.settings.terminalColorTheme;
    const theme = currentTheme();
    if (term) term.options.theme = theme;
    containerEl?.style.setProperty("--term-bg", theme.background);
  });

  $effect(() => {
    if (term) term.options.smoothScrollDuration = app.settings.terminalSmoothScroll ? 125 : 0;
  });

  $effect(() => {
    if (visible) scheduleResize();
  });
</script>

<ContextMenu items={menuItems}>
  <div
    class="terminal-view"
    class:hidden={!visible}
    style="padding: {app.settings.terminalMarginY}px {app.settings.terminalMarginX}px"
    bind:this={containerEl}
  >
    {#if findOpen}
      <FindBar
        bind:query={findQuery}
        bind:inputEl={findInputEl}
        matchIndex={findMatchIndex}
        matchCount={findMatchCount}
        onInput={findNext}
        onNext={findNext}
        onPrevious={findPrevious}
        onClose={closeFind}
      />
    {/if}
  </div>
</ContextMenu>

<style>
  .terminal-view {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    /* padding set inline (Settings > Appearance > Terminal margins) */
    overflow: hidden;
    /* --term-bg is kept in step with the active terminal color theme (see
       the $effect above) — this container's own background matters because
       .xterm/.xterm-viewport/.xterm-screen below aren't guaranteed to cover
       every pixel of it (see next comment). */
    background: var(--term-bg, var(--panel-bg));
  }
  .terminal-view.hidden {
    display: none;
  }
  /* xterm.js's own stylesheet sizes .xterm to its content — this makes it
     fill the pane instead, so fitAddon's measurement matches what's actually
     on screen. When the pane's pixel size isn't an exact multiple of the
     cell grid, xterm only paints whole cells, leaving a fractional strip at
     the right/bottom edge — without this, that strip is xterm.css's own
     default (black) instead of this theme's background. */
  .terminal-view :global(.xterm),
  .terminal-view :global(.xterm-viewport),
  .terminal-view :global(.xterm-screen) {
    height: 100%;
    background: var(--term-bg, var(--panel-bg));
  }
</style>

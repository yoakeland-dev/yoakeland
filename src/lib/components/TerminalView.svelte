<script lang="ts">
  // One tab's live shell via xterm.js. Mounted once per terminalId (TerminalPanel.svelte
  // decides when) then kept alive, hidden via CSS, never destroyed for the tab's lifetime,
  // so switching tabs/panes is instant and a backgrounded tab keeps receiving output.
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
  import { matches } from "../keybinds.svelte";

  let { sessionId, terminalId, visible }: { sessionId: string; terminalId: string; visible: boolean } = $props();

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
  // Last output sequence written (§3.2); -1 until the first snapshot.
  let lastSeq = -1;

  const server = $derived(app.active);
  const tab = $derived(server?.terminalById[terminalId]);

  // FindBar.svelte's UI; the search addon has none of its own. Decorations (highlighting
  // every match) are what makes onDidChangeResults actually fire, see SEARCH_DECORATIONS.
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

  // For TerminalPanel's toolbar, via bind:this.
  export function focus() {
    term?.focus();
  }
  export function clear() {
    term?.clear();
  }
  export function openFind() {
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
          paste(await readClipboard());
        },
      },
      { label: "Select All", icon: "square", onSelect: () => term?.selectAll() },
      {
        label: "Clear Scrollback",
        icon: "clear-all",
        onSelect: () => term?.clear(),
      },
      { label: "Find", icon: "search", onSelect: openFind },
    ];
  }

  function paste(text: string) {
    const cid = app.activeConnectionId;
    if (cid && text) terminalInput(cid, sessionId, terminalId, new TextEncoder().encode(text));
  }

  function attach(restartIfExited = false) {
    const cid = app.activeConnectionId;
    if (!term || !cid) return;
    terminalAttach(cid, sessionId, terminalId, term.cols || 80, term.rows || 24, restartIfExited);
  }

  function writeExitBanner() {
    const code = server?.terminalById[terminalId]?.exitCode ?? 0;
    term?.write(`\r\n\x1b[2m[process exited with code ${code}, press Enter to restart]\x1b[0m\r\n`);
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
      // registerMarker/registerDecoration (terminalShellIntegration.ts's gutter marks) are
      // still proposed xterm.js API; VS Code sets this same flag for the same reason.
      allowProposedApi: true,
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // Wide-char/emoji column width (CJK, combining marks): no UI, just
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

    // A sandboxed WebGL context can fail to create or die mid-session (onContextLoss); drop
    // it and fall back to xterm's default DOM renderer rather than leaving the terminal blank.
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
      // stopPropagation on every branch here: returning `false` only tells xterm not to
      // handle the key, the raw DOM event still bubbles and would also trigger ChatPanel's
      // own Ctrl+F.
      // Ctrl+Shift+C/V, like every Linux terminal: plain Ctrl+C/V belong to the shell.
      if (matches(e, "terminal.copy")) {
        e.stopPropagation();
        e.preventDefault();
        const sel = term?.getSelection();
        if (sel) void writeClipboard(sel);
        return false;
      }
      if (matches(e, "terminal.paste")) {
        e.stopPropagation();
        e.preventDefault();
        void readClipboard().then(paste);
        return false;
      }
      if (matches(e, "terminal.find")) {
        e.stopPropagation();
        openFind();
        return false;
      }
      // VS Code's own bindings for jumping between shell-integration command
      // boundaries (a no-op until at least one OSC 633;D has fired).
      if (matches(e, "terminal.prevCommand")) {
        e.stopPropagation();
        shellIntegration?.goToPreviousCommand();
        return false;
      }
      if (matches(e, "terminal.nextCommand")) {
        e.stopPropagation();
        shellIntegration?.goToNextCommand();
        return false;
      }
      return true;
    });

    term.onData((data) => {
      // An exited shell takes no input; Enter respawns it (the banner writeExitBanner prints).
      if (server?.terminalById[terminalId]?.status === "exited") {
        if (data === "\r") attach(true);
        return;
      }
      paste(data);
    });

    // Registered before the snapshot/chunk subscription below so OSC 633 markers in replayed
    // history are picked up too, not just live output. Title/cwd/busy are state.svelte.ts's job.
    shellIntegration = attachShellIntegration(term);

    // Subscribed before the open/attach request goes out, so the snapshot
    // that request triggers can never be missed (terminalBus.ts).
    unsubscribe = subscribeTerminal(terminalId, (msg) => {
      if (!term) return;
      if (msg.kind === "snapshot") {
        term.reset();
        term.write(msg.bytes);
        lastSeq = msg.sequence;
        if (server?.terminalById[terminalId]?.status === "exited") writeExitBanner();
        return;
      }
      if (lastSeq >= 0) {
        // The server may resend a chunk the snapshot already had; a gap means this
        // connection was dropped from the fan-out, and only a fresh snapshot recovers it.
        if (msg.sequence <= lastSeq) return;
        if (msg.sequence > lastSeq + 1) return attach();
      }
      lastSeq = msg.sequence;
      term.write(msg.bytes);
    });

    // One frame so the container has a committed layout box before fit() measures it,
    // otherwise a tab created while its pane is still 0x0 opens the pty at the wrong size.
    requestAnimationFrame(() => {
      if (!term || !fitAddon) return;
      fitAddon.fit();
      const cols = term.cols || 80;
      const rows = term.rows || 24;
      lastSentCols = cols;
      lastSentRows = rows;
      // Minted by this client (ServerState.newTerminal): open it, and focus it since a person
      // just asked for it. Anything else already exists server-side, possibly from another peer.
      if (server?.freshTerminals.has(terminalId)) {
        const cwd = server.freshTerminals.get(terminalId);
        server.freshTerminals.delete(terminalId);
        terminalOpen(connectionId, sessionId, terminalId, { cols, rows, cwd });
        term.focus();
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

  // Keeps the palette in step with live theme changes rather than only on next tab open.
  // Also drives --term-bg, so xterm's fractional leftover strip (pane size not an exact
  // multiple of the cell grid) reads as this theme's background, not a mismatched black rectangle.
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

  // Fit locally right away so a terminal shown after being hidden doesn't flash at its stale
  // size; telling the pty is still debounced.
  $effect(() => {
    if (!visible) return;
    requestAnimationFrame(() => fitAddon?.fit());
    scheduleResize();
  });

  // A reconnect is a new server-side stream with nothing attached; this xterm would sit dead.
  let wasConnected = true;
  $effect(() => {
    const connected = server?.connectionStatus === "connected";
    if (connected && !wasConnected) attach();
    wasConnected = connected;
  });

  let prevStatus: string | undefined;
  $effect(() => {
    const status = tab?.status;
    if (status === "exited" && prevStatus && prevStatus !== "exited") writeExitBanner();
    prevStatus = status;
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
    /* This background matters because .xterm/.xterm-viewport/.xterm-screen below aren't
       guaranteed to cover every pixel of it (see next comment). */
    background: var(--term-bg, var(--panel-bg));
  }
  .terminal-view.hidden {
    display: none;
  }
  /* xterm.js's own stylesheet sizes .xterm to its content; this fills the pane instead, so
     fitAddon's measurement matches the screen, and the fractional leftover strip (when pane
     size isn't a multiple of the cell grid) uses this theme's background, not xterm.css's default black. */
  .terminal-view :global(.xterm),
  .terminal-view :global(.xterm-viewport),
  .terminal-view :global(.xterm-screen) {
    height: 100%;
    background: var(--term-bg, var(--panel-bg));
  }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app, RIGHT_SIDEBAR_MIN_WIDTH, TERMINAL_MIN_HEIGHT } from "$lib/state.svelte";
  import { isDesktop } from "$lib/platform";
  import { wireEvents, autoConnect } from "$lib/ipc";
  import ConnectScreen from "$lib/components/ConnectScreen.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import RightSidebar from "$lib/components/RightSidebar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import DirectoryBrowser from "$lib/components/DirectoryBrowser.svelte";
  import SnapshotDialog from "$lib/components/SnapshotDialog.svelte";
  import FirstServerPanel from "$lib/components/FirstServerPanel.svelte";
  import Icon from "$lib/components/Icon.svelte";

  // Window chrome lives here instead of a dedicated title bar row, as floating
  // pieces over whatever surface is beneath them (see the layout tokens in
  // app.css):
  //   - the sidebar toggle, its own button pinned top-left;
  //   - the right island, pinned top-right, holding every control that isn't
  //     about *this chat*: the terminal and right-panel toggles, then the
  //     minimize/maximize/close buttons on desktop.
  // The third piece, the chat island (previous/next chat + the chat's title),
  // belongs to the chat panel rather than the window, so it lives in
  // ChatHeader.svelte.
  const win = isDesktop ? getCurrentWindow() : null;

  // Whichever chat is the rightmost visible surface owns the floating right
  // island — the linked/side chat when it's actually shown, the main chat
  // otherwise (including while the side chat is collapsed, since it's then
  // slid off-screen rather than genuinely visible). Every other chat renders
  // its own local island instead (ChatPanel.svelte's `.local-island`). Note
  // this island's two buttons (terminal, chat sidebar) are always about
  // *whichever chat owns them* — not about the linked-chat/split-view feature
  // itself, which is a separate thing entirely (ServerState.sidebarSessionId,
  // opened via a session row's "open in side panel" button, closed via the
  // linked chat's own header). `linkedVisible` here only decides which chat
  // is rightmost, nothing about the split-view pairing's own lifecycle.
  const linkedVisible = $derived(
    !!app.active?.sidebarSessionId && !app.rightSidebarCollapsed,
  );
  const chromeSessionId = $derived(
    linkedVisible ? app.active!.sidebarSessionId! : app.active?.currentSessionId,
  );

  // The corner handle where the right sidebar's own terminal drawer meets
  // that sidebar's resize handle — bottom-left of the sidebar, once its
  // terminal is open. Like VSCode's Panel/Auxiliary-bar corner, dragging it
  // changes both the sidebar's width and the terminal's height at once. Only
  // makes sense when both are actually open; otherwise there's no
  // intersection to grab.
  let rightPanelEl = $state<HTMLElement | null>(null);
  let contentRowEl = $state<HTMLDivElement | null>(null);
  let cornerDragging = $state(false);
  let cornerPos = $state({ top: 0, left: 0 });

  const cornerVisible = $derived(
    linkedVisible &&
      !!app.active?.sidebarSessionId &&
      !!app.active.terminalOpenBySession[app.active.sidebarSessionId],
  );

  // Mirrors TerminalPanel.svelte's own clamp(min, ratio, 50%) math against
  // its real containing block (this specific ChatPanel's box), so the corner
  // lands exactly on the two lines it's meant to sit between — no CSS var
  // plumbing across component boundaries needed for a single handle. The
  // sidebar's own left edge doubles as the x position directly: its `.panel`
  // has no left margin, so it's already flush with `.right-slot`'s left
  // edge, which is the same line RightSidebar.svelte's own handle sits on.
  function measureCorner() {
    if (!rightPanelEl || !contentRowEl) return;
    const panelRect = rightPanelEl.getBoundingClientRect();
    const rowRect = contentRowEl.getBoundingClientRect();
    const termHeight = Math.min(
      panelRect.height * 0.5,
      Math.max(TERMINAL_MIN_HEIGHT, app.terminalHeightRatio * panelRect.height),
    );
    cornerPos = {
      left: panelRect.left - rowRect.left,
      top: panelRect.top - rowRect.top + panelRect.height - termHeight,
    };
  }

  // Live-updates while either ratio changes (dragging either panel's own
  // handle, or this corner's).
  $effect(() => {
    app.terminalHeightRatio;
    app.rightSidebarRatio;
    cornerVisible;
    measureCorner();
  });

  // Catches everything a ratio change doesn't: window resizes, left-sidebar
  // resizes/collapses — anything that reflows .content-row or the panel
  // without touching either ratio.
  $effect(() => {
    if (!contentRowEl || !rightPanelEl) return;
    const ro = new ResizeObserver(measureCorner);
    ro.observe(contentRowEl);
    ro.observe(rightPanelEl);
    return () => ro.disconnect();
  });

  function startCornerResize(e: PointerEvent) {
    cornerDragging = true;
    app.rightSidebarResizing = true;
    app.terminalResizing = true;
    document.body.style.cursor = "nwse-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onCornerResize(e: PointerEvent) {
    if (!cornerDragging || !rightPanelEl || !contentRowEl) return;
    const rowRect = contentRowEl.getBoundingClientRect();
    const fromRight = Math.min(rowRect.width * 0.5, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, rowRect.right - e.clientX));
    app.rightSidebarRatio = Math.min(0.5, Math.max(0, fromRight / rowRect.width));

    const panelRect = rightPanelEl.getBoundingClientRect();
    const fromBottom = Math.min(panelRect.height * 0.5, Math.max(TERMINAL_MIN_HEIGHT, panelRect.bottom - e.clientY));
    app.terminalHeightRatio = Math.min(0.5, Math.max(0, fromBottom / panelRect.height));
  }
  function stopCornerResize() {
    if (!cornerDragging) return;
    cornerDragging = false;
    app.rightSidebarResizing = false;
    app.terminalResizing = false;
    document.body.style.cursor = "";
    app.setRightSidebarRatio(app.rightSidebarRatio);
    app.setTerminalHeightRatio(app.terminalHeightRatio);
  }
  function cornerHoverStart() {
    if (cornerDragging) return;
    app.rightSidebarResizing = true;
    app.terminalResizing = true;
  }
  function cornerHoverEnd() {
    if (cornerDragging) return;
    app.rightSidebarResizing = false;
    app.terminalResizing = false;
  }

  // Lets app.css pick the right --chrome-island-w / --chrome-reserve: the window
  // buttons join the right island only in the Tauri shell, and no media query can
  // tell us that. Presence-based rather than ="true", since that's how the rest
  // of the app's Tauri-only markup is keyed too (see the data-tauri-drag-region
  // note in ChatHeader). Same idiom as the `data-surface` attribute applySettings
  // sets for the frosted switch.
  //
  // At module scope, not in onMount: onMount runs after the first render, and on
  // desktop the header would then lay out one frame at the narrower (no window
  // buttons) reserve and visibly jump. This file is client-only (ssr is off in
  // +layout.ts), so there's no server pass to worry about.
  document.documentElement.toggleAttribute("data-window-chrome", isDesktop);

  onMount(() => {
    wireEvents();
    app.applySettings();
    void autoConnect();

    // "System" theme (Settings > Appearance) tracks this live instead of only
    // resolving once at startup.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => {
      if (app.settings.theme === "system") app.applySettings();
    };
    media.addEventListener("change", onSchemeChange);
    return () => media.removeEventListener("change", onSchemeChange);
  });

  // There's always a session to show — no empty placeholder screen. Before a
  // project is picked (or right after switching one, which clears the
  // current session — see selectProject in ipc.ts) this hands the chat view
  // a fresh session immediately; the composer disables sending until a
  // project is actually bound (PromptInput's projectPath check).
  $effect(() => {
    if (app.active && !app.active.currentSessionId) app.active.ensureCurrentSession();
  });
</script>

<div class="shell">
  <button
    class="chrome-surface sidebar-toggle"
    title={app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
    aria-label={app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
    onclick={() => app.toggleSidebar()}
  >
    <Icon
      name={app.sidebarCollapsed
        ? "sidebar-left-expand"
        : "sidebar-left-collapse"}
      size={14}
    />
  </button>
  {#if app.active?.currentSessionId || win}
    <div class="chrome-surface right-island" data-tauri-drag-region>
      {#if chromeSessionId}
        <button
          class="chrome-btn"
          class:active={app.active?.terminalOpenBySession[chromeSessionId]}
          title={app.active?.terminalOpenBySession[chromeSessionId] ? "Hide terminal" : "Show terminal"}
          aria-label={app.active?.terminalOpenBySession[chromeSessionId] ? "Hide terminal" : "Show terminal"}
          onclick={() => app.active?.toggleTerminal(chromeSessionId)}
        >
          <Icon name="terminal-2" size={14} />
        </button>
        <button
          class="chrome-btn"
          class:active={app.active?.chatSidebarOpenBySession[chromeSessionId]}
          title={app.active?.chatSidebarOpenBySession[chromeSessionId] ? "Hide sidebar" : "Show sidebar"}
          aria-label={app.active?.chatSidebarOpenBySession[chromeSessionId] ? "Hide sidebar" : "Show sidebar"}
          onclick={() => app.active?.toggleChatSidebar(chromeSessionId)}
        >
          <Icon
            name={app.active?.chatSidebarOpenBySession[chromeSessionId]
              ? "sidebar-right-collapse"
              : "sidebar-right-expand"}
            size={14}
          />
        </button>
      {/if}
      {#if win}
        <button
          class="chrome-btn"
          title="Minimize"
          aria-label="Minimize"
          onclick={() => win.minimize()}><Icon name="minus" size={12} /></button
        >
        <button
          class="chrome-btn"
          title="Maximize"
          aria-label="Maximize"
          onclick={() => win.toggleMaximize()}
          ><Icon name="square" size={11} /></button
        >
        <button
          class="chrome-btn window-close"
          title="Close"
          aria-label="Close"
          onclick={() => win.close()}><Icon name="xmark" size={13} /></button
        >
      {/if}
    </div>
  {/if}
  <div class="main">
    <Sidebar />
    <div class="content-row" bind:this={contentRowEl}>
      {#if app.active?.currentSessionId}
        <ChatPanel
          sessionId={app.active.currentSessionId}
          ownsChrome={!linkedVisible}
        />
      {:else if !app.active}
        <FirstServerPanel />
      {/if}
      <RightSidebar bind:panelEl={rightPanelEl} />
      {#if cornerVisible}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="corner-resize-handle"
          style="top: {cornerPos.top}px; left: {cornerPos.left}px;"
          onpointerdown={startCornerResize}
          onpointermove={onCornerResize}
          onpointerup={stopCornerResize}
          onpointercancel={stopCornerResize}
          onpointerenter={cornerHoverStart}
          onpointerleave={cornerHoverEnd}
        ></div>
      {/if}
    </div>
  </div>
  <StatusBar />
</div>
<SettingsPanel />
<DirectoryBrowser />
<SnapshotDialog />

<ConnectScreen />

<style>
  .shell {
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow-x: hidden;
  }

  /* `position: relative` makes this the containing block RightSidebar.svelte
     sizes its `.right-slot`/`.right-sidebar` pair against (both use the same
     `clamp(min, ratio%, 50%)`) — that's what keeps the right sidebar's width
     proportional in real time to left-sidebar resizes/collapses and window
     resizes alike, with no JS syncing the two. */
  .content-row {
    flex: 1;
    display: flex;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
  }

  /* Sits exactly on the line where the terminal's top edge meets the right
     sidebar's left edge — dragging it changes both ratios at once, same as
     VSCode's Panel/Auxiliary-bar corner. The two lines it affects light up
     via TerminalPanel.svelte's/RightSidebar.svelte's own resize-handle
     styles, both driven off the same app.*Resizing flags this sets. */
  .corner-resize-handle {
    position: absolute;
    width: 0.86rem;
    height: 0.86rem;
    transform: translate(-50%, -50%);
    cursor: nwse-resize;
    touch-action: none;
    z-index: 6;
  }

  /* --- Floating window chrome. Both pinned pieces sit at --chrome-inset from the
     window's top, left and right edges (app.css), so those three margins are
     even by construction, and both wear the shared .chrome-surface recipe and
     its one .chrome-btn rule — so the whole chrome layer follows Settings >
     Appearance > Surfaces as a unit. */
  .sidebar-toggle,
  .right-island {
    position: absolute;
    top: var(--chrome-inset);
    height: var(--chrome-h);
    z-index: 20;
    display: flex;
    align-items: center;
  }

  /* Its own button rather than part of an island: it belongs to the sidebar, so
     it has to stay where it is while the sidebar slides out from under it.
     Square, at the same height as the islands beside it. */
  .sidebar-toggle {
    left: var(--chrome-inset);
    width: var(--toggle-w);
    justify-content: center;
    color: var(--text-dim);
    cursor: pointer;
    transition:
      color calc(0.15s * var(--anim-speed, 1)) ease,
      background-color calc(0.15s * var(--anim-speed, 1)) ease,
      transform calc(0.1s * var(--anim-speed, 1)) ease;
  }

  .sidebar-toggle:hover {
    background: color-mix(in srgb, var(--text) 10%, var(--float-bg));
    color: var(--text);
  }

  .sidebar-toggle:active {
    transform: scale(0.94);
  }

  .sidebar-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Every control that isn't about this chat, in one container — the app toggles
     then the window buttons, in that order, so the window buttons stay on the
     outside edge where they're expected. Laid out at exactly --chrome-island-w,
     the width its reserve token is summed from, so a header padding itself clear
     of it can't be left short. */
  .right-island {
    right: var(--chrome-inset);
    width: var(--chrome-island-w);
    gap: var(--chrome-gap);
    padding: 0 var(--chrome-pad);
    z-index: var(--z-window-chrome);
    /* bits-ui's Dialog sets `body { pointer-events: none }` while open and only
       re-enables it on its own overlay/content — this sits outside that, so it
       must opt back in itself or become unclickable/undraggable whenever any
       dialog is open. */
    pointer-events: auto;
  }

  .right-island .chrome-btn.window-close:hover {
    background: var(--danger);
    color: #ffffff;
  }

  .right-island .chrome-btn.window-close:hover:active {
    background: color-mix(in srgb, var(--danger) 80%, black);
  }
</style>

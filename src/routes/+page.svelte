<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app } from "$lib/state.svelte";
  import { isDesktop } from "$lib/platform";
  import { wireEvents, autoConnect } from "$lib/ipc";
  import ConnectScreen from "$lib/components/ConnectScreen.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import RightSidebar from "$lib/components/RightSidebar.svelte";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import DirectoryBrowser from "$lib/components/DirectoryBrowser.svelte";
  import SnapshotDialog from "$lib/components/SnapshotDialog.svelte";
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
      {#if app.active?.currentSessionId}
        <button
          class="chrome-btn"
          class:active={app.terminalOpen}
          title={app.terminalOpen ? "Hide terminal" : "Show terminal"}
          aria-label={app.terminalOpen ? "Hide terminal" : "Show terminal"}
          onclick={() => app.toggleTerminal()}
        >
          <Icon name="terminal-2" size={14} />
        </button>
        <button
          class="chrome-btn"
          title={app.rightSidebarCollapsed ? "Show panel" : "Hide panel"}
          aria-label={app.rightSidebarCollapsed ? "Show panel" : "Hide panel"}
          onclick={() => app.toggleRightSidebar()}
        >
          <Icon
            name={app.rightSidebarCollapsed
              ? "sidebar-right-expand"
              : "sidebar-right-collapse"}
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
    <div class="content-col">
      <div class="content-row">
        {#if app.active?.currentSessionId}
          <ChatPanel sessionId={app.active?.currentSessionId} />
        {/if}
        <RightSidebar />
      </div>
      <TerminalPanel />
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

  /* Everything to the right of the (fixed) left sidebar — the chat area, the
     right sidebar, and the terminal drawer all live in this column, so
     opening the terminal shrinks only this area instead of the left sidebar
     too. */
  .content-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
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

  .right-island .chrome-btn.active {
    color: var(--accent);
  }

  .right-island .chrome-btn.window-close:hover {
    background: var(--danger);
    color: #ffffff;
  }

  .right-island .chrome-btn.window-close:hover:active {
    background: color-mix(in srgb, var(--danger) 80%, black);
  }
</style>

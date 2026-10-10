<script lang="ts">
  import { onMount } from "svelte";
  import { app, RIGHT_SIDEBAR_MIN_WIDTH, TERMINAL_MIN_HEIGHT } from "$lib/state.svelte";
  import { windowControls } from "$lib/platform";
  import { wireEvents, autoConnect, loadCustomThemes } from "$lib/ipc";
  import { startNotifications } from "$lib/notifications.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import RightSidebar from "$lib/components/RightSidebar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import UsagePanel from "$lib/components/UsagePanel.svelte";
  import ExtensionsPanel from "$lib/components/ExtensionsPanel.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import FirstServerPanel from "$lib/components/FirstServerPanel.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import TooltipHost from "$lib/components/TooltipHost.svelte";
  import QuietRoom from "$lib/components/QuietRoom.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import { dispatchKeybind, dispatchMouseNav } from "$lib/keybinds.svelte";
  import { tip } from "$lib/tooltip.svelte";
  import { viewport, drawerWidth } from "$lib/viewport.svelte";
  import { swipe, commits, ownsHorizontalDrag } from "$lib/gestures";
import { haptic } from "$lib/haptics";
  import { initSheetDrag } from "$lib/sheets";

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
  const win = windowControls;

  // Whichever chat is rightmost owns the floating right island: the linked
  // chat when it's actually shown, otherwise the main chat (including while
  // the side chat is collapsed, since it's then slid off-screen, not
  // genuinely visible). Every other chat renders its own local island
  // instead (ChatPanel.svelte's `.local-island`). `linkedVisible` only picks
  // which chat is rightmost; it says nothing about the split-view pairing's
  // own lifecycle (that's ServerState.sidebarSessionId, opened/closed from a
  // session row or the linked chat's own header).
  const linkedVisible = $derived(
    !viewport.narrow && !!app.active?.sidebarSessionId && !app.rightSidebarCollapsed,
  );
  const chromeSessionId = $derived(
    linkedVisible ? app.active!.sidebarSessionId! : app.active?.currentSessionId,
  );

  // The corner handle where the right sidebar's own terminal drawer meets
  // that sidebar's resize handle, bottom-left of the sidebar, once its
  // terminal is open. Like VSCode's Panel/Auxiliary-bar corner, dragging it
  // changes both the sidebar's width and the terminal's height at once. Only
  // makes sense when both are actually open; otherwise there's no
  // intersection to grab.
  // The usage page and the extensions page share the chat panel's place; whichever was asked for last wins.
  $effect(() => {
    if (app.showUsage) app.showExtensions = false;
  });
  let rightPanelEl = $state<HTMLElement | null>(null);
  let contentRowEl = $state<HTMLDivElement | null>(null);
  let cornerDragging = $state(false);
  let cornerPos = $state({ top: 0, left: 0 });

  const cornerVisible = $derived(
    linkedVisible &&
      !app.fullPage &&
      !!app.active?.sidebarSessionId &&
      !!app.active.terminalOpenBySession[app.active.sidebarSessionId],
  );

  // Mirrors TerminalPanel.svelte's own clamp(min, ratio, 50%) math against
  // its real containing block (this specific ChatPanel's box), so the corner
  // lands exactly on the two lines it's meant to sit between, so no CSS var
  // plumbing across component boundaries is needed for a single handle. The
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
  // resizes/collapses, anything that reflows .content-row or the panel
  // without touching either ratio.
  $effect(() => {
    if (!contentRowEl || !rightPanelEl) return;
    const ro = new ResizeObserver(measureCorner);
    ro.observe(contentRowEl);
    ro.observe(rightPanelEl);
    return () => ro.disconnect();
  });

  // Measured once per drag: reading layout on every pointermove forces a synchronous layout.
  let dragRow: DOMRect | null = null;
  let dragPanel: DOMRect | null = null;
  function startCornerResize(e: PointerEvent) {
    if (!rightPanelEl || !contentRowEl) return;
    dragRow = contentRowEl.getBoundingClientRect();
    dragPanel = rightPanelEl.getBoundingClientRect();
    cornerDragging = true;
    app.rightSidebarResizing = true;
    app.terminalResizing = true;
    document.body.style.cursor = "nwse-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onCornerResize(e: PointerEvent) {
    if (!cornerDragging || !dragRow || !dragPanel) return;
    const rowRect = dragRow;
    const fromRight = Math.min(rowRect.width * 0.5, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, rowRect.right - e.clientX));
    app.rightSidebarRatio = Math.min(0.5, Math.max(0, fromRight / rowRect.width));

    const panelRect = dragPanel;
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

  // At module scope, not in onMount, so the first frame already has the right
  // header reserve.
  app.applyWindowChrome();

  // Phone layout: the sidebar is a drawer, dragged in from the left edge or out with the scrim.
  $effect(() => {
    viewport.narrow;
    app.syncNarrow();
  });
  // Picking a chat or a page is what you opened the drawer for.
  let lastDest = "";
  $effect(() => {
    const dest = `${app.active?.currentSessionId}|${app.showUsage}|${app.showExtensions}`;
    if (dest === lastDest) return;
    lastDest = dest;
    if (viewport.narrow) app.setSidebarCollapsed(true);
  });
  const toolsPage = $derived(
    viewport.narrow && !!chromeSessionId && !!app.active?.chatSidebarOpenBySession[chromeSessionId],
  );
  // What "back" means right now: out of the tools page, or out of a page's sub-screen.
  const goBack = $derived(
    toolsPage
      ? () => chromeSessionId && app.active?.toggleChatSidebar(chromeSessionId)
      : viewport.narrow
        ? viewport.back
        : null,
  );
  const drawerProgress = $derived(viewport.drawer ?? (app.sidebarCollapsed ? 0 : 1));
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  // Swipe right from anywhere in the app: opens the drawer, or backs out of the tools page. Left
  // to whatever already uses a sideways drag there (code blocks, terminals, fields).
  const edge = {
    axis: "x",
    start: (e: PointerEvent) => !ownsHorizontalDrag(e.target),
    accept: (d: number) => d > 0,
    onMove: (d: number) => {
      if (!goBack) viewport.drawer = clamp01(d / drawerWidth());
    },
    onEnd: (d: number, v: number) => {
      if (goBack) {
        if (commits(d / innerWidth, v, 1)) (haptic(), goBack());
      } else {
        const open = commits(clamp01(d / drawerWidth()), v, 1);
        if (open) haptic();
        app.setSidebarCollapsed(!open);
      }
      viewport.drawer = null;
    },
    onCancel: () => (viewport.drawer = null),
  } as const;
  const shut = {
    axis: "x",
    accept: (d: number) => d < 0 && !app.sidebarCollapsed,
    onMove: (d: number) => (viewport.drawer = clamp01(1 + d / drawerWidth())),
    onEnd: (d: number, v: number) => {
      const closed = commits(1 - clamp01(1 + d / drawerWidth()), -v, 1);
      if (closed) haptic();
      app.setSidebarCollapsed(closed);
      viewport.drawer = null;
    },
    onCancel: () => (viewport.drawer = null),
  } as const;

  onMount(() => {
    wireEvents();
    app.applySettings();
    void loadCustomThemes();
    void autoConnect();
    const stopNotifications = startNotifications();
    const stopSheets = initSheetDrag();

    // "System" theme (Settings > Appearance) tracks this live instead of only
    // resolving once at startup.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => {
      if (app.settings.theme === "system") app.applySettings();
    };
    media.addEventListener("change", onSchemeChange);

    window.addEventListener("keydown", dispatchKeybind, true);
    window.addEventListener("mouseup", dispatchMouseNav);
    return () => {
      stopNotifications();
      stopSheets();
      media.removeEventListener("change", onSchemeChange);
      window.removeEventListener("keydown", dispatchKeybind, true);
      window.removeEventListener("mouseup", dispatchMouseNav);
    };
  });

  // There's always a session to show, no empty placeholder screen. Before a
  // project is picked (or right after switching one, which clears the
  // current session, see selectProject in ipc.ts) this hands the chat view
  // a fresh session immediately; the composer disables sending until a
  // project is actually bound (PromptInput's projectPath check).
  $effect(() => {
    if (app.active && !app.active.currentSessionId) app.active.ensureCurrentSession();
  });
</script>

<div class="shell">
  <!-- Must stay the first element: see .titlebar-drag in app.css. -->
  <div class="titlebar-drag"></div>
  {#if !app.onboarding}
  {#if viewport.narrow}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="drawer-scrim" class:on={drawerProgress > 0} style:opacity={drawerProgress} {@attach swipe(() => shut)} onclick={() => app.setSidebarCollapsed(true)} role="presentation"></div>
  {/if}
  <div class="chrome-surface sidebar-toggle">
    <!-- The macOS traffic lights are positioned over this (syncNativeChrome). -->
    <div class="traffic-lights"></div>
    <button
      class="chrome-btn"
      {@attach tip(app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar", { keys: "sidebar.toggle", side: "bottom" })}
      aria-label={goBack ? "Back" : app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
      onclick={() => (goBack ? goBack() : app.toggleSidebar())}
    >
      <Icon
        name={goBack
          ? "chevron-left"
          : app.sidebarCollapsed
            ? "sidebar-left-expand"
            : "sidebar-left-collapse"}
        size={14}
      />
    </button>
  </div>
  {/if}
  {#if (app.active?.currentSessionId && !app.fullPage) || (win && app.settings.windowChrome)}
    <div class="chrome-surface right-island" class:bare={app.fullPage} class:under-drawer={viewport.narrow && drawerProgress > 0}>
      {#if chromeSessionId && !app.fullPage}
        <button
          class="chrome-btn"
          class:active={app.active?.terminalOpenBySession[chromeSessionId]}
          {@attach tip(app.active?.terminalOpenBySession[chromeSessionId] ? "Hide terminal" : "Show terminal", "terminal.toggle")}
          aria-label={app.active?.terminalOpenBySession[chromeSessionId] ? "Hide terminal" : "Show terminal"}
          onclick={() => app.active?.toggleTerminal(chromeSessionId)}
        >
          <Icon name="terminal-2" size={14} />
        </button>
        <button
          class="chrome-btn"
          class:active={app.active?.chatSidebarOpenBySession[chromeSessionId]}
          {@attach tip(app.active?.chatSidebarOpenBySession[chromeSessionId] ? "Hide side panel" : "Show side panel", "panel.toggle")}
          aria-label={app.active?.chatSidebarOpenBySession[chromeSessionId] ? "Hide side panel" : "Show side panel"}
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
      {#if win && app.settings.windowChrome}
        <button
          class="chrome-btn"
          {@attach tip("Minimize")}
          aria-label="Minimize"
          onclick={() => win.minimize()}><Icon name="minus" size={12} /></button
        >
        <button
          class="chrome-btn"
          {@attach tip("Maximize")}
          aria-label="Maximize"
          onclick={() => win.toggleMaximize()}
          ><Icon name="square" size={11} /></button
        >
        <button
          class="chrome-btn window-close"
          {@attach tip("Close")}
          aria-label="Close"
          onclick={() => win.close()}><Icon name="xmark" size={13} /></button
        >
      {/if}
    </div>
  {/if}
  <div class="main" {@attach viewport.narrow && app.sidebarCollapsed ? swipe(() => edge) : undefined}>
    {#if app.onboarding}
      <Onboarding />
    {:else}
    <Sidebar />
    <div class="content-row" bind:this={contentRowEl}>
      {#if app.showExtensions}
        <ExtensionsPanel />
      {:else if app.showUsage}
        <UsagePanel />
      {:else if app.active?.currentSessionId}
        <ChatPanel
          sessionId={app.active.currentSessionId}
          ownsChrome={!linkedVisible}
        />
      {:else if !app.active}
        <FirstServerPanel />
      {/if}
      {#if !viewport.narrow}<RightSidebar bind:panelEl={rightPanelEl} />{/if}
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
    {/if}
  </div>
  {#if !app.onboarding && !viewport.narrow}<StatusBar />{/if}
</div>
<SettingsPanel />
<CommandPalette />
<Toasts />
<TooltipHost />
<QuietRoom />

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
     `clamp(min, ratio%, 50%)`), which keeps the right sidebar's width
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
     sidebar's left edge; dragging it changes both ratios at once, same as
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
     its one .chrome-btn rule, so the whole chrome layer follows Settings >
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

  /* Not part of an island, so it stays put while the sidebar slides. */
  .sidebar-toggle {
    left: var(--chrome-inset);
    width: var(--toggle-w);
    padding: 0 var(--chrome-pad);
    gap: var(--chrome-gap);
  }

  .traffic-lights {
    display: none;
    align-self: stretch;
    width: calc(var(--traffic-lights-w) + 2 * var(--traffic-lights-pad));
  }

  :global(:root[data-window-chrome="traffic-lights"]) .traffic-lights {
    display: block;
  }

  /* Every control that isn't about this chat, in one container: the app toggles
     then the window buttons, in that order, so the window buttons stay on the
     outside edge where they're expected. Laid out at exactly --chrome-island-w,
     the width its reserve token is summed from, so a header padding itself clear
     of it can't be left short. */
  .right-island {
    right: calc(var(--chrome-inset) + var(--window-controls-w));
    width: var(--chrome-island-w);
    gap: var(--chrome-gap);
    padding: 0 var(--chrome-pad);
    z-index: var(--z-window-chrome);
    /* bits-ui's Dialog sets `body { pointer-events: none }` while open and only
       re-enables it on its own overlay/content. This sits outside that, so it
       must opt back in itself or become unclickable/undraggable whenever any
       dialog is open. */
    pointer-events: auto;
  }

  /* Usage page: only the window buttons are left, so the pill shrinks to fit them. */
  .right-island.bare {
    width: auto;
  }

  .right-island .chrome-btn.window-close:hover {
    background: var(--danger);
    color: #ffffff;
  }

  .right-island .chrome-btn.window-close:hover:active {
    background: color-mix(in srgb, var(--danger) 80%, black);
  }
  /* Phone layout. The drawer's own rules are in Sidebar.svelte. */
  @media (max-width: 700px) {
    /* The visual viewport, so the composer rides above the keyboard on iOS too. */
    .shell {
      position: fixed;
      top: var(--vv-top, 0px);
      left: 0;
      right: 0;
      height: var(--vvh, 100dvh);
      padding: var(--safe-top) env(safe-area-inset-right, 0px) var(--safe-bottom) env(safe-area-inset-left, 0px);
    }
    .sidebar-toggle,
    .right-island {
      top: calc(var(--chrome-inset) + var(--safe-top));
    }
    .sidebar-toggle {
      left: calc(var(--chrome-inset) + env(safe-area-inset-left, 0px));
    }
    .right-island {
      right: calc(var(--chrome-inset) + env(safe-area-inset-right, 0px));
      transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
    }
    /* The drawer covers the strip the island would sit over. */
    .right-island.under-drawer {
      opacity: 0;
      pointer-events: none;
    }
  }
  .drawer-scrim {
    position: fixed;
    inset: 0;
    z-index: 14;
    background: rgba(6, 7, 11, 0.5);
    opacity: 0;
    pointer-events: none;
    touch-action: pan-y;
  }
  .drawer-scrim.on {
    pointer-events: auto;
  }
  @media (max-width: 700px) {
    .main {
      touch-action: pan-y;
    }
  }
</style>

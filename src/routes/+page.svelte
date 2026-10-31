<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { app, RIGHT_SIDEBAR_MIN_WIDTH, TERMINAL_MIN_HEIGHT } from "$lib/state.svelte";
  import { windowControls } from "$lib/platform";
  import { wireEvents, autoConnect, loadCustomThemes } from "$lib/ipc";
  import { startNotifications } from "$lib/notifications.svelte";
  import { syncDiscordRpc } from "$lib/discordRpc.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import RightSidebar from "$lib/components/RightSidebar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import Lazy from "$lib/components/Lazy.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import FirstServerPanel from "$lib/components/FirstServerPanel.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import TooltipHost from "$lib/components/TooltipHost.svelte";
  import QuietRoom from "$lib/components/QuietRoom.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import { dispatchKeybind, dispatchMouseNav } from "$lib/keybinds.svelte";
  import { tip } from "$lib/tooltip.svelte";
  import { viewport, showHome } from "$lib/viewport.svelte";
  import { swipe, commits, ownsHorizontalDrag } from "$lib/gestures";
  import { haptic } from "$lib/haptics";
  import MobileBar from "$lib/components/MobileBar.svelte";
  import MobileHome from "$lib/components/MobileHome.svelte";

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
    viewport.kind === "desktop" && !!app.active?.sidebarSessionId && !app.rightSidebarCollapsed,
  );
  const chromeSessionId = $derived(
    linkedVisible ? app.active!.sidebarSessionId! : app.active?.currentSessionId,
  );

  // The usage page and the extensions page share the chat panel's place; whichever was asked for last wins.
  $effect(() => {
    if (app.showUsage) app.showExtensions = app.showDiagnostics = false;
  });
  let rightPanelEl = $state<HTMLElement | null>(null);
  let contentRowEl = $state<HTMLDivElement | null>(null);
  let cornerDragging = $state(false);
  let cornerPos = $state({ top: 0, left: 0 });

  // The corner handle where the right sidebar's own terminal drawer meets
  // that sidebar's resize handle, bottom-left of the sidebar, once its
  // terminal is open. Like VSCode's Panel/Auxiliary-bar corner, dragging it
  // changes both the sidebar's width and the terminal's height at once. Only
  // makes sense when both are actually open; otherwise there's no
  // intersection to grab.
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

  // Phone layout: a stack of two screens. Home is the fleet list; the screen on top of it is a chat,
  // or one of the pages (usage, extensions, diagnostics) that share the chat's place.
  $effect(() => {
    viewport.narrow;
    app.syncNarrow();
  });
  const pageTitle = $derived(
    app.showUsage ? "Usage" : app.showExtensions ? "Extensions" : app.showDiagnostics ? "Diagnostics" : null,
  );
  const deep = $derived(viewport.narrow && (viewport.screen === "chat" || !!pageTitle));
  const toolsPage = $derived(
    viewport.narrow && !!chromeSessionId && !!app.active?.chatSidebarOpenBySession[chromeSessionId],
  );
  const chatTitle = $derived(
    (chromeSessionId && app.active?.sessionById.get(chromeSessionId)?.title) || "New chat",
  );
  // One step back: out of the tools page, out of a page's sub-screen, then off the screen to Home.
  function back() {
    if (toolsPage) return void (chromeSessionId && app.active?.toggleChatSidebar(chromeSessionId));
    if (viewport.back) return viewport.back();
    app.showUsage = app.showExtensions = app.showDiagnostics = false;
    showHome();
  }
  // Motion: one 0..1 progress (0 = top screen off to the right, 1 = fully in) drives the top screen, the
  // parallax of Home beneath it (-24%) and its dim veil. Pushes, backs, programmatic changes and swipes all
  // settle through settleTo(), so any of them can interrupt any other from where it currently is.
  const DRAWER = "cubic-bezier(.32,.72,0,1)";
  const OUT = "cubic-bezier(.23,1,.32,1)";
  let topEl = $state<HTMLElement>();
  let underEl = $state<HTMLElement>();
  let dimEl = $state<HTMLElement>();
  let prog = 0;
  let anims: Animation[] = [];
  let release: { ms: number; ease: string } | null = null;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (p: number) =>
    reduced()
      ? { top: { opacity: p, transform: "none" }, under: { transform: "none" }, dim: { opacity: 0 } }
      : {
          top: { opacity: 1, transform: `translateX(${(1 - p) * 100}%)` },
          under: { transform: `translateX(${-24 * p}%)` },
          dim: { opacity: 0.9 * p },
        };
  function place(p: number) {
    if (!topEl || !underEl || !dimEl) return;
    prog = p;
    const f = frame(p);
    topEl.style.transform = f.top.transform;
    topEl.style.opacity = String(f.top.opacity);
    topEl.style.visibility = p > 0 ? "visible" : "hidden";
    underEl.style.transform = f.under.transform;
    dimEl.style.opacity = String(f.dim.opacity);
  }
  let deepNow = false;
  /** Where the top screen is right now, mid-flight included. */
  function current() {
    if (!anims.length || !topEl) return prog;
    const m = new DOMMatrixReadOnly(getComputedStyle(topEl).transform);
    return reduced() ? Number(getComputedStyle(topEl).opacity) : 1 - m.m41 / topEl.offsetWidth;
  }
  function settleTo(to: number, ms: number, ease: string) {
    if (!topEl || !underEl || !dimEl) return;
    const from = current();
    anims.forEach((a) => a.cancel());
    anims = [];
    place(from);
    topEl.style.visibility = "visible";
    const speed = Number(getComputedStyle(document.documentElement).getPropertyValue("--anim-speed")) || 1;
    const o = { duration: Math.max(1, ms * speed), easing: ease, fill: "forwards" as const };
    const a = frame(from);
    const b = frame(to);
    anims = [
      topEl.animate([a.top, b.top], o),
      underEl.animate([a.under, b.under], o),
      dimEl.animate([a.dim, b.dim], o),
    ];
    const mine = anims;
    Promise.all(mine.map((x) => x.finished)).then(
      () => {
        if (anims !== mine) return;
        anims = [];
        place(to);
        mine.forEach((x) => x.cancel());
      },
      () => {},
    );
  }
  $effect(() => {
    const on = deep;
    untrack(() => {
      deepNow = on;
      if (!topEl) return;
      topEl.inert = !on;
      if (prog === (on ? 1 : 0) && !anims.length) return place(on ? 1 : 0);
      const r = release;
      release = null;
      settleTo(on ? 1 : 0, r?.ms ?? (on ? 340 : 300), r?.ease ?? DRAWER);
    });
  });
  $effect(() => {
    if (!topEl) return;
    untrack(() => place(deep ? 1 : 0));
  });

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  // Swipe right anywhere on the screen to go back. Left to whatever already uses a sideways drag
  // there (code blocks, terminals, fields). The screen follows the finger 1:1; on release it settles
  // for a time scaled to the distance left.
  const popBack = {
    axis: "x",
    start: (e: PointerEvent) => !ownsHorizontalDrag(e.target),
    accept: (d: number) => d > 0,
    onMove: (d: number) => {
      if (anims.length) {
        prog = current();
        anims.forEach((a) => a.cancel());
        anims = [];
      }
      const p = 1 - clamp01(d / innerWidth);
      viewport.pop = 1 - p;
      place(p);
    },
    onEnd: async (d: number, v: number) => {
      const m = clamp01(d / innerWidth);
      viewport.pop = null;
      const go = commits(m, v, 1);
      const W = innerWidth;
      const ms = Math.min(320, Math.max(160, ((go ? (1 - m) * W : m * W) / Math.max(Math.abs(v), 0.9))));
      if (go) {
        haptic();
        release = { ms, ease: OUT };
        back();
        await tick();
      }
      release = null;
      // Still on this screen (back only closed a sub-screen, or the swipe fell short): spring back.
      if (deepNow || !go) settleTo(1, ms, OUT);
    },
    onCancel: () => {
      viewport.pop = null;
      settleTo(1, 200, OUT);
    },
  } as const;

  // Discord Rich Presence is desktop-only and off by default. One effect covers both halves: the
  // main-process connection settings and the current chat/project it shows.
  $effect(() => {
    syncDiscordRpc();
  });

  onMount(() => {
    wireEvents();
    app.applySettings();
    void loadCustomThemes();
    void autoConnect();
    const stopNotifications = startNotifications();

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

{#snippet page()}
  {#if app.showDiagnostics}
    <Lazy load={() => import("$lib/components/DiagnosticsPanel.svelte")} />
  {:else if app.showExtensions}
    <Lazy load={() => import("$lib/components/ExtensionsPanel.svelte")} />
  {:else if app.showUsage}
    <Lazy load={() => import("$lib/components/UsagePanel.svelte")} />
  {:else if app.active?.currentSessionId}
    <ChatPanel sessionId={app.active.currentSessionId} ownsChrome={!linkedVisible} />
  {:else if !app.active}
    <FirstServerPanel />
  {/if}
{/snippet}

<div class="shell">
  <!-- Must stay the first element: see .titlebar-drag in app.css. -->
  <div class="titlebar-drag"></div>
  {#if !app.onboarding && !viewport.narrow}
  <div class="chrome-surface sidebar-toggle">
    <!-- The macOS traffic lights are positioned over this (syncNativeChrome). -->
    <div class="traffic-lights"></div>
    <button
      class="chrome-btn"
      {@attach tip(app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar", { keys: "sidebar.toggle", side: "bottom" })}
      aria-label={app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
      onclick={() => app.toggleSidebar()}
      onpointerenter={() => app.peekSidebar(true)}
      onpointerleave={() => app.peekSidebar(false)}
    >
      <Icon
        name={app.sidebarCollapsed ? "sidebar-left-expand" : "sidebar-left-collapse"}
        size={14}
      />
    </button>
  </div>
  {/if}
  {#if !viewport.narrow && ((app.active?.currentSessionId && !app.fullPage) || (win && app.settings.windowChrome))}
    <div class="chrome-surface right-island" class:bare={app.fullPage}>
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
  {#if viewport.narrow && !app.onboarding}
    <div class="stack">
      <section class="screen" bind:this={underEl} inert={deep} aria-hidden={deep}>
        <MobileHome />
        <div class="dim" bind:this={dimEl}></div>
      </section>
      <section class="screen top" bind:this={topEl} {@attach swipe(() => popBack)}>
        <MobileBar title={pageTitle ?? chatTitle} sessionId={pageTitle ? null : chromeSessionId} onBack={back} />
        <div class="content-row">{@render page()}</div>
      </section>
    </div>
  {:else}
  <div class="main">
    {#if app.onboarding}
      <Onboarding />
    {:else}
    <Sidebar />
    <div class="content-row" bind:this={contentRowEl}>
      {@render page()}
      {#if viewport.kind === "desktop"}<RightSidebar bind:panelEl={rightPanelEl} />{/if}
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
  {/if}
  {#if !app.onboarding && viewport.kind === "desktop"}<StatusBar />{/if}
</div>
<Lazy load={() => import("$lib/components/SettingsPanel.svelte")} when={app.showSettings} />
<Lazy load={() => import("$lib/components/CommandPalette.svelte")} when={app.paletteOpen} />
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
  /* Phone: the shell is the visual viewport, so the composer rides above the keyboard on iOS too. */
  @media (max-width: 700px) {
    .shell {
      position: fixed;
      top: var(--vv-top, 0px);
      left: 0;
      right: 0;
      height: var(--vvh, 100dvh);
      padding: var(--safe-top) env(safe-area-inset-right, 0px) var(--safe-bottom) env(safe-area-inset-left, 0px);
    }
  }
  /* Phone: two screens stacked. The top one slides in over Home (and back out under a finger). */
  .stack {
    flex: 1;
    position: relative;
    min-height: 0;
    overflow: hidden;
  }
  .screen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg);
  }
  .screen.top {
    z-index: 2;
    background: var(--panel-bg);
    visibility: hidden;
    transform: translateX(100%);
    box-shadow: var(--shadow-drawer);
    touch-action: pan-y;
    will-change: transform;
  }
  .screen .dim {
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(6, 7, 11, 1);
    opacity: 0;
    pointer-events: none;
  }
</style>

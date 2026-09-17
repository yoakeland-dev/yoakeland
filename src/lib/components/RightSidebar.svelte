<script lang="ts">
  // Right sidebar: holds one chat, opened via the "put to the side" button on
  // a session row (Sidebar.svelte / ProjectGroup.svelte) rather than drag and
  // drop.
  //
  // Width is entirely the layout's job, not JS's: `.right-slot` (the flex
  // item that reserves space in `.content-row`, next to the chat panel) and
  // `.right-sidebar` (the visual, absolutely-positioned panel that slides off
  // on collapse) both size themselves with the same `clamp(min, pct, 50%)`
  // against `.content-row` — their shared containing block, see +page.svelte.
  // State only holds the ratio; resizing the *left* sidebar, collapsing it,
  // or resizing the window all reflow this in the same paint with no JS
  // keeping anything in sync.
  import { app, RIGHT_SIDEBAR_MIN_WIDTH } from "../state.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import MessageList from "./MessageList.svelte";
  import PromptInput from "./PromptInput.svelte";
  import Icon from "./Icon.svelte";

  const COLLAPSE_THRESHOLD = 90;

  let resizing = $state(false);
  let slotEl = $state<HTMLDivElement | null>(null);

  const sizeVars = $derived(
    `--right-pct: ${app.rightSidebarRatio * 100}%; --right-min: ${RIGHT_SIDEBAR_MIN_WIDTH}px`,
  );

  // Width only animates while opening/closing (either sidebar) — width
  // changes from dragging (handled by `resizing` below, live for both this
  // panel's own handle and the left sidebar's — CSS does that for free) or
  // from a window resize should be instant/real-time. An explicit, manual
  // toggle of either sidebar is the only case that should ease — switching
  // chats can also flip `rightSidebarCollapsed` as a side effect (e.g.
  // opening a saved split), and that should snap instantly instead, so this
  // tracks `rightSidebarAnimateTick` (bumped only by toggleRightSidebar)
  // rather than the collapsed flag itself.
  let widthAnimating = $state(false);
  $effect(() => {
    app.rightSidebarAnimateTick;
    app.sidebarCollapsed;
    widthAnimating = true;
    const duration = Math.round(200 / (app.settings.animationSpeed || 1)) + 30;
    const timer = setTimeout(() => (widthAnimating = false), duration);
    return () => clearTimeout(timer);
  });

  // True for a brief window right after a drag crosses the collapse
  // threshold, in either direction — mirrors Sidebar.svelte's
  // collapsedByDrag. One eased transition for that crossing (see
  // .crossing-anim below), then back to transition:none so the rest of the
  // drag keeps tracking the pointer instead of easing behind it.
  let crossingAnim = $state(false);
  let crossingAnimTimer: ReturnType<typeof setTimeout> | undefined;

  function startResize(e: PointerEvent) {
    if (app.rightSidebarCollapsed) return;
    resizing = true;
    crossingAnim = false;
    clearTimeout(crossingAnimTimer);
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!resizing || !slotEl) return;
    // Measure `.content-row` directly rather than the window — the space
    // this panel is proportional to is what's left of the (fixed-width) left
    // sidebar, not the whole viewport.
    const container = (
      slotEl.parentElement as HTMLElement
    ).getBoundingClientRect();
    const fromRight = container.right - e.clientX;
    // Dragging past the minimum collapses outright, same as the left
    // sidebar — see Sidebar.svelte's onResize for the identical threshold
    // logic. Not touching rightSidebarRatio while collapsed means it's left
    // exactly where it was when the threshold was crossed, so re-opening
    // comes back at the same size with no separate "width before drag" to
    // track.
    const collapsed = fromRight < RIGHT_SIDEBAR_MIN_WIDTH - COLLAPSE_THRESHOLD;
    if (collapsed !== app.rightSidebarCollapsed) {
      crossingAnim = true;
      clearTimeout(crossingAnimTimer);
      const duration = Math.round(200 * (app.settings.animationSpeed || 1)) + 50;
      crossingAnimTimer = setTimeout(() => (crossingAnim = false), duration);
      app.setRightSidebarCollapsed(collapsed);
    }
    if (collapsed) return;
    app.rightSidebarRatio = Math.min(0.5, Math.max(0, fromRight / container.width));
  }
  function stopResize() {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = "";
    app.setRightSidebarRatio(app.rightSidebarRatio);
  }
</script>

<div
  class="right-slot"
  class:resizing
  class:collapsed={app.rightSidebarCollapsed}
  class:crossing-anim={crossingAnim}
  style={sizeVars}
  bind:this={slotEl}
>
  <aside
    class="right-sidebar"
    class:width-animating={widthAnimating}
    class:resizing
    class:collapsed={app.rightSidebarCollapsed}
    style={sizeVars}
  >
    {#if app.sidebarSessionId}
      <div class="panel">
        <ChatHeader
          sessionId={app.sidebarSessionId}
          sidePanel
          reserveChrome
          overlay
        />
        <div class="body">
          <MessageList
            sessionId={app.sidebarSessionId}
            paddingTop="calc(var(--header-height) + 20px)"
          />
          <PromptInput sessionId={app.sidebarSessionId} floating={false} />
        </div>
      </div>
    {:else}
      <div class="top reserve-chrome" data-tauri-drag-region>
        <span class="title">Panel</span>
      </div>
      <div class="placeholder empty-state">
        <Icon name="layout-sidebar-right" size={22} />
        <span>Nothing pinned here yet</span>
        <span class="sub"
          >Use a chat's sidebar button to open it in this panel</span
        >
      </div>
    {/if}
    {#if !app.rightSidebarCollapsed || resizing}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        onpointerdown={startResize}
        onpointermove={onResize}
        onpointerup={stopResize}
        onpointercancel={stopResize}
      ></div>
    {/if}
  </aside>
</div>

<style>
  .right-slot {
    flex-shrink: 0;
    /* Same reasoning as `.sidebar-slot` in Sidebar.svelte: flex-basis (not
       width) keeps `.content-col`'s reflow in lockstep every frame instead
       of a frame behind it. No `position` here — `.right-sidebar` below is
       positioned against `.content-row`, not this slot, so it stays full
       size and slides off on collapse instead of shrinking away with it. */
    flex-basis: clamp(var(--right-min), var(--right-pct), 50%);
    transition: flex-basis calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .right-slot.collapsed {
    flex-basis: 0;
  }
  .right-slot.resizing {
    transition: none;
  }
  /* One eased flex-basis change for the collapse-threshold crossing itself
     (either direction), same reasoning as Sidebar.svelte's
     .sidebar-slot.resizing.collapse-anim — dragging still owns transition:none
     the rest of the time, or every pointermove would ease behind the pointer
     instead of tracking it. */
  .right-slot.resizing.crossing-anim {
    transition: flex-basis calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .right-slot.resizing.crossing-anim .right-sidebar {
    transition:
      transform calc(0.2s * var(--anim-speed, 1)) ease,
      width calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .right-sidebar {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: clamp(var(--right-min), var(--right-pct), 50%);
    background: transparent;
    display: flex;
    flex-direction: column;
  }
  .right-sidebar.width-animating {
    transition:
      transform calc(0.2s * var(--anim-speed, 1)) ease,
      width calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .right-sidebar.resizing {
    transition: none;
  }
  .right-sidebar.collapsed {
    transform: translateX(100%);
  }
  /* Same card as the main chat panel — real content lives here now, not just
     a placeholder, so it should read as the same kind of surface. */
  .panel {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .panel :global(.header) {
    z-index: 2;
  }
  .body {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* Same band as a chat header, so the panel's title shares the window's one
     top line — and, on desktop, keeps clear of the window buttons that float
     over this corner whenever the panel is the rightmost surface. */
  .top {
    display: flex;
    align-items: center;
    height: var(--header-height);
    flex-shrink: 0;
    padding: 0 0.25rem;
  }
  /* The right island (+page.svelte) floats over this corner whenever this panel
     is the rightmost surface — i.e. whenever it's open at all. */
  .top.reserve-chrome {
    padding-right: var(--chrome-reserve);
  }
  .title {
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text-dim);
  }
  .placeholder {
    flex: 1;
    padding: var(--space-3);
  }
  .placeholder .sub {
    font-size: var(--text-heading-size);
    opacity: 0.8;
  }
  .resize-handle {
    position: absolute;
    top: 0;
    left: -0.21rem;
    width: 0.43rem;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    z-index: 5;
  }
</style>

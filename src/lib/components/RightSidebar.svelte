<script lang="ts">
  // Resize/collapse wrapper around a second ChatPanel; owns only the proportional-width/
  // slide-collapse mechanics, no chat markup of its own.
  //
  // Width is the layout's job, not JS's: `.right-slot` and `.right-sidebar` both size
  // themselves with the same `clamp(min, pct, 50%)` against `.content-row` (see +page.svelte).
  // State only holds the ratio, so any reflow (left sidebar resize/collapse, window resize)
  // stays in sync with no JS needed.
  import { app, RIGHT_SIDEBAR_MIN_WIDTH } from "../state.svelte";
  import ChatPanel from "./ChatPanel.svelte";

  // Bindable so +page.svelte can measure this ChatPanel's box, for the corner handle where
  // the terminal drawer meets the resize handle.
  let { panelEl = $bindable(null) }: { panelEl?: HTMLElement | null } = $props();

  const COLLAPSE_THRESHOLD = 90;

  let slotEl = $state<HTMLDivElement | null>(null);

  // Set directly on both boxes, not as custom properties: those inherit, so changing one here
  // would restyle the whole chat inside on every pointermove of a resize.
  const size = $derived(`clamp(${RIGHT_SIDEBAR_MIN_WIDTH}px, ${app.rightSidebarRatio * 100}%, 50%)`);

  // Width only animates when the left sidebar's collapse reflows available space; dragging
  // and window resize stay instant. This panel's own open/close is always a side effect of
  // switching chats (see ChatHeader.svelte's `sidePanel` branch), so it always snaps.
  let widthAnimating = $state(false);
  $effect(() => {
    app.sidebarCollapsed;
    widthAnimating = true;
    const duration = Math.round(200 / (app.settings.animationSpeed || 1)) + 30;
    const timer = setTimeout(() => (widthAnimating = false), duration);
    return () => clearTimeout(timer);
  });

  // True briefly after a drag crosses the collapse threshold (mirrors Sidebar.svelte's
  // collapsedByDrag): one eased transition for the crossing, then back to transition:none
  // so the rest of the drag tracks the pointer instead of easing behind it.
  let crossingAnim = $state(false);
  let crossingAnimTimer: ReturnType<typeof setTimeout> | undefined;

  // Measured once per drag, not per pointermove (each read right after a width change forces a
  // synchronous layout).
  let dragBox: DOMRect | null = null;
  function startResize(e: PointerEvent) {
    if (app.rightSidebarCollapsed || !slotEl) return;
    dragBox = (slotEl.parentElement as HTMLElement).getBoundingClientRect();
    app.rightSidebarResizing = true;
    crossingAnim = false;
    clearTimeout(crossingAnimTimer);
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!app.rightSidebarResizing || !dragBox) return;
    // `.content-row`, not the window: this panel is proportional to what's left of the
    // fixed-width left sidebar, not the whole viewport.
    const container = dragBox;
    const fromRight = container.right - e.clientX;
    // Dragging past the minimum collapses outright (same threshold logic as Sidebar.svelte's
    // onResize). rightSidebarRatio is untouched while collapsed, so re-opening restores the
    // same size with no separate "width before drag" to track.
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
    if (!app.rightSidebarResizing) return;
    dragBox = null;
    app.rightSidebarResizing = false;
    document.body.style.cursor = "";
    app.setRightSidebarRatio(app.rightSidebarRatio);
  }
</script>

{#if app.active?.sidebarSessionId}
  <div
    class="right-slot"
    class:resizing={app.rightSidebarResizing}
    class:collapsed={app.rightSidebarCollapsed}
    class:crossing-anim={crossingAnim}
    style:flex-basis={app.rightSidebarCollapsed ? "0px" : size}
    bind:this={slotEl}
  >
    <div
      class="right-sidebar"
      class:width-animating={widthAnimating}
      class:resizing={app.rightSidebarResizing}
      class:collapsed={app.rightSidebarCollapsed}
      style:width={size}
    >
      <ChatPanel sessionId={app.active.sidebarSessionId} ownsChrome sidePanel bind:panelEl />
      {#if !app.rightSidebarCollapsed || app.rightSidebarResizing}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resize-handle"
          class:active={app.rightSidebarResizing}
          onpointerdown={startResize}
          onpointermove={onResize}
          onpointerup={stopResize}
          onpointercancel={stopResize}
        ></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .right-slot {
    flex-shrink: 0;
    /* Same reasoning as `.sidebar-slot` in Sidebar.svelte: flex-basis keeps reflow in lockstep.
       No `position` here since `.right-sidebar` is positioned against `.content-row`, so it
       slides off on collapse instead of shrinking away. */
    transition: flex-basis calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .right-slot.resizing {
    transition: none;
  }
  /* One eased flex-basis change for the collapse-threshold crossing (same as Sidebar.svelte's
     .sidebar-slot.resizing.collapse-anim); dragging keeps transition:none otherwise or every
     pointermove would ease behind the pointer. */
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
  /* A thin centered line within the (invisible, wider) hit area, so hovering
     or dragging telegraphs the exact edge that's about to move without
     nudging any layout width. */
  .resize-handle::after {
    content: "";
    position: absolute;
    top: 0;
    left: 50%;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
    background: transparent;
    transition: background calc(0.1s * var(--anim-speed, 1)) ease;
  }
  .resize-handle:hover::after,
  .resize-handle.active::after {
    background: var(--accent);
  }
</style>

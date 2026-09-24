<script lang="ts">
  // Thin resize/collapse wrapper around a second ChatPanel — the linked chat
  // opened via the "put to the side" button on a session row (Sidebar.svelte
  // / ProjectGroup.svelte) rather than drag and drop. The chat itself is
  // rendered by ChatPanel.svelte, same component and same card styling as the
  // main chat — this file only owns the proportional-width/slide-collapse
  // mechanics, not any chat-shaped markup of its own.
  //
  // Width is entirely the layout's job, not JS's: `.right-slot` (the flex
  // item that reserves space in `.content-row`, next to the main chat) and
  // `.right-sidebar` (the positioned wrapper that slides off on collapse)
  // both size themselves with the same `clamp(min, pct, 50%)` against
  // `.content-row`, their shared containing block (see +page.svelte). State
  // only holds the ratio; resizing the *left* sidebar, collapsing it, or
  // resizing the window all reflow this in the same paint with no JS keeping
  // anything in sync.
  import { app, RIGHT_SIDEBAR_MIN_WIDTH } from "../state.svelte";
  import ChatPanel from "./ChatPanel.svelte";

  // Bindable so +page.svelte can measure this specific ChatPanel's box — the
  // corner handle where this sidebar's own terminal drawer meets its resize
  // handle (bottom-left of the sidebar, once that terminal is open) needs it.
  let { panelEl = $bindable(null) }: { panelEl?: HTMLElement | null } = $props();

  const COLLAPSE_THRESHOLD = 90;

  let slotEl = $state<HTMLDivElement | null>(null);

  const sizeVars = $derived(
    `--right-pct: ${app.rightSidebarRatio * 100}%; --right-min: ${RIGHT_SIDEBAR_MIN_WIDTH}px`,
  );

  // Width only animates while the *left* sidebar's own collapse reflows this
  // one's available space — width changes from dragging (handled by
  // `resizing` below, live for both this panel's own handle and the left
  // sidebar's — CSS does that for free) or from a window resize should be
  // instant/real-time. This panel's own open/close is always a side effect
  // of switching chats now (opening a saved split, or its own header's close
  // button — see ChatHeader.svelte's `sidePanel` branch) rather than a
  // manual toggle of its own, so it always snaps rather than easing.
  let widthAnimating = $state(false);
  $effect(() => {
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
    app.rightSidebarResizing = true;
    crossingAnim = false;
    clearTimeout(crossingAnimTimer);
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!app.rightSidebarResizing || !slotEl) return;
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
    if (!app.rightSidebarResizing) return;
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
    style={sizeVars}
    bind:this={slotEl}
  >
    <div
      class="right-sidebar"
      class:width-animating={widthAnimating}
      class:resizing={app.rightSidebarResizing}
      class:collapsed={app.rightSidebarCollapsed}
      style={sizeVars}
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

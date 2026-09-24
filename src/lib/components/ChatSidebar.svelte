<script lang="ts">
  // A single chat's own right-edge panel — not to be confused with a second,
  // independent *chat* shown side by side (that's ServerState.sidebarSessionId
  // / RightSidebar.svelte, a completely different feature: "split view").
  // This is one chat's own auxiliary view onto itself — its plan, file
  // previews, diffs, snapshots eventually; a placeholder for now. Lives
  // inside ChatPanel.svelte's own `.panel`, docked to its right edge, same
  // per-session open/close as TerminalPanel.svelte and the same
  // clamp(min, ratio%, 50%) resize-against-the-parent trick, just on the
  // horizontal axis.
  import { app, CHAT_SIDEBAR_MIN_WIDTH } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const open = $derived(app.active?.chatSidebarOpenBySession[sessionId] ?? false);

  let resizing = $state(false);
  let slotEl = $state<HTMLDivElement | null>(null);

  const sizeVars = $derived(
    `--chat-sb-pct: ${app.chatSidebarWidthRatio * 100}%; --chat-sb-min: ${CHAT_SIDEBAR_MIN_WIDTH}px`,
  );

  function startResize(e: PointerEvent) {
    if (!open) return;
    resizing = true;
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!resizing || !slotEl) return;
    const container = (slotEl.parentElement as HTMLElement).getBoundingClientRect();
    const fromRight = container.right - e.clientX;
    const clamped = Math.min(container.width * 0.5, Math.max(CHAT_SIDEBAR_MIN_WIDTH, fromRight));
    app.chatSidebarWidthRatio = Math.min(0.5, Math.max(0, clamped / container.width));
  }
  function stopResize() {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = "";
    app.setChatSidebarWidthRatio(app.chatSidebarWidthRatio);
  }
</script>

<div
  class="chat-sidebar-slot"
  class:open
  class:resizing
  style={sizeVars}
  bind:this={slotEl}
>
  <div class="chat-sidebar-body">
    <Icon name="layout-sidebar-right" size={18} />
    <span>Plans, files, diffs — coming soon</span>
  </div>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      onpointerdown={startResize}
      onpointermove={onResize}
      onpointerup={stopResize}
      onpointercancel={stopResize}
    ></div>
  {/if}
</div>

<style>
  .chat-sidebar-slot {
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    width: 0;
    border-left: 1px solid transparent;
    /* Same fill as the chat panel itself, no blur — see TerminalPanel.svelte's
       identical treatment and --panel-bg's own doc comment in app.css. */
    background: var(--panel-bg);
    transition:
      width calc(0.2s * var(--anim-speed, 1)) ease,
      border-color calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .chat-sidebar-slot.open {
    width: clamp(var(--chat-sb-min), var(--chat-sb-pct), 50%);
    border-left-color: var(--panel-border);
  }
  .chat-sidebar-slot.resizing {
    transition: none;
  }
  .chat-sidebar-body {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0 var(--space-2);
    text-align: center;
    color: var(--text-dim);
    font-size: var(--text-body-size);
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

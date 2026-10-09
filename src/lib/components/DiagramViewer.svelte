<script lang="ts">
  // A diagram at full size in a modal <dialog> (top layer, so no ancestor can clip it), with
  // wheel zoom, drag to pan, and double-click to reset. `svg` is already sanitized markup.
  import { downloadSvg } from "../mermaidRender";
  import zoomIn from "@tabler/icons/outline/zoom-in.svg?raw";
  import zoomOut from "@tabler/icons/outline/zoom-out.svg?raw";
  import zoomReset from "@tabler/icons/outline/zoom-reset.svg?raw";
  import download from "@tabler/icons/outline/download.svg?raw";
  import close from "@tabler/icons/outline/x.svg?raw";

  let { svg, onclose }: { svg: string; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  let stage: HTMLDivElement;
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let drag: { x: number; y: number; tx: number; ty: number } | undefined;

  $effect(() => {
    dialog.showModal();
  });

  const MIN = 0.2;
  const MAX = 12;

  // Zoom keeping the point (cx, cy), relative to the stage's center, where it is on screen.
  function zoomAt(factor: number, cx = 0, cy = 0) {
    const next = Math.min(MAX, Math.max(MIN, scale * factor));
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
  }

  function reset() {
    scale = 1;
    tx = ty = 0;
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, tx, ty };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    tx = drag.tx + e.clientX - drag.x;
    ty = drag.ty + e.clientY - drag.y;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-") zoomAt(0.8);
    else if (e.key === "0") reset();
    else return;
    e.preventDefault();
  }
</script>

<!-- Esc closes a modal dialog natively; a click on the backdrop (the dialog itself) closes it too. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<dialog
  bind:this={dialog}
  class="diagram-viewer"
  aria-label="Diagram"
  {onclose}
  {onkeydown}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <div class="bar">
    <button type="button" title="Zoom in" aria-label="Zoom in" onclick={() => zoomAt(1.25)}>{@html zoomIn}</button>
    <button type="button" title="Zoom out" aria-label="Zoom out" onclick={() => zoomAt(0.8)}>{@html zoomOut}</button>
    <button type="button" title="Reset view" aria-label="Reset view" onclick={reset}>{@html zoomReset}</button>
    <button type="button" title="Save as SVG" aria-label="Save as SVG" onclick={() => downloadSvg(svg)}>{@html download}</button>
    <button type="button" title="Close" aria-label="Close" onclick={() => dialog.close()}>{@html close}</button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    bind:this={stage}
    {onwheel}
    {onpointerdown}
    {onpointermove}
    onpointerup={() => (drag = undefined)}
    onpointercancel={() => (drag = undefined)}
    ondblclick={reset}
  >
    <div class="pan" style:transform="translate({tx}px, {ty}px) scale({scale})">{@html svg}</div>
  </div>
</dialog>

<style>
  .diagram-viewer {
    width: min(94vw, 1400px);
    height: min(90vh, 1000px);
    max-width: none;
    max-height: none;
    padding: 0;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--code-bg);
    color: var(--text);
    overflow: hidden;
  }
  .diagram-viewer[open] {
    display: flex;
    flex-direction: column;
  }
  .diagram-viewer::backdrop {
    background: rgb(0 0 0 / 0.55);
  }
  .bar {
    display: flex;
    justify-content: flex-end;
    gap: 0.2rem;
    padding: 0.29rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .bar button:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .bar :global(svg) {
    width: 16px;
    height: 16px;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .stage:active {
    cursor: grabbing;
  }
  .pan {
    transform-origin: center;
  }
  .pan :global(svg) {
    display: block;
    /* Mermaid sizes its SVG to 100% wide with an inline max-width; fill the stage instead. */
    width: min(88vw, 1300px) !important;
    max-width: none !important;
    height: auto;
    max-height: 78vh;
  }
</style>

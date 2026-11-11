<script lang="ts">
  // The fullscreen viewer for one attachment: a picture that flies out of its thumbnail and back,
  // zooms toward the cursor (wheel, double-click, pinch) and pans by dragging; or a PDF in a frame.
  // The parent owns what is open and where it came from; this owns everything that happens while it is.
  import Icon from "./Icon.svelte";

  let { src, name, pdf = false, from, onclose }: { src: string; name: string; pdf?: boolean; from?: Element; onclose: () => void } = $props();

  const DUR = 260;
  const EASE = "cubic-bezier(0.2, 0, 0, 1)";
  const BACKDROP = 0.72;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  let overlay = $state<HTMLElement>();
  let closing = false;

  // The picture travels between its thumbnail and its full size (FLIP: both ends are measured, so it
  // holds at any window size and zoom).
  const fly = (img: Element, thumb: Element, back = false) => {
    const a = thumb.getBoundingClientRect(), b = img.getBoundingClientRect();
    const start = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    return img.animate({ transform: back ? ["none", start] : [start, "none"] }, { duration: DUR, easing: EASE, fill: "both" }).finished;
  };
  // Backdrop and close button fade; the flying picture itself stays solid.
  const fadeChrome = (node: HTMLElement, a: number, b: number) => {
    const o = { duration: DUR, easing: EASE, fill: "both" as const };
    node.querySelector(".close")?.animate({ opacity: [a, b] }, o);
    return node.animate({ backgroundColor: [`rgba(0,0,0,${BACKDROP * a})`, `rgba(0,0,0,${BACKDROP * b})`] }, o).finished;
  };

  // Re-parents the node to <body>: a `position: fixed` overlay inside a transformed/contained
  // ancestor (the message list) is clipped to it instead of covering the window. Then plays the entrance.
  const enter = (node: HTMLElement) => {
    document.body.appendChild(node);
    if (!reduced()) {
      const img = node.querySelector("img");
      if (img && from) {
        void fadeChrome(node, 0, 1);
        // The full picture is usually decoded already (the parent warms it up); this covers the rest.
        const drawn = img.complete ? Promise.resolve() : img.decode().catch(() => {});
        void drawn.then(() => fly(img, from).catch(() => {}));
      } else node.animate({ opacity: [0, 1] }, { duration: DUR, easing: EASE });
    }
    return () => node.remove();
  };

  async function close() {
    if (closing) return;
    closing = true;
    resetView(); // so the flight home starts from the fitted size, not the zoomed one
    if (overlay && !reduced()) {
      const img = overlay.querySelector("img");
      const flying = img && from?.isConnected;
      const backdrop = flying ? fadeChrome(overlay, 1, 0) : overlay.animate({ opacity: [1, 0] }, { duration: DUR, easing: EASE, fill: "forwards" }).finished;
      await Promise.all([backdrop, flying ? fly(img, from!, true) : 0]).catch(() => {});
    }
    onclose();
  }

  // Zoom and pan. The picture fits the window at zoom 1; the transform is on the stage because the
  // flight animation owns the img's own.
  const MINZ = 1, MAXZ = 12, DOUBLE_CLICK_ZOOM = 3;
  let zoom = $state(1);
  let panX = $state(0), panY = $state(0);
  let panning = $state(false);
  let moved = false; // the last gesture dragged or pinched, so its click must not close the viewer

  const resetView = () => {
    zoom = MINZ;
    panX = panY = 0;
  };
  // Keep the picture roughly on screen: allow up to half of it to extend past each edge (client sizes
  // are layout sizes, so zoom doesn't distort them).
  function clampPan() {
    const img = overlay?.querySelector("img");
    if (!img || !overlay) return;
    const mw = Math.max(0, (img.clientWidth * zoom - overlay.clientWidth) / 2);
    const mh = Math.max(0, (img.clientHeight * zoom - overlay.clientHeight) / 2);
    panX = Math.min(mw, Math.max(-mw, panX));
    panY = Math.min(mh, Math.max(-mh, panY));
  }
  // Zooms to `next` keeping the point under (x, y) where it is. The stage sits at the window's centre.
  function zoomAt(next: number, x: number, y: number) {
    if (!overlay) return;
    next = Math.min(MAXZ, Math.max(MINZ, next));
    if (next === zoom) return;
    const cx = x - overlay.clientWidth / 2, cy = y - overlay.clientHeight / 2;
    const k = next / zoom;
    panX = cx * (1 - k) + panX * k;
    panY = cy * (1 - k) + panY * k;
    zoom = next;
    if (zoom === MINZ) resetView();
    else clampPan();
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    zoomAt(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY);
  }
  function ondblclick(e: MouseEvent) {
    e.stopPropagation();
    if (zoom > MINZ) resetView();
    else zoomAt(DOUBLE_CLICK_ZOOM, e.clientX, e.clientY);
  }

  // Pointers down on the stage: one drags the picture, two pinch it.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  function onpointerdown(e: PointerEvent) {
    if (pointers.size === 0) moved = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      pinchDist = spread().dist;
      moved = true;
    }
    panning = pointers.size === 1 && zoom > MINZ;
  }
  function onpointermove(e: PointerEvent) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const s = spread();
      if (pinchDist) zoomAt(zoom * (s.dist / pinchDist), s.x, s.y);
      pinchDist = s.dist;
    } else if (panning) {
      if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
      panX += dx;
      panY += dy;
      clampPan();
    }
  }
  function onpointerup(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    panning = pointers.size === 1 && zoom > MINZ;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" role="presentation" bind:this={overlay} {@attach enter} onclick={close}>
  <!-- Escape never reaches the page once focus is inside the PDF frame, and a phone has no Escape. -->
  <button type="button" class="close" aria-label="Close" onclick={close}><Icon name="xmark" size={14} /></button>
  {#if pdf}
    <iframe title={name} {src} onclick={(e) => e.stopPropagation()}></iframe>
  {:else}
    <div
      class="stage"
      class:zoomed={zoom > MINZ}
      class:panning
      style:transform={`translate(${panX}px, ${panY}px) scale(${zoom})`}
      {onwheel}
      {ondblclick}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
      onclick={(e) => (zoom > MINZ || moved ? e.stopPropagation() : 0)}
    >
      <img {src} alt={name} />
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 2rem;
    background: rgba(0, 0, 0, 0.72);
    cursor: zoom-out;
    /* Panning must never grow it or scroll the page behind. */
    overflow: hidden;
  }
  .close {
    position: absolute;
    top: max(0.29rem, env(safe-area-inset-top));
    right: max(0.29rem, env(safe-area-inset-right));
    display: grid;
    place-items: center;
    width: 1.71rem;
    height: 1.71rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    cursor: pointer;
  }
  .close:hover {
    background: rgba(0, 0, 0, 0.75);
  }
  .stage {
    display: grid;
    place-items: center;
    /* Pinch and drag gestures stay ours while the viewer is open. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    max-width: 100%;
    max-height: 100%;
  }
  .stage.zoomed {
    cursor: grab;
  }
  .stage.panning {
    cursor: grabbing;
  }
  img {
    transform-origin: 0 0;
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
    /* Percentage maxima fail when an ancestor track sizes to content, so pin them to the viewport
       minus the overlay's padding. */
    max-width: calc(100vw - 4rem);
    max-height: calc(100vh - 4rem);
  }
  iframe {
    width: min(60rem, 100%);
    height: 100%;
    border: none;
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: auto;
  }
</style>

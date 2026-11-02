<script lang="ts">
  // The files a sent message carried, each shown for what it is: pictures as thumbnails that open
  // larger, video and audio as players, a PDF in a viewer, anything else as a typed chip. The bytes
  // are read back from the server (read_media with the chat's id), so they show after a restart
  // and from any device, not only where they were picked.
  import { onDestroy } from "svelte";
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import { readMedia } from "../ipc";
  import { basename } from "../format";
  import { fileIconUrl } from "../fileIcons";
  import Icon from "./Icon.svelte";

  const DUR = 260;
  const EASE = "cubic-bezier(0.2, 0, 0, 1)";
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The picture travels between its thumbnail and its full size (FLIP: both ends are measured, so it
  // holds at any window size and zoom). The slot it leaves stays in the message, marked "expanded".
  const fly = (img: Element, thumb: Element, back = false) => {
    const a = thumb.getBoundingClientRect(), b = img.getBoundingClientRect();
    const from = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    return img.animate({ transform: back ? ["none", from] : [from, "none"] }, { duration: DUR, easing: EASE, fill: "both" }).finished;
  };
  const fade = (node: HTMLElement, ...[a, b]: [number, number]) => {
    const o = { duration: DUR, easing: EASE, fill: "both" as const };
    const ba = node.animate({ backgroundColor: ["rgba(0,0,0," + 0.72 * a + ")", "rgba(0,0,0," + 0.72 * b + ")"] }, o);
    node.querySelector(".close")?.animate({ opacity: [a, b] }, o);
    return ba.finished;
  };
  // Re-parents the node to <body>: a `position: fixed` overlay inside a transformed/contained
  // ancestor (the message list) is clipped to it instead of covering the window. Then plays the entrance.
  const overlayIn = (node: HTMLElement) => {
    document.body.appendChild(node);
    const img = node.querySelector("img"), from = thumb;
    if (!reduced()) {
      // Flying picture: fade only the backdrop and button, the picture itself stays solid.
      if (img && from) {
        fade(node, 0, 1);
        // The full picture is usually already decoded (expand warms it up, so the
        // thumbnail stays visible meanwhile); this only covers the leftover case.
        const drawn = img.complete ? Promise.resolve() : img.decode().catch(() => {});
        drawn.then(() => { void fly(img, from); });
      } else node.animate({ opacity: [0, 1] }, { duration: DUR, easing: EASE });
    }
    return () => node.remove();
  };

  let { paths, sessionId }: { paths: string[]; sessionId: string } = $props();

  type Kind = "image" | "video" | "audio" | "pdf" | "file";
  const KINDS: [Kind, RegExp][] = [
    ["image", /\.(png|jpe?g|jfif|gif|webp|avif|apng|bmp|svg)$/i],
    ["video", /\.(mp4|m4v|webm|ogv|mov)$/i],
    ["audio", /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac)$/i],
    ["pdf", /\.pdf$/i],
  ];
  const kindOf = (path: string): Kind => KINDS.find(([, re]) => re.test(path))?.[0] ?? "file";

  // path -> object URL, or "" while loading, or null when the server wouldn't give it.
  // `urls` is the original (opened full-size); `thumbs` is the small preview the
  // server generates for stored images, so a chat doesn't download 20 MB to
  // draw a chip.
  let urls = $state<Record<string, string | null>>({});
  let thumbs = $state<Record<string, string | null>>({});
  let viewing = $state<string | null>(null);
  let thumb: Element | undefined; // the thumbnail the viewer grew out of, if any
  let overlay = $state<HTMLElement>();
  let closing = false;

  // Zoom and pan of the open picture. The picture fits the window at zoom 1;
  // the wheel zooms toward the cursor, dragging pans, double-click toggles fit
  // and 3x.
  const MINZ = 1, MAXZ = 12;
  let zoom = $state(1);
  let panX = $state(0), panY = $state(0);
  let panning = $state(false), moved = false;
  let dragId: number, dragX = 0, dragY = 0, baseX = 0, baseY = 0;
  const resetView = () => {
    zoom = MINZ;
    panX = panY = 0;
    moved = false;
  };
  // Keep the picture roughly on screen: allow up to its half extending past
  // each edge (client sizes are layout sizes, so zoom doesn't distort them).
  function clampPan() {
    const img = overlay?.querySelector("img");
    if (!img || !overlay) return;
    const mw = Math.max(0, (img.clientWidth * zoom - overlay.clientWidth) / 2);
    const mh = Math.max(0, (img.clientHeight * zoom - overlay.clientHeight) / 2);
    panX = Math.min(mw, Math.max(-mw, panX));
    panY = Math.min(mh, Math.max(-mh, panY));
  }
  function onwheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const w = e.currentTarget as HTMLElement;
    const next = Math.min(MAXZ, Math.max(MINZ, zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    if (next === zoom) return;
    // Zoom toward the cursor: the point under it must stay there.
    const cx = e.clientX - w.clientWidth / 2, cy = e.clientY - w.clientHeight / 2;
    panX += cx * (1 - next / zoom);
    panY += cy * (1 - next / zoom);
    zoom = next;
    if (zoom === MINZ) resetView(); else clampPan();
  }
  function ondblclick(e: MouseEvent) {
    e.stopPropagation();
    if (zoom > MINZ) {
      resetView();
      return;
    }
    const w = e.currentTarget as HTMLElement;
    zoom = 3;
    const cx = e.clientX - w.clientWidth / 2, cy = e.clientY - w.clientHeight / 2;
    panX += cx * (1 - 3);
    panY += cy * (1 - 3);
    clampPan();
  }
  function onpointerdown(e: PointerEvent) {
    if (zoom <= MINZ || panning) return;
    panning = true;
    moved = false;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    baseX = panX;
    baseY = panY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent) {
    if (!panning || e.pointerId !== dragId) return;
    const dx = e.clientX - dragX, dy = e.clientY - dragY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    panX = baseX + dx;
    panY = baseY + dy;
    clampPan();
  }
  function onpointerup(e: PointerEvent) {
    if (e.pointerId !== dragId) return;
    panning = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }

  async function expand(path: string, button: HTMLElement) {
    thumb = button.querySelector("img") ?? undefined;
    await load(path);
    const url = urls[path];
    if (!url) return;
    // Warm the decode of the full picture before the viewer opens: the flying
    // picture is then fully drawn on its first frame, and the thumbnail keeps
    // its place in the message until then instead of leaving an empty slot.
    // (Otherwise a big image blinks: the slot empties while the overlay shows
    // a half-loaded, half-positioned frame.)
    const probe = new Image();
    probe.src = url;
    await probe.decode().catch(() => {});
    resetView();
    viewing = path;
  }
  async function close() {
    if (!viewing || closing) return;
    closing = true;
    resetView(); // so the flight home starts from the fitted size, not the zoomed one
    const img = overlay?.querySelector("img");
    if (overlay && !reduced()) {
      const flying = img && thumb?.isConnected;
      const backdrop = flying ? fade(overlay, 1, 0) : overlay.animate({ opacity: [1, 0] }, { duration: DUR, easing: EASE, fill: "forwards" }).finished;
      await Promise.all([backdrop, flying ? fly(img, thumb!, true) : 0]).catch(() => {});
    }
    viewing = null;
    thumb = undefined;
    closing = false;
  }

  async function read(path: string, thumb: boolean): Promise<string | null> {
    const cid = app.activeConnectionId;
    const project = app.active?.projectBySession[sessionId];
    const r = cid && project ? await readMedia(cid, project, path, sessionId, thumb).catch(() => null) : null;
    return r && "url" in r ? r.url : null;
  }
  async function load(path: string) {
    if (path in urls) return;
    urls[path] = "";
    urls[path] = await read(path, false);
  }
  async function loadThumb(path: string) {
    if (path in thumbs) return;
    thumbs[path] = "";
    thumbs[path] = await read(path, true);
  }
  // A picture's preview loads as the message appears; its original (and any
  // video, audio or PDF) waits until it is opened.
  $effect(() => {
    for (const p of paths) if (kindOf(p) === "image") void loadThumb(p);
  });
  onDestroy(() => {
    for (const u of Object.values(urls)) if (u) URL.revokeObjectURL(u);
    for (const u of Object.values(thumbs)) if (u) URL.revokeObjectURL(u);
  });

  async function open(path: string) {
    await load(path);
    if (urls[path]) viewing = path;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<ul class="attachments">
  {#each paths as path (path)}
    {@const kind = kindOf(path)}
    {@const url = urls[path]}
    {@const preview = thumbs[path]}
    {@const name = basename(path)}
    <li class={kind}>
      {#if kind === "image" && preview}
        <button type="button" class="shot" class:expanded={viewing === path} aria-label="Open {name} larger" {@attach tip(path)} onclick={(e) => expand(path, e.currentTarget)}>
          <img src={preview} alt={name} />
          {#if viewing === path}<span class="slot">expanded</span>{/if}
        </button>
      {:else if kind === "image" && preview !== null}
        <span class="shot pending" aria-label="Loading {name}"></span>
      {:else if (kind === "video" || kind === "audio") && url}
        <!-- svelte-ignore a11y_media_has_caption -->
        {#if kind === "video"}
          <video src={url} controls preload="metadata"></video>
        {:else}
          <audio src={url} controls preload="metadata"></audio>
        {/if}
      {:else}
        {@const playable = kind === "video" || kind === "audio"}
        <button
          type="button"
          class="chip"
          disabled={kind === "file" || kind === "image" || url === null}
          {@attach tip(url === null ? `${path} (not available)` : path)}
          onclick={() => (playable ? load(path) : open(path))}
        >
          {#if playable}<Icon name="player-play" size={12} />{:else}<img class="ficon" src={fileIconUrl(name)} alt="" />{/if}
          <span class="name">{name}</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

{#if viewing && urls[viewing]}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" role="presentation" bind:this={overlay} {@attach overlayIn} onclick={close}>
    <!-- Escape never reaches the page once focus is inside the PDF frame, and a phone has no Escape. -->
    <!-- Escape never reaches the page once focus is inside the PDF frame, and a phone has no Escape. -->
    <button type="button" class="close" aria-label="Close" onclick={close}><Icon name="xmark" size={14} /></button>
    {#if kindOf(viewing) === "pdf"}
      <iframe title={basename(viewing)} src={urls[viewing]} onclick={(e) => e.stopPropagation()}></iframe>
    {:else}
      <!-- Wrapped in a stage: the FLIP animation owns the img's transform, so zoom
           and pan live on the parent. -->
      <div
        class="stage"
        class:zoomed={zoom > MINZ}
        class:panning
        style:transform={`translate(${panX}px, ${panY}px) scale(${zoom})`}
        onwheel={onwheel}
        ondblclick={ondblclick}
        onpointerdown={onpointerdown}
        onpointermove={onpointermove}
        onpointerup={onpointerup}
        onpointercancel={onpointerup}
        onclick={(e) => (zoom > MINZ || moved ? e.stopPropagation() : 0)}
      >
        <img src={urls[viewing]} alt={basename(viewing)} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .attachments {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.29rem;
    margin: 0.29rem 0 0;
    padding: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    max-width: 16rem;
    padding: 0.14rem 0.5rem;
    background: none;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-pill);
    font-size: var(--text-label-size);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chip:disabled {
    cursor: default;
  }
  .chip:not(:disabled):hover {
    color: var(--text);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ficon {
    width: 0.93rem;
    height: 0.93rem;
    flex-shrink: 0;
  }
  .shot {
    position: relative;
    display: block;
    padding: 0;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: none;
    overflow: hidden;
    cursor: zoom-in;
    line-height: 0;
  }
  .shot.expanded {
    cursor: default;
  }
  .shot.expanded img {
    visibility: hidden;
  }
  /* What the thumbnail leaves behind while its picture is out: same size, so the message doesn't shift. */
  .slot {
    position: absolute;
    inset: 0.43rem;
    display: grid;
    place-items: center;
    border: 1px dashed var(--text-dim);
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    line-height: 1.2;
    color: var(--text-dim);
  }
  .shot.pending {
    width: 6rem;
    height: 4.5rem;
    background: var(--wash-2);
    cursor: default;
  }
  .shot img {
    display: block;
    max-width: 14rem;
    max-height: 10rem;
  }
  video {
    max-width: 18rem;
    max-height: 12rem;
    border-radius: var(--radius-sm);
  }
  audio {
    height: 2rem;
    max-width: 18rem;
  }
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
    /* Two-pointer gestures (pinch, scroll) stay ours while the viewer is open. */
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
  .overlay img {
    transform-origin: 0 0;
    max-width: 100%;
    max-height: 100%;
    /* Percentage maxima fail when an ancestor track sizes to content, so also
       pin them to the viewport minus the overlay's padding. */
    max-width: calc(100vw - 4rem);
    max-height: calc(100vh - 4rem);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  }
  .overlay iframe {
    width: min(60rem, 100%);
    height: 100%;
    border: none;
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: auto;
  }
</style>

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
  import ImageViewer from "./ImageViewer.svelte";

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
  let thumb = $state<Element>(); // the thumbnail the viewer grows out of, if any
  const viewSrc = $derived(viewing ? urls[viewing] : null);

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
    viewing = path;
  }
  async function read(path: string, small: boolean): Promise<string | null> {
    const cid = app.activeConnectionId;
    const project = app.active?.projectBySession[sessionId];
    const r = cid && project ? await readMedia(cid, project, path, sessionId, small).catch(() => null) : null;
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

{#if viewing && viewSrc}
  <ImageViewer
    src={viewSrc}
    name={basename(viewing)}
    pdf={kindOf(viewing) === "pdf"}
    from={thumb}
    onclose={() => {
      viewing = null;
      thumb = undefined;
    }}
  />
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
</style>

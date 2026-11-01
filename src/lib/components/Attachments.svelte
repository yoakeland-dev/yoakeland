<script lang="ts">
  // The files a sent message carried, each shown for what it is: pictures as thumbnails that open
  // larger, video and audio as players, a PDF in a viewer, anything else as a typed chip. The bytes
  // are read back from the server (read_media with the chat's id), so they show after a restart
  // and from any device, not only where they were picked.
  import { fade } from "svelte/transition";
  import { onDestroy } from "svelte";
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import { readMedia } from "../ipc";
  import { basename } from "../format";
  import { fileIconUrl } from "../fileIcons";
  import Icon from "./Icon.svelte";

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
  let urls = $state<Record<string, string | null>>({});
  let viewing = $state<string | null>(null);

  async function load(path: string) {
    if (path in urls) return;
    urls[path] = "";
    const cid = app.activeConnectionId;
    const project = app.active?.projectBySession[sessionId];
    const r = cid && project ? await readMedia(cid, project, path, sessionId).catch(() => null) : null;
    urls[path] = r && "url" in r ? r.url : null;
  }
  // Pictures load as the message appears; video, audio and PDFs wait to be asked for.
  $effect(() => {
    for (const p of paths) if (kindOf(p) === "image") void load(p);
  });
  onDestroy(() => {
    for (const u of Object.values(urls)) if (u) URL.revokeObjectURL(u);
  });

  async function open(path: string) {
    await load(path);
    if (urls[path]) viewing = path;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && viewing && (viewing = null)} />

<ul class="attachments">
  {#each paths as path (path)}
    {@const kind = kindOf(path)}
    {@const url = urls[path]}
    {@const name = basename(path)}
    <li class={kind}>
      {#if kind === "image" && url}
        <button type="button" class="shot" aria-label="Open {name} larger" {@attach tip(path)} onclick={() => (viewing = path)}>
          <img src={url} alt={name} />
        </button>
      {:else if kind === "image" && url === ""}
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
  <div class="overlay" role="presentation" transition:fade={{ duration: 120 }} onclick={() => (viewing = null)}>
    {#if kindOf(viewing) === "pdf"}
      <iframe title={basename(viewing)} src={urls[viewing]} onclick={(e) => e.stopPropagation()}></iframe>
    {:else}
      <img src={urls[viewing]} alt={basename(viewing)} />
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
    display: block;
    padding: 0;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: none;
    overflow: hidden;
    cursor: zoom-in;
    line-height: 0;
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
  }
  .overlay img {
    max-width: 100%;
    max-height: 100%;
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

<script lang="ts">
  // What a tool showed the model (a browser screenshot): thumbnails under the call, each opening larger.
  import { fade } from "svelte/transition";
  import type { ToolImage } from "../types";

  let { images }: { images: ToolImage[] } = $props();
  let open = $state<number | null>(null);
  const src = (i: ToolImage) => `data:${i.mimeType};base64,${i.data}`;
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && open !== null && (open = null)} />

<div class="shots">
  {#each images as img, i (i)}
    <button type="button" class="shot" aria-label="Open the screenshot larger" onclick={() => (open = i)}>
      <img src={src(img)} alt="What the agent saw" />
    </button>
  {/each}
</div>

{#if open !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" role="presentation" transition:fade={{ duration: 120 }} onclick={() => (open = null)}>
    <img src={src(images[open])} alt="What the agent saw" />
  </div>
{/if}

<style>
  .shots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.43rem;
    padding: 0 0.71rem 0.57rem;
  }
  .shot {
    padding: 0;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: none;
    overflow: hidden;
    cursor: zoom-in;
    line-height: 0;
  }
  .shot img {
    max-height: 11rem;
    max-width: 100%;
    display: block;
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
</style>

<script lang="ts">
  import { tip } from "../tooltip.svelte";

  // One line per user prompt, the one nearest the viewport middle lit. Many prompts scroll in place.
  let { items, activeId, onpick }: { items: { id: string; text: string }[]; activeId: string | undefined; onpick: (id: string) => void } = $props();
</script>

<div class="minimap">
  {#each items as item (item.id)}
    <button class="tick" class:active={item.id === activeId} aria-label={item.text} onclick={() => onpick(item.id)} {@attach tip(item.text, { side: "right", instant: true, large: true })}>
      <span></span>
    </button>
  {/each}
</div>

<style>
  .minimap {
    position: absolute;
    left: 4px;
    top: calc(var(--header-height) + 20px);
    /* Fixed, not tied to --composer-height: that shrinks when scrolled up and would re-centre the ticks. */
    bottom: 150px;
    width: 18px;
    display: flex;
    flex-direction: column;
    /* safe: starts at the top once the ticks overflow, so none are unreachable. */
    justify-content: safe center;
    overflow-y: auto;
    scrollbar-width: none;
    z-index: 2;
  }
  .tick {
    flex: none;
    height: 10px;
    display: flex;
    align-items: center;
    padding: 0 3px 0 0;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .tick span {
    width: 100%;
    height: 2px;
    border-radius: 1px;
    background: var(--text-dim);
    transform-origin: left center;
    opacity: 0.4;
    transition: transform calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .tick:hover span {
    opacity: 0.8;
    transform: scale(1.4, 2);
  }
  .tick.active span {
    background: var(--accent);
    opacity: 1;
  }
</style>

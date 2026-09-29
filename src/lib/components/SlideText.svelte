<script lang="ts">
  // Text that rolls vertically when it changes: the old text slides and fades out while the
  // new one slides in from the other side, and the box eases to the new width, so whatever
  // sits next to it moves with it. `dir` 1 rolls upward, -1 downward. Two layers swap roles
  // on every change, so the animations are plain CSS with nothing to clean up.
  import { untrack } from "svelte";

  let { text, dir = 1 }: { text: string; dir?: number } = $props();

  let layers = $state(untrack(() => [text, ""]));
  let widths = $state([0, 0]);
  let cur = $state(0);
  let changed = $state(false);
  let ready = $state(false);
  let last = untrack(() => text);

  $effect(() => {
    if (text === last) return;
    last = text;
    cur = 1 - cur;
    layers[cur] = text;
    changed = true;
  });

  // The first measurement shouldn't animate the box up from zero.
  $effect(() => {
    if (widths[cur] && !ready) requestAnimationFrame(() => (ready = true));
  });
</script>

<span class="slide" class:ready style:--dir={dir} style:width={widths[cur] ? `${widths[cur]}px` : undefined}>
  {#each layers as layer, i (i)}
    <span class="layer" class:in={i === cur} class:out={i !== cur} class:changed bind:offsetWidth={widths[i]} aria-hidden={i !== cur}>
      {layer}
    </span>
  {/each}
</span>

<style>
  .slide {
    position: relative;
    display: inline-block;
    height: 1.35em;
    overflow: hidden;
    vertical-align: bottom;
  }
  .slide.ready {
    transition: width calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    display: inline-flex;
    align-items: baseline;
    white-space: nowrap;
  }
  .layer.out:not(.changed) {
    visibility: hidden;
  }
  .layer.changed.in {
    animation: roll-in calc(0.2s * var(--anim-speed, 1)) ease-out both;
  }
  .layer.changed.out {
    animation: roll-out calc(0.2s * var(--anim-speed, 1)) ease-in both;
  }
  @keyframes roll-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--dir) * 9px));
    }
  }
  @keyframes roll-out {
    to {
      opacity: 0;
      transform: translateY(calc(var(--dir) * -9px));
    }
  }
</style>

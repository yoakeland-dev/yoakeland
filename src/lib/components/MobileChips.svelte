<script lang="ts" generics="T extends string">
  // Filter chips as one draggable pill. Two identical layers: the plain chips below, and above them
  // the accent copy, clipped to the selected chip. Tapping moves the clip (260ms, ease-out); dragging
  // moves it with the finger and, on release, it settles on the nearest chip with a little momentum.
  import { untrack } from "svelte";
  import { swipe } from "../gestures";

  let { items, value = $bindable() }: { items: { id: T; label: string; n?: number; warn?: boolean }[]; value: T } = $props();

  let box: HTMLElement;
  let dragging = $state(false);
  let clip = $state("");
  const cur = () => Math.max(0, items.findIndex((i) => i.id === value));
  const chips = () => [...box.querySelectorAll<HTMLElement>(".cl:not(.ov) .chip")];
  const rect = (b: HTMLElement): [number, number] => [b.offsetLeft, b.offsetLeft + b.offsetWidth];
  const inset = (l: number, r: number) => (clip = `inset(0 ${box.clientWidth - r}px 0 ${l}px round 999px)`);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

  function sync() {
    const b = chips()[cur()];
    if (b && !dragging) inset(...rect(b));
  }
  $effect(() => {
    value;
    items.length;
    untrack(sync);
  });
  $effect(() => {
    const ro = new ResizeObserver(() => untrack(sync));
    ro.observe(box);
    chips().forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  });

  let l0 = 0;
  let w0 = 0;
  let lo = 0;
  let hi = 0;
  const opts = {
    axis: "x",
    // Only a drag that starts on the lit chip grabs the pill.
    start: (e: PointerEvent) => {
      const r = chips()[cur()].getBoundingClientRect();
      return e.clientX >= r.left - 6 && e.clientX <= r.right + 6;
    },
    onMove: (m: number) => {
      if (!dragging) {
        const cs = chips();
        [l0, w0] = [rect(cs[cur()])[0], cs[cur()].offsetWidth];
        lo = rect(cs[0])[0];
        hi = rect(cs[cs.length - 1])[1];
        dragging = true;
      }
      const l = clamp(l0 + m, lo, hi - w0);
      inset(l, l + w0);
    },
    onEnd: (m: number, v: number) => {
      const mid = clamp(l0 + m + v * 90, lo, hi - w0) + w0 / 2;
      let best = 0;
      let bd = Infinity;
      chips().forEach((c, i) => {
        const [a, z] = rect(c);
        const d = Math.abs((a + z) / 2 - mid);
        if (d < bd) [best, bd] = [i, d];
      });
      dragging = false;
      value = items[best].id;
      sync();
    },
    onCancel: () => ((dragging = false), sync()),
  } as const;
</script>

{#snippet chip(i: (typeof items)[number], overlay: boolean)}
  <button
    type="button"
    class="chip"
    class:on={overlay}
    class:warn={i.warn && !!i.n}
    role={overlay ? undefined : "tab"}
    aria-selected={overlay ? undefined : value === i.id}
    tabindex={overlay ? -1 : undefined}
    onclick={overlay ? undefined : () => (value = i.id)}
  >
    {i.label}{#if i.n}<span class="n">{i.n}</span>{/if}
  </button>
{/snippet}

<div class="chips" class:drag={dragging} role="tablist" aria-label="Filter" bind:this={box} {@attach swipe(() => opts)}>
  <div class="cl">{#each items as i (i.id)}{@render chip(i, false)}{/each}</div>
  <div class="cl ov" style:clip-path={clip} aria-hidden="true" inert>{#each items as i (i.id)}{@render chip(i, true)}{/each}</div>
</div>

<style>
  .chips {
    position: relative;
    margin: var(--space-half) 0 var(--space-1);
    padding: 0 var(--space-2);
    touch-action: pan-y;
    user-select: none;
  }
  .cl {
    display: flex;
    gap: var(--space-1);
  }
  .ov {
    position: absolute;
    inset: 0;
    padding: 0 var(--space-2);
    pointer-events: none;
    transition: clip-path calc(0.26s * var(--anim-speed, 1)) cubic-bezier(0.23, 1, 0.32, 1);
  }
  .chips.drag .ov {
    transition: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    position: relative;
    height: 2.6rem;
    padding: 0 1.1rem;
    border-radius: var(--radius-pill);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    color: var(--text-dim);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 500;
    white-space: nowrap;
    transition: transform calc(0.16s * var(--anim-speed, 1)) cubic-bezier(0.23, 1, 0.32, 1);
  }
  /* A little more hit area than the pill shows. */
  .chip::after {
    content: "";
    position: absolute;
    inset: -2px;
  }
  .chip:active {
    transform: scale(0.97);
  }
  .chip.on {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg));
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent);
  }
  .n {
    font-size: 0.8em;
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
  }
  .chip.warn:not(.on) .n {
    color: var(--warning);
    opacity: 1;
  }
</style>

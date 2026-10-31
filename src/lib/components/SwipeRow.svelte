<script lang="ts" module>
  import type { ComponentProps } from "svelte";
  import Icon from "./Icon.svelte";
  export interface SwipeAct {
    label: string;
    icon: ComponentProps<typeof Icon>["name"];
    run: () => void;
    danger?: boolean;
  }
  // One row open at a time.
  let openRow: (() => void) | null = null;
</script>

<script lang="ts">
  // A list row that slides left to show actions. Drag past half the width, or flick, to fire the last
  // one: the row leaves, then the gap closes. A tap on a revealed button fires it too.
  import type { Snippet } from "svelte";
  import { swipe, ownsHorizontalDrag } from "../gestures";
  import { haptic } from "../haptics";

  let { actions, children }: { actions: SwipeAct[]; children: Snippet } = $props();

  let wrap: HTMLElement;
  let acts: HTMLElement;
  let x = $state(0);
  let open = $state(false);
  let dragging = $state(false);
  let gone = $state(false);
  let h = $state<number | null>(null);

  const width = () => acts.offsetWidth;
  function settle(to: number) {
    x = to;
    open = to !== 0;
    dragging = false;
    if (open) {
      if (openRow && openRow !== close) openRow();
      openRow = close;
    } else if (openRow === close) openRow = null;
  }
  function close() {
    if (open) settle(0);
  }
  async function fire(a: SwipeAct) {
    if (gone) return;
    haptic();
    if (openRow === close) openRow = null;
    h = wrap.offsetHeight;
    gone = true;
    await new Promise((r) => setTimeout(r, 200));
    h = 0;
    await new Promise((r) => setTimeout(r, 240));
    a.run();
  }
  const opts = {
    axis: "x",
    start: (e: PointerEvent) => {
      if (openRow && openRow !== close) openRow();
      return !gone && !ownsHorizontalDrag(e.target, wrap);
    },
    accept: (d: number) => d < 0 || open,
    onMove: (d: number) => ((dragging = true), (x = Math.min(0, (open ? -width() : 0) + d))),
    onEnd: (d: number, v: number) => {
      const at = Math.min(0, (open ? -width() : 0) + d);
      if (at < -wrap.offsetWidth * 0.55 || v < -0.9) fire(actions[actions.length - 1]);
      else settle(at < -width() / 2 || v < -0.4 ? -width() : 0);
    },
    onCancel: () => settle(open ? -width() : 0),
  } as const;
</script>

<!-- A tap anywhere else puts an open row away. -->
<svelte:window onpointerdowncapture={(e) => open && !wrap.contains(e.target as Node) && close()} />

<div class="wrap" bind:this={wrap} style:height={h === null ? null : `${h}px`} class:closing={h !== null}>
  <div class="acts" bind:this={acts}>
    {#each actions as a (a.label)}
      <button type="button" class="act" class:danger={a.danger} tabindex={open ? 0 : -1} aria-label={a.label} onclick={() => fire(a)}>
        <Icon name={a.icon} size={20} />{a.label}
      </button>
    {/each}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="slide"
    class:dragging
    class:gone
    style:transform={gone ? "translateX(-100%)" : x ? `translateX(${x}px)` : null}
    {@attach swipe(() => opts)}
    onclickcapture={(e) => {
      if (open) (e.stopPropagation(), e.preventDefault(), settle(0));
    }}
  >
    {@render children()}
  </div>
</div>

<style>
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .wrap {
    position: relative;
    overflow: hidden;
    touch-action: pan-y;
    animation: rise calc(0.22s * var(--anim-speed, 1)) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  }
  .wrap.closing {
    transition: height calc(0.24s * var(--anim-speed, 1)) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  }
  /* Hairline between rows, inset past the lamp; it stays put while the row slides. */
  .wrap::after {
    content: "";
    position: absolute;
    left: 3.25rem;
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--wash-2);
    pointer-events: none;
  }
  .wrap:last-child::after {
    display: none;
  }
  .acts {
    position: absolute;
    inset: 0 0 0 auto;
    display: flex;
  }
  .act {
    width: 5.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    border: 0;
    background: var(--wash-3);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
  }
  .act:last-child {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg));
    color: var(--accent);
  }
  .act.danger {
    background: color-mix(in srgb, var(--danger) 18%, var(--bg));
    color: var(--danger);
  }
  .slide {
    position: relative;
    background: var(--bg);
    transition: transform calc(0.28s * var(--anim-speed, 1)) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  }
  .slide.dragging {
    transition: none;
  }
  .slide.gone {
    transition-duration: calc(0.2s * var(--anim-speed, 1));
  }
  @media (prefers-reduced-motion: reduce) {
    .wrap {
      animation: none;
    }
  }
</style>

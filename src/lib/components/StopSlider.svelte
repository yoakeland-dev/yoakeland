<script lang="ts">
  // A pill track with a ball that sits on one of a few named stops. Press or drag to move it;
  // while dragging the ball leans a little toward the pointer. It eases to its stop at the
  // app's animation speed. The effort and mode pickers are both this.
  import { untrack } from "svelte";
  import { app } from "../state.svelte";

  let {
    stops,
    index,
    defaultIndex,
    hot = false,
    dim = false,
    label,
    onchange,
    onhover,
  }: {
    /** One per stop: the short name shown under it, and the full one for screen readers. */
    stops: { key: string; short: string; name: string }[];
    index: number;
    /** A stop drawn as a short line instead of a dot, the value that means "no override". */
    defaultIndex?: number;
    /** Warm fill: the far end, where the scale stops holding back. */
    hot?: boolean;
    dim?: boolean;
    label: string;
    onchange: (i: number) => void;
    /** The stop under the pointer while it is over the slider, null once it leaves. */
    onhover?: (i: number | null) => void;
  } = $props();

  const PULL = 0.3;
  const last = $derived(Math.max(1, stops.length - 1));
  let track = $state<HTMLElement>();
  let dragging = false;
  let lean = $state<number | null>(null);
  const target = $derived(lean === null ? index : index + (lean - index) * PULL);

  // The ball eases toward its target by elapsed time, so the pace doesn't depend on the frame
  // rate, and stretches with the animation speed setting (0 or below: no easing at all). One
  // loop runs until it arrives; a new target just changes where it is heading, so a drag's
  // stream of pointer moves never restarts it. It follows the pointer more tightly mid-drag.
  let pos = $state(untrack(() => index));
  let goal = untrack(() => index);
  let raf = 0;
  let prev = 0;
  function tick(now: number) {
    const speed = app.settings.animationSpeed;
    const d = goal - pos;
    if (!(speed > 0) || Math.abs(d) < 0.002) {
      pos = goal;
      raf = 0;
      return;
    }
    pos += d * (1 - Math.exp(-(now - prev) / ((dragging ? 35 : 60) * speed)));
    prev = now;
    raf = requestAnimationFrame(tick);
  }
  $effect(() => {
    goal = target;
    if (raf) return;
    prev = performance.now();
    raf = requestAnimationFrame(tick);
  });
  $effect(() => () => cancelAnimationFrame(raf));

  /** Where along the stops the pointer is, as a fraction of a stop. */
  function along(e: PointerEvent) {
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    const edge = 3 + 0.475 * 16; // the track's inset plus half the ball
    return Math.min(last, Math.max(0, ((e.clientX - r.left - edge) / (r.width - 2 * edge)) * last));
  }
  function move(e: PointerEvent) {
    const f = along(e);
    const i = Math.round(f);
    if (!dragging) return onhover?.(i);
    lean = f;
    onhover?.(i);
    if (i !== index) onchange(i);
  }
  function stop() {
    dragging = false;
    lean = null;
  }
  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    onchange(Math.min(stops.length - 1, Math.max(0, index + step)));
  }
</script>

<svelte:window onpointerup={stop} onpointercancel={stop} onpointermove={(e) => dragging && move(e)} />

<div
  class="slider"
  class:hot
  class:dim
  style:--n={last}
  style:--i={pos}
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  onkeydown={key}
  onpointerleave={() => !dragging && onhover?.(null)}
>
  <!-- svelte-ignore a11y_no_static_element_interactions (the named stops below are the accessible control) -->
  <div
    class="track"
    aria-hidden="true"
    bind:this={track}
    onpointerdown={(e) => {
      dragging = true;
      move(e);
    }}
    onpointermove={(e) => !dragging && move(e)}
  >
    {#each stops as s, j (s.key)}<span class="tick" class:is-default={j === defaultIndex} style:--j={j}></span>{/each}
    <div class="fill"><span class="ball"></span></div>
  </div>
  <div class="labels">
    {#each stops as s, j (s.key)}
      <button
        type="button"
        role="radio"
        aria-checked={j === index}
        aria-label={s.name}
        class="stop"
        class:on={j === index}
        style:--j={j}
        tabindex={j === index ? 0 : -1}
        onclick={() => onchange(j)}
        onpointerenter={() => onhover?.(j)}
      >
        {s.short}
      </button>
    {/each}
  </div>
</div>

<style>
  /* Every position is the ball's centre at step --i of --n, which travels from one
     ball-plus-inset in from each end. */
  .slider {
    --lamp: var(--quiet-light, 255 196 140);
    --inset: 3px;
    --ball: 0.95rem;
    --edge: calc(var(--inset) + var(--ball) / 2);
    --at: calc(var(--edge) + (100% - 2 * var(--edge)) * var(--i) / var(--n));
    padding: 0.14rem 0.57rem 0.29rem;
  }
  .track {
    position: relative;
    height: calc(var(--ball) + 2 * var(--inset));
    border-radius: var(--radius-pill);
    background: var(--sidebar-active);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    touch-action: none;
  }
  .tick {
    position: absolute;
    left: calc(var(--edge) + (100% - 2 * var(--edge)) * var(--j) / var(--n));
    top: 50%;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    translate: -50% -50%;
    background: color-mix(in srgb, var(--text) 35%, transparent);
  }
  .tick.is-default {
    width: 1.5px;
    height: 42%;
    border-radius: 1px;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--at) + var(--edge));
    border-radius: inherit;
    background: color-mix(in srgb, var(--text) 18%, transparent);
    transition: opacity calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .slider.dim .fill {
    opacity: 0.5;
  }
  /* Warm lamplight at the far end, the one place the slider steps off the plain fill. */
  .fill::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent 15%, rgb(var(--lamp) / 0.65));
    box-shadow: inset 0 0 8px rgb(var(--lamp) / 0.5);
    opacity: 0;
    transition: opacity calc(0.6s * var(--anim-speed, 1)) ease;
  }
  .slider.hot .fill::before {
    opacity: 1;
  }
  .ball {
    position: absolute;
    top: var(--inset);
    right: var(--inset);
    width: var(--ball);
    height: var(--ball);
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #dfe1e8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .labels {
    position: relative;
    height: 1.4rem;
  }
  .stop {
    position: absolute;
    top: 0.2rem;
    left: calc(var(--edge) + (100% - 2 * var(--edge)) * var(--j) / var(--n));
    translate: -50% 0;
    padding: 0.1rem 0.35rem;
    font-size: 0.72rem;
    color: var(--text-dim);
    background: none;
    border: none;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .stop:hover,
  .stop.on {
    color: var(--text);
  }
  .stop:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
</style>

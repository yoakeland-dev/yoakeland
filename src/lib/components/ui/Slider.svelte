<script lang="ts">
  // The one slider: a sunk well, a solid fill that ends under a flat bead, optional stop dots.
  //
  // Plain (min/max/step): the bead follows the pointer with no animation while held, and only eases
  // on release, on a click in the track, and on the keys. A chip above the bead shows the value while
  // it is held. Nothing snaps except to the step.
  //
  // Stepped (`stops`): value is the index of a named stop, shown as labels under the track. While
  // held, the value snaps to the nearest stop as the pointer passes it and the bead leans a third of
  // the way toward the pointer, easing by elapsed time; on release it settles on its stop. Effort
  // and Mode are this.
  //
  // Looks: `tone` picks the fill (accent, or the quiet neutral Effort and Mode rest on), `hot` lights
  // the lamp along the fill (the one gradient in the set), `dim` halves the fill.
  import { untrack } from "svelte";
  import { app } from "../../state.svelte";

  type Stop = { key: string; short: string; name: string; warm?: boolean };

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    stops,
    defaultIndex,
    hot = false,
    dim = false,
    tone = "accent",
    ticks = 0,
    format = String,
    label,
    disabled = false,
    oninput,
    onchange,
    onhover,
  }: {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    /** One per stop: the short name under it, and the full one for screen readers. */
    stops?: Stop[];
    /** A stop drawn as a short line instead of a dot: the value that means "no override". */
    defaultIndex?: number;
    /** Warm lamp along the fill: the far end, where the scale stops holding back. */
    hot?: boolean;
    dim?: boolean;
    tone?: "accent" | "neutral";
    /** Dots along a plain slider, this many intervals apart. Stepped sliders get one per stop. */
    ticks?: number;
    /** The text in the chip above a held plain slider. */
    format?: (v: number) => string;
    label: string;
    disabled?: boolean;
    /** Every time the value changes, including mid-drag. */
    oninput?: (v: number) => void;
    /** Once a drag, click or key press has settled. */
    onchange?: (v: number) => void;
    /** The stop under the pointer while it is over a stepped slider, null once it leaves. */
    onhover?: (i: number | null) => void;
  } = $props();

  const PULL = 0.3;
  const stepped = $derived(!!stops);
  const lo = $derived(stepped ? 0 : min);
  const hi = $derived(stops ? stops.length - 1 : max);
  const st = $derived(stepped ? 1 : step);
  const n = $derived(stops ? hi : ticks);
  const dec = $derived(String(st).split(".")[1]?.length ?? 0);
  const frac = (v: number) => (hi === lo ? 0 : (v - lo) / (hi - lo));
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

  let track = $state<HTMLElement>();
  let dragging = $state(false);
  // Where the bead sits along the track, 0 to 1. Stepped sliders drive it from `pos` by frame time;
  // plain ones set it directly and let the CSS transition do the easing.
  let p = $state(frac(untrack(() => value)));
  let pos = untrack(() => value);
  let goal = pos;
  let raf = 0;
  let prev = 0;
  let down: { x: number; off: number } | null = null;
  let changed = false;

  function tick(now: number) {
    const speed = app.settings.animationSpeed;
    const d = goal - pos;
    if (!(speed > 0) || Math.abs(d) < 0.002) {
      pos = goal;
      raf = 0;
      p = frac(pos);
      return;
    }
    pos += d * (1 - Math.exp(-(now - prev) / ((dragging ? 35 : 60) * speed)));
    prev = now;
    p = frac(pos);
    raf = requestAnimationFrame(tick);
  }
  function aim(g: number) {
    goal = g;
    if (raf) return;
    prev = performance.now();
    raf = requestAnimationFrame(tick);
  }
  $effect(() => () => cancelAnimationFrame(raf));
  $effect(() => {
    const v = value;
    void lo, hi;
    untrack(() => {
      if (dragging) return;
      if (stepped) aim(v);
      else p = frac(v);
    });
  });

  /** Where along the track the pointer is, 0 to 1, less the grab offset. The bead's centre travels
   *  from half the track's height in from each end. */
  function along(e: PointerEvent, off: number) {
    const r = track!.getBoundingClientRect();
    return clamp((e.clientX - off - r.left - r.height / 2) / (r.width - r.height), 0, 1);
  }
  function snap(f: number) {
    return +clamp(Math.round((f * (hi - lo)) / st) * st + lo, lo, hi).toFixed(dec);
  }
  function commit(v: number) {
    if (v === value) return;
    value = v;
    changed = true;
    oninput?.(v);
  }
  function settle() {
    if (!changed) return;
    changed = false;
    onchange?.(value);
  }

  function press(e: PointerEvent) {
    if (disabled || e.button !== 0 || !track) return;
    e.preventDefault();
    track.focus();
    track.setPointerCapture(e.pointerId);
    const r = track.getBoundingClientRect();
    const off = e.clientX - (r.left + r.height / 2 + p * (r.width - r.height));
    const onBead = Math.abs(off) <= r.height / 2;
    changed = false;
    down = { x: e.clientX, off: onBead ? off : 0 };
    // Grabbing the bead starts a drag at once; a click elsewhere eases to that spot first.
    if (onBead) dragging = true;
    else commit(snap(along(e, 0)));
  }
  function move(e: PointerEvent) {
    if (!track) return;
    if (!down) {
      if (stepped && !disabled) onhover?.(Math.round(along(e, 0) * hi));
      return;
    }
    if (!dragging) {
      if (Math.abs(e.clientX - down.x) < 3) return;
      dragging = true;
    }
    const f = along(e, down.off);
    commit(snap(f));
    if (stepped) {
      aim(value + (f * hi - value) * PULL);
      onhover?.(value);
    } else p = f;
  }
  function release() {
    if (!down) return;
    down = null;
    dragging = false;
    if (stepped) aim(value);
    else p = frac(value);
    settle();
  }
  function key(e: KeyboardEvent) {
    if (disabled) return;
    const k = e.key;
    const big = stepped ? 1 : 10 * st;
    let v = value;
    if (k === "ArrowRight" || k === "ArrowUp") v += st;
    else if (k === "ArrowLeft" || k === "ArrowDown") v -= st;
    else if (k === "PageUp") v += big;
    else if (k === "PageDown") v -= big;
    else if (k === "Home") v = lo;
    else if (k === "End") v = hi;
    else return;
    e.preventDefault();
    commit(+clamp(v, lo, hi).toFixed(dec));
    settle();
  }
  function pick(i: number) {
    commit(i);
    settle();
  }
</script>

<div
  class="slider"
  class:stepped
  class:hot
  class:dim
  class:neutral={tone === "neutral"}
  class:disabled
  role={stepped ? "radiogroup" : undefined}
  aria-label={stepped ? label : undefined}
  tabindex="-1"
  onkeydown={key}
  onpointerleave={() => !dragging && onhover?.(null)}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions (a plain slider is this element's role; a stepped one is operated through the radio labels below) -->
  <div
    class="track"
    class:dragging
    class:eased={stepped}
    style:--p={p}
    bind:this={track}
    role={stepped ? undefined : "slider"}
    aria-hidden={stepped ? "true" : undefined}
    aria-label={stepped ? undefined : label}
    aria-valuemin={stepped ? undefined : lo}
    aria-valuemax={stepped ? undefined : hi}
    aria-valuenow={stepped ? undefined : value}
    aria-valuetext={stepped ? undefined : format(value)}
    aria-disabled={disabled || undefined}
    tabindex={stepped ? -1 : 0}
    onpointerdown={press}
    onpointermove={move}
    onpointerup={release}
    onpointercancel={release}
    onlostpointercapture={release}
  >
    <div class="fill"></div>
    {#if n > 0}
      {#each { length: n + 1 } as _, k}
        <i class="tick" class:lit={k / n <= p + 1e-6 && k !== defaultIndex} class:is-default={k === defaultIndex} style:--k={k / n}></i>
      {/each}
    {/if}
    <i class="bead"></i>
    {#if !stepped}<output class="chip">{format(value)}</output>{/if}
  </div>
  {#if stops}
    <div class="labels">
      {#each stops as s, j (s.key)}
        <button
          type="button"
          role="radio"
          aria-checked={j === value}
          aria-label={s.name}
          class="stop"
          class:on={j === value}
          class:warm={s.warm}
          style:--k={j / n}
          tabindex={j === value ? 0 : -1}
          {disabled}
          onclick={() => pick(j)}
          onpointerenter={() => onhover?.(j)}
        >
          {s.short}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Every position is the bead's centre at --p of the way along, which travels from half the track's
     height in from each end. */
  .slider {
    --lamp: var(--quiet-light, 255 196 140);
    --t: 1.57rem;
    --b: 1.14rem;
    --fill: var(--accent);
    --ease: calc(0.26s * var(--anim-speed, 1)) var(--ui-ease);
    width: 100%;
    min-width: 0;
  }
  .slider.neutral,
  .slider.hot {
    --fill: color-mix(in srgb, var(--text) 18%, transparent);
  }
  .slider.stepped {
    padding: 0.14rem 0.57rem 0.29rem;
  }
  .slider.disabled {
    opacity: 0.5;
  }
  .track {
    position: relative;
    height: var(--t);
    border-radius: var(--radius-pill);
    background: var(--well);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    outline: none;
  }
  .track:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .slider.disabled .track {
    cursor: default;
    pointer-events: none;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--t) + var(--p) * (100% - var(--t)));
    opacity: calc(clamp(0, calc(var(--p) * 12), 1) * var(--dim-fade, 1));
    border-radius: inherit;
    background: var(--fill);
    transition:
      width var(--ease),
      background calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .slider.dim {
    --dim-fade: 0.5;
  }
  /* Warm lamplight at the far end, the one place the set steps off a flat fill. */
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
  .tick {
    position: absolute;
    top: 50%;
    left: calc(var(--t) / 2 + var(--k) * (100% - var(--t)));
    width: 3px;
    height: 3px;
    border-radius: 50%;
    translate: -50% -50%;
    background: color-mix(in srgb, var(--text) 25%, transparent);
    pointer-events: none;
  }
  .tick.lit {
    background: color-mix(in srgb, var(--text) 65%, transparent);
  }
  .tick.is-default {
    width: 1.5px;
    height: 42%;
    border-radius: 1px;
  }
  .bead {
    position: absolute;
    top: calc((var(--t) - var(--b)) / 2);
    left: calc((var(--t) - var(--b)) / 2 + var(--p) * (100% - var(--t)));
    width: var(--b);
    height: var(--b);
    border-radius: 50%;
    background: var(--bead);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    transition:
      left var(--ease),
      transform calc(0.15s * var(--anim-speed, 1)) var(--ui-spring);
  }
  /* Held: nothing eases, the bead is under the pointer. Stepped sliders drive it from script. */
  .track.dragging .fill {
    transition: background calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .track.dragging .bead {
    transition: transform calc(0.15s * var(--anim-speed, 1)) var(--ui-spring);
    transform: scale(1.1);
  }
  .track.eased .fill {
    transition: background calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .track.eased .bead {
    transition: transform calc(0.15s * var(--anim-speed, 1)) var(--ui-spring);
  }
  .chip {
    position: absolute;
    bottom: calc(100% + 0.57rem);
    left: calc(var(--t) / 2 + var(--p) * (100% - var(--t)));
    translate: -50% 0.29rem;
    padding: 0.14rem 0.57rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--panel-bg) 82%, var(--text));
    border: 1px solid var(--panel-border-top);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    font-family: var(--code-font-family);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    z-index: 2;
    transition:
      opacity calc(0.12s * var(--anim-speed, 1)) ease,
      translate calc(0.16s * var(--anim-speed, 1)) ease,
      left var(--ease);
  }
  .track.dragging .chip {
    transition:
      opacity calc(0.12s * var(--anim-speed, 1)) ease,
      translate calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .track.dragging .chip,
  .track:focus-visible .chip {
    opacity: 1;
    translate: -50% 0;
  }
  .labels {
    position: relative;
    height: 1.4rem;
  }
  .stop {
    position: absolute;
    top: 0.2rem;
    left: calc(var(--t) / 2 + var(--k) * (100% - var(--t)));
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
  /* A stop that isn't a step further along the scale but a different thing: lamp-coloured. */
  .stop.warm {
    color: rgb(var(--lamp) / 0.75);
  }
  .stop.warm:hover,
  .stop.warm.on {
    color: rgb(var(--lamp));
  }
  .stop:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .stop:disabled {
    cursor: default;
  }
</style>

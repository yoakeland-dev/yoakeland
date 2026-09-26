<script lang="ts" module>
  // The dot-matrix status spinner: four 5×5 layers, one per mode, crossfaded by opacity.
  // Each dot carries only its keyframe and phase (a fraction of the cycle); the patterns and
  // orders are the ones from the Dot Status design.
  export type DotMode = "thinking" | "reading" | "editing" | "tools";
  type Dot = { anim: string; k: number } | null;

  const N = 5;
  const cells = Array.from({ length: N * N }, (_, i) => ({ r: Math.floor(i / N), c: i % N }));
  const ring = ({ r, c }: { r: number; c: number }) => Math.round(Math.hypot(r - 2, c - 2));
  const rings = (p: { r: number; c: number }) => ring(p) === 1 || ring(p) === 2 || (p.r === 2 && p.c === 2);
  const outline = ({ r, c }: { r: number; c: number }) => r === 0 || r === N - 1 || c === 0 || c === N - 1;

  const order = (coords: number[][]) => new Map(coords.map(([r, c], t) => [r * N + c, t]));
  const OUTER = order([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0]]);
  const MIDDLE = order([[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]]);
  const DIAGONAL: number[] = [];
  for (let d = 0, t = 0; d <= 2 * (N - 1); d++) {
    const lo = Math.max(0, d - (N - 1));
    const hi = Math.min(N - 1, d);
    for (let i = 0; i <= hi - lo; i++) {
      const r = d % 2 === 0 ? hi - i : lo + i;
      DIAGONAL[r * N + (d - r)] = t++;
    }
  }

  const LAYERS: Record<DotMode, Dot[]> = {
    // Outer ring clockwise, middle ring anti-clockwise, center left dark.
    thinking: cells.map((p, i) =>
      !rings(p) || (p.r === 2 && p.c === 2)
        ? null
        : OUTER.has(i)
          ? { anim: "snake", k: OUTER.get(i)! * 0.0625 }
          : { anim: "snake", k: MIDDLE.get(i)! * 0.125 },
    ),
    // A ripple out from the top-left corner, around the border only.
    reading: cells.map((p) => (outline(p) ? { anim: "ripple", k: (p.r + p.c) * 0.16 } : null)),
    editing: cells.map((p, i) => (rings(p) ? { anim: "diagonal", k: DIAGONAL[i] * 0.04 } : null)),
    // Alternating diagonals sweeping from the top-right corner.
    tools: cells.map((p) => {
      const slice = p.r + (N - 1 - p.c);
      return rings(p) ? { anim: "sweep", k: (slice / 8) * 0.2 + (slice % 2) * 0.5 } : null;
    }),
  };
  const MODES = Object.keys(LAYERS) as DotMode[];
</script>

<script lang="ts">
  let { mode = "thinking", size = 14 }: { mode?: DotMode; size?: number } = $props();
</script>

<span class="dmx" style:width="{size}px" style:height="{size}px" role="img" aria-label={mode}>
  {#each MODES as m (m)}
    <span class="layer" class:active={m === mode}>
      {#each LAYERS[m] as dot, i (i)}
        <span class="dot {dot?.anim ?? 'off'}" style:--k={dot?.k}></span>
      {/each}
    </span>
  {/each}
</span>

<style>
  .dmx {
    position: relative;
    display: inline-block;
    flex: none;
    /* 1500ms at the design's 1.35× speed. */
    --cycle: calc(1111ms * var(--anim-speed, 1));
    --base: 0.12;
    --mid: 0.42;
  }
  .layer {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template: repeat(5, 1fr) / repeat(5, 1fr);
    opacity: 0;
    transition: opacity calc(0.48s * var(--anim-speed, 1)) cubic-bezier(0.4, 0, 0.2, 1);
  }
  .layer.active {
    opacity: 1;
  }
  .dot {
    width: 74%;
    aspect-ratio: 1;
    place-self: center;
    border-radius: 50%;
    background: currentColor;
    opacity: 0;
    /* Phases shifted back two whole cycles: same wave, but every dot is mid-animation from the
       first frame instead of sitting dark through a positive delay. */
    animation: none var(--cycle) linear infinite;
    animation-delay: calc((var(--k, 0) - 2) * var(--cycle));
  }
  /* Every layer keeps running, so the outgoing one is still moving while it crossfades out. */
  .snake {
    animation-name: dmx-snake;
  }
  .ripple {
    animation-name: dmx-ripple;
    animation-timing-function: ease-in-out;
  }
  .diagonal {
    animation-name: dmx-diagonal;
  }
  .sweep {
    animation-name: dmx-sweep;
  }
  @keyframes dmx-snake {
    0%, 100% { opacity: calc(0.5 * var(--base)); }
    10% { opacity: 1; }
    20% { opacity: calc(0.45 + 0.45 * var(--mid) + 0.1 * var(--base)); }
    30% { opacity: calc(0.2 + 0.4 * var(--mid) + 0.4 * var(--base)); }
    40% { opacity: calc(0.875 * var(--base)); }
  }
  @keyframes dmx-ripple {
    0%, 100% { opacity: calc(0.625 * var(--base)); }
    34% { opacity: 1; }
    60% { opacity: calc(0.5 * (var(--base) + var(--mid))); }
  }
  @keyframes dmx-diagonal {
    0%, 100% { opacity: calc(0.5 * var(--base)); }
    8% { opacity: 1; }
    16% { opacity: calc(0.5 + 0.4 * var(--mid) + 0.1 * var(--base)); }
    24% { opacity: calc(0.25 + 0.45 * var(--mid) + 0.3 * var(--base)); }
    32% { opacity: calc(0.5 * var(--mid) + 0.5 * var(--base)); }
    40% { opacity: calc(0.75 * var(--base)); }
  }
  @keyframes dmx-sweep {
    0%, 100% { opacity: calc(0.5 * var(--base)); }
    14% { opacity: 1; }
    30% { opacity: calc(0.75 * var(--base)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .layer.active .dot:not(.off) {
      animation: none;
      opacity: 0.6;
    }
  }
</style>

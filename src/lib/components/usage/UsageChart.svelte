<script lang="ts">
  // Stacked smooth areas over time, first series at the bottom. Hover (or arrow keys) reads
  // out every series at that bucket; the breakdown's time tab is the table twin of this chart.
  import { fmtMetric, monotonePath, niceTicks, type Metric, type Unit } from "../../usage";

  export interface Series {
    key: string;
    label: string;
    color: string;
    values: number[];
  }

  let {
    buckets,
    unit,
    series,
    metric,
  }: { buckets: number[]; unit: Unit; series: Series[]; metric: Metric } = $props();

  const PLOT_H = 190;
  const AXIS_H = 22;
  const TOP = 8;

  const uid = $props.id();
  let width = $state(600);
  let hover = $state<number | null>(null);

  const n = $derived(buckets.length);
  const totals = $derived(buckets.map((_, i) => series.reduce((a, s) => a + s.values[i], 0)));
  const ticks = $derived(niceTicks(Math.max(...totals, 0), 3));
  const yMax = $derived(ticks[ticks.length - 1] || 1);
  const step = $derived(ticks[1] ?? 0);
  const axisW = $derived(Math.max(...ticks.map((t) => tickLabel(t).length)) * 6.6 + 10);
  const plotW = $derived(Math.max(width - axisW, 1));
  const gap = $derived(n > 1 ? plotW / (n - 1) : plotW);
  const base = TOP + PLOT_H;
  const y = (v: number) => base - (v / yMax) * PLOT_H;
  // A lone bucket draws as a flat line across the plot.
  const xs = $derived(n > 1 ? buckets.map((_, i) => axisW + i * gap) : [axisW, width]);
  const xAt = (i: number) => (n > 1 ? xs[i] : axisW + plotW / 2);

  function tickLabel(v: number): string {
    if (metric !== "cost") return fmtMetric(metric, v);
    // Cent-level ticks would round a $0.025 step into repeats.
    const digits = step > 0 && step < 0.01 ? 3 : step < 1 && step > 0 ? 2 : v % 1 ? 2 : 0;
    return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  const fmtAxis = (t: number) =>
    unit === "hour"
      ? new Date(t).toLocaleTimeString([], { hour: "numeric" })
      : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

  function fmtBucket(t: number): string {
    const d = new Date(t);
    if (unit === "hour") {
      const next = new Date(t + 3_600_000);
      return `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    if (unit === "week") return `Week of ${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  // ~140px between labels; the last bucket always gets one, crowding out a close neighbour.
  const labels = $derived.by(() => {
    const every = Math.max(1, Math.ceil(140 / Math.max(gap, 1)));
    const out = buckets.map((_, i) => i).filter((i) => i % every === 0 && n - 1 - i >= every * 0.6);
    if (n) out.push(n - 1);
    return out;
  });

  // Cumulative top edge of each series, bottom-up.
  const stacks = $derived.by(() => {
    const acc = new Array(n).fill(0);
    return series.map((s) => {
      const tops = s.values.map((v, i) => (acc[i] += v));
      const vals = n > 1 ? tops : [tops[0] ?? 0, tops[0] ?? 0];
      const line = monotonePath(vals.map((v, i) => [xs[i], y(v)]));
      return { key: s.key, color: s.color, values: s.values, tops, line, area: `${line}L${xs[xs.length - 1]},${base}L${xs[0]},${base}Z` };
    });
  });
  // A band under a pixel tall would only fringe the line above it; the tooltip still lists it.
  // Kept in the DOM either way (just faded out), so its path can morph when it grows back.
  const drawn = $derived(stacks.map((s) => ({ ...s, hidden: (Math.max(...s.values) / yMax) * PLOT_H < 1 })).reverse());

  const readout = $derived.by(() => {
    if (hover === null) return null;
    const i = hover;
    return {
      title: fmtBucket(buckets[i]),
      total: totals[i],
      rows: series
        .filter((s) => s.values[i] > 0)
        .map((s) => ({ key: s.key, label: s.label, color: s.color, v: s.values[i] }))
        .sort((a, b) => b.v - a.v),
    };
  });

  function onMove(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = n > 1 ? Math.round((e.clientX - rect.left - axisW) / gap) : 0;
    hover = n ? Math.min(n - 1, Math.max(0, i)) : null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const d = e.key === "ArrowLeft" ? -1 : 1;
      hover = Math.min(n - 1, Math.max(0, (hover ?? (d < 0 ? n : -1)) + d));
    } else if (e.key === "Escape") hover = null;
  }
</script>

<div class="chart" bind:clientWidth={width}>
  <div
    class="plot"
    role="slider"
    aria-roledescription="chart"
    aria-label="Usage by {unit}"
    aria-valuemin={0}
    aria-valuemax={n - 1}
    aria-valuenow={hover ?? n - 1}
    aria-valuetext={readout ? `${readout.title}: ${fmtMetric(metric, readout.total)}` : "Use the arrow keys to read each " + unit}
    tabindex="0"
    onpointermove={onMove}
    onpointerleave={() => (hover = null)}
    onkeydown={onKey}
    onblur={() => (hover = null)}
  >
    <svg {width} height={base + AXIS_H} aria-hidden="true">
      <!-- Opaque washes painted top-down, so a lower band simply covers the one above. -->
      {#each drawn as s (s.key)}
        <path class:hidden={s.hidden} style:d="path('{s.area}')" style:fill="color-mix(in oklab, {s.color} 16%, var(--panel-bg))" />
      {/each}
      {#each ticks as t (t)}
        <line class="grid" class:base={t === 0} x1={axisW} x2={width} y1={y(t)} y2={y(t)} />
        <text class="tick" x={axisW - 8} y={y(t)} dy="0.32em" text-anchor="end">{tickLabel(t)}</text>
      {/each}
      <!-- Top-down too, so where edges coincide the lower (bigger) series' line wins.
           Clipped just above the baseline, so empty stretches show only the gray axis. -->
      <clipPath id="{uid}-above"><rect x="0" y="0" {width} height={base - 1} /></clipPath>
      <g clip-path="url(#{uid}-above)">
        {#each drawn as s (s.key)}
          <path class="line" class:hidden={s.hidden} style:d="path('{s.line}')" style:stroke={s.color} />
        {/each}
      </g>
      {#each labels as i (i)}
        <text class="tick" x={xAt(i)} y={base + 16} text-anchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{fmtAxis(buckets[i])}</text>
      {/each}
      {#if hover !== null}
        <line class="cross" x1={xAt(hover)} x2={xAt(hover)} y1={TOP} y2={base} />
        {#each drawn as s (s.key)}
          {#if !s.hidden && s.values[hover] > 0}
            <circle class="dot" cx={xAt(hover)} cy={y(s.tops[hover])} r="4" style:fill={s.color} />
          {/if}
        {/each}
      {/if}
    </svg>
  </div>
  {#if readout && hover !== null}
    <div class="tip" class:flip={xAt(hover) > width * 0.6} style="left: {xAt(hover)}px" aria-live="polite">
      <div class="tip-head">{readout.title}</div>
      <div class="tip-total">{fmtMetric(metric, readout.total)}</div>
      {#each readout.rows as r (r.key)}
        <div class="tip-row">
          <span class="key" style="background: {r.color}"></span>
          <span class="name">{r.label}</span>
          <span class="val">{fmtMetric(metric, r.v)}</span>
        </div>
      {:else}
        <div class="tip-row empty">No usage</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    min-width: 0;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .plot {
    outline: none;
    touch-action: pan-y;
  }
  .plot:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
    outline-offset: 4px;
    border-radius: 4px;
  }
  .grid {
    stroke: color-mix(in srgb, var(--text) 6%, transparent);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .grid.base {
    stroke: color-mix(in srgb, var(--text) 16%, transparent);
  }
  /* Same bucket count means the same path commands, so a new selection morphs the curve. */
  path {
    transition:
      d calc(0.4s * var(--anim-speed, 1)) cubic-bezier(0.33, 1, 0.68, 1),
      opacity calc(0.4s * var(--anim-speed, 1)) ease;
  }
  path.hidden {
    opacity: 0;
  }
  .line {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .tick {
    fill: var(--text-dim);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .cross {
    stroke: color-mix(in srgb, var(--text) 30%, transparent);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .dot {
    stroke: var(--panel-bg);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(12px);
    min-width: 11rem;
    max-width: 18rem;
    padding: 0.5rem 0.64rem;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    pointer-events: none;
    z-index: 2;
    font-size: var(--text-label-size);
  }
  .tip.flip {
    transform: translateX(calc(-100% - 12px));
  }
  .tip-head {
    color: var(--text-dim);
  }
  .tip-total {
    margin: 0.1rem 0 0.36rem;
    color: var(--text);
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  .tip-row {
    display: grid;
    grid-template-columns: 0.7rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.43rem;
    padding: 0.07rem 0;
  }
  .tip-row.empty {
    display: block;
    color: var(--text-dim);
  }
  .key {
    width: 0.7rem;
    height: 2px;
    border-radius: 1px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .val {
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>

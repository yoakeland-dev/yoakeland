<script lang="ts">
  // When the work happens: weekday x local hour, one hue, darker = more.
  import { fmtMetric, type Metric } from "../../usage";

  let { grid, metric }: { grid: number[][]; metric: Metric } = $props();

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const max = $derived(Math.max(...grid.flat(), 0));
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
  // sqrt so one busy hour doesn't wash every other cell out to nothing.
  const level = (v: number) => (v > 0 ? Math.round(18 + 82 * Math.sqrt(v / max)) : 0);

  const peak = $derived.by(() => {
    let best = { d: 0, h: 0, v: 0 };
    grid.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { d, h, v })));
    return best.v > 0 ? best : null;
  });
  const busiestDay = $derived.by(() => {
    const sums = grid.map((r) => r.reduce((a, b) => a + b, 0));
    const i = sums.indexOf(Math.max(...sums));
    return sums[i] > 0 ? DAYS[i] : null;
  });

  let hover = $state<{ d: number; h: number } | null>(null);
  const unitLabel = $derived(metric === "requests" ? "requests" : metric === "tokens" ? "tokens" : "");
</script>

<div class="heat">
  <div class="grid" role="img" aria-label={peak ? `Busiest hour: ${DAYS[peak.d]} ${hourLabel(peak.h)}` : "No activity"} onpointerleave={() => (hover = null)}>
    <span></span>
    {#each Array(24) as _, h (h)}
      <span class="hl">{h % 6 === 0 ? hourLabel(h) : ""}</span>
    {/each}
    {#each grid as row, d (d)}
      <span class="dl">{DAYS[d]}</span>
      {#each row as v, h (h)}
        <!-- svelte-ignore a11y_no_static_element_interactions (hover detail only; the summary line and breakdown carry the values) -->
        <span
          class="cell"
          class:on={hover?.d === d && hover?.h === h}
          style="--l: {level(v)}%"
          onpointerenter={() => (hover = { d, h })}
        ></span>
      {/each}
    {/each}
  </div>
  <div class="foot">
    <span class="read">
      {#if hover}
        <strong>{fmtMetric(metric, grid[hover.d][hover.h])}</strong>
        {unitLabel} · {DAYS[hover.d]} {hourLabel(hover.h)}–{hourLabel((hover.h + 1) % 24)}
      {:else if peak}
        Busiest hour <strong>{DAYS[peak.d]} {hourLabel(peak.h)}</strong>{#if busiestDay}{" · "}busiest day <strong>{busiestDay}</strong>{/if}
      {:else}
        No activity in this period
      {/if}
    </span>
    <span class="scale" aria-hidden="true">
      Less
      {#each [0, 25, 50, 75, 100] as p (p)}
        <span class="cell" style="--l: {p ? 18 + 0.82 * p : 0}%"></span>
      {/each}
      More
    </span>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 2.4rem repeat(24, minmax(0, 1fr));
    gap: 2px;
    align-items: center;
  }
  .hl,
  .dl {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .hl {
    height: 1rem;
    overflow: visible;
  }
  .cell {
    display: block;
    height: 0.85rem;
    border-radius: 2px;
    background: color-mix(in oklab, var(--accent) var(--l), color-mix(in srgb, var(--text) 5%, transparent));
  }
  .grid .cell.on {
    outline: 2px solid var(--text);
    outline-offset: -1px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.57rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    min-height: 1.2rem;
  }
  .read strong {
    color: var(--text);
    font-weight: 600;
  }
  .scale {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .scale .cell {
    width: 0.7rem;
    height: 0.7rem;
  }
</style>

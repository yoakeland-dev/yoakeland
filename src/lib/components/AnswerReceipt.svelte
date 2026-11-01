<script lang="ts">
  // What an artifact page sent, as striped rows: a field per row, shown by its type.
  import Icon from "./Icon.svelte";

  let { data }: { data: Record<string, unknown> } = $props();

  type Row = { key: string; value: unknown; sub?: boolean; group?: boolean };

  const rows = $derived.by(() => {
    const out: Row[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out.push({ key, value, group: true });
        for (const [k, v] of Object.entries(value)) out.push({ key: k, value: v, sub: true });
      } else out.push({ key, value });
    }
    return out;
  });
  const empty = (v: unknown) => v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const scalars = (v: unknown): v is unknown[] => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
</script>

<div class="receipt">
  {#each rows as r, i (i)}
    {#if r.group}
      <div class="row group"><span class="k">{r.key}</span></div>
    {:else}
      <div class="row" class:sub={r.sub}>
        <span class="k">{r.key}</span>
        <span class="v">
          {#if empty(r.value)}
            <span class="dim">—</span>
          {:else if typeof r.value === "boolean"}
            {#if r.value}<span class="yes"><Icon name="check" size={12} /> yes</span>{:else}<span class="dim">no</span>{/if}
          {:else if typeof r.value === "number"}
            <span class="num">{r.value}</span>
          {:else if scalars(r.value)}
            <span class="chips">
              {#each (r.value as unknown[]).slice(0, 6) as x}<i>{text(x)}</i>{/each}
              {#if (r.value as unknown[]).length > 6}<i class="more">+{(r.value as unknown[]).length - 6}</i>{/if}
            </span>
          {:else if typeof r.value === "object"}
            <code>{text(r.value).slice(0, 160)}</code>
          {:else}
            {r.value}
          {/if}
        </span>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* Flush with the bubble: it cancels .clip's padding, and the bubble's own clip rounds the corners. */
  .receipt {
    min-width: 12rem;
    margin: 0 -1rem;
    font-size: var(--text-body-size, 0.93rem);
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    padding: 0.4rem 1rem;
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
  }
  .row:nth-child(even) {
    background: var(--wash-2);
  }
  .k {
    color: var(--text-dim);
    flex: none;
  }
  .v {
    font-weight: 600;
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row.sub .k {
    padding-left: 0.9rem;
  }
  .row.group .k {
    font-size: 0.72rem;
  }
  .dim {
    color: var(--text-dim);
    font-weight: 400;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .yes {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--success);
  }
  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.25rem;
  }
  .chips i {
    font-style: normal;
    font-weight: 400;
    background: var(--wash-3);
    border-radius: var(--radius-pill);
    padding: 0.04rem 0.55rem;
  }
  .chips i.more {
    color: var(--text-dim);
  }
  code {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 0.78rem;
    font-weight: 400;
    color: var(--text-dim);
  }
  /* The bubble's 16px corners cut into the first and last row, so those get room. */
  .row:first-child {
    padding-top: 0.65rem;
  }
  .row:last-child {
    padding-bottom: 0.65rem;
  }
</style>

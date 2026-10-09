<script lang="ts">
  // The composer's context ring: how full this chat's context is, and, opened, what it is made of
  // (SPEC.md §3.2 turn_completed.context, get_context_breakdown). The ring reads what the server
  // already sent with each turn; the panel asks for the breakdown when it opens.
  import { untrack } from "svelte";
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { app } from "../state.svelte";
  import { getContextBreakdown } from "../ipc";
  import { shortNum } from "../format";
  import { bar, cacheHitPct, categoryHue, ringState, ringSummary, usd } from "../contextBreakdown";
  import type { ContextBreakdown } from "../types";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);
  const ctx = $derived(server?.contextBySession[sessionId]);
  const ring = $derived(ringState(ctx));
  const summary = $derived(ringSummary(ring, shortNum));

  // The server's per-chat spend cap: the ring wears a dot once this chat is within 20% of it.
  const capUsd = $derived(server?.sessionCapUsd);
  const spent = $derived(server?.spendBySession[sessionId]?.sessionTotalUsd ?? 0);
  const nearCap = $derived(capUsd != null && capUsd > 0 && spent >= capUsd * 0.8);
  const capNote = $derived(nearCap ? ` · ${usd(spent)} of the ${usd(capUsd!)} session cap` : "");

  const R = 6.5;
  const CIRC = 2 * Math.PI * R;
  const dash = $derived(ring.kind === "ok" && ring.pct !== null ? (ring.pct / 100) * CIRC : 0);

  // A chat with nothing in it has no turn to count, and the server may not answer for it.
  const blank = $derived(ring.kind === "empty" && !server?.messagesBySession[sessionId]?.length);

  let open = $state(false);
  let data = $state<ContextBreakdown | null>(null);
  let error = $state("");
  let loading = $state(false);
  let seq = 0;

  // Stale data stays up while a fresh answer is on its way: a CLI agent can take a few seconds to count.
  async function load() {
    if (!cid) return;
    const mine = ++seq;
    loading = true;
    error = "";
    try {
      const r = await getContextBreakdown(cid, sessionId, server?.projectBySession[sessionId]);
      if (mine !== seq) return;
      if (r.error) error = r.error;
      else data = r;
    } catch (e) {
      if (mine === seq) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    if (!open || blank) {
      seq++;
      loading = false;
      return;
    }
    // Reloads when a turn ends (or a compaction lands) with the panel open, too.
    void ctx?.estimatedTokens;
    untrack(() => void load());
  });
  // Another chat's numbers are no good here.
  $effect(() => {
    void sessionId;
    data = null;
    error = "";
  });

  const view = $derived(data ? bar(data) : null);
  const cacheHit = $derived(data ? cacheHitPct(data.cache) : null);
  const spend = $derived(data?.spend ?? server?.spendBySession[sessionId]);
  const pctLabel = (tokens: number, denominator: number) => {
    const p = denominator > 0 ? (tokens / denominator) * 100 : 0;
    return p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : p > 0 ? "<0.1%" : "0%";
  };
  const swatch = (key: string) => {
    const hue = categoryHue(key);
    return hue === null ? "" : `--hue: ${hue}`;
  };
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={`picker-trigger ctx-trigger${open && !blank ? " open" : ""}${nearCap ? " cap" : ""} ${ring.kind === "ok" ? ring.level : ring.kind}`}
    aria-label={summary + capNote}
    {@attach tip(open && !blank ? undefined : summary + capNote)}
  >
    <span class="ring-wrap">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle class="track" cx="8" cy="8" r={R} />
        {#if ring.kind === "ok"}
          <circle class="arc" class:est={ring.estimated} cx="8" cy="8" r={R} stroke-dasharray="{dash} {CIRC}" transform="rotate(-90 8 8)" />
        {/if}
      </svg>
    </span>
    <span class="trigger-label">{#if ring.kind === "ok"}{ring.estimated ? "~" : ""}{ring.pct === null ? shortNum(ring.used) : `${ring.pct}%`}{:else}&ndash;{/if}</span>
  </Popover.Trigger>

  {#if !blank}
    <Popover.Portal>
      <Popover.Content class="ctx-panel" side="top" align="start" sideOffset={8} collisionPadding={8}>
        <div class="head">
          <span class="heading">Context</span>
          {#if loading}<span class="spin dim"><Icon name="loader-2" size={12} /></span>{/if}
          <button type="button" class="refresh" aria-label="Refresh" {@attach tip("Recount")} onclick={load} disabled={loading}>
            <Icon name="restore" size={13} />
          </button>
        </div>

        {#if error && !data}
          <div class="note err">{error}</div>
        {:else if !data}
          <div class="note">Counting…</div>
        {:else}
          {@const tilde = data.source === "estimated" ? "~" : ""}
          <div class="total">
            <span class="big">{tilde}{data.totalTokens.toLocaleString()}</span>
            {#if data.windowTokens}
              <span class="of">/ {data.windowTokens.toLocaleString()} tokens</span>
              <span class="pct">{tilde}{pctLabel(data.totalTokens, data.windowTokens)}</span>
            {:else}
              <span class="of">tokens</span>
            {/if}
          </div>

          {#if view && view.segments.length}
            <div class="bar" role="img" aria-label={summary}>
              {#each view.segments as s (s.key)}
                <span
                  class="seg {s.kind}"
                  class:est={s.kind === "used" && !s.exact}
                  style="flex: 0 0 {s.pct}%; {swatch(s.key)}"
                  {@attach tip(`${s.label}: ${s.exact ? "" : "~"}${s.tokens.toLocaleString()} tokens`)}
                ></span>
              {/each}
              {#if view.compactPct !== null}<span class="mark" style="left: {view.compactPct}%"></span>{/if}
            </div>

            <ul class="legend">
              {#each view.segments as s (s.key)}
                <li class={s.kind}>
                  <span class="dot {s.kind}" class:est={s.kind === "used" && !s.exact} style={swatch(s.key)}></span>
                  <span class="name">{s.label}</span>
                  <span class="tok" {@attach tip(s.tokens.toLocaleString())}>{s.kind === "used" && !s.exact ? "~" : ""}{shortNum(s.tokens)}</span>
                  <span class="share">{pctLabel(s.tokens, view.denominator)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="note">Nothing to measure yet. This fills in once the chat has something in it.</div>
          {/if}

          <dl class="facts">
            {#if data.autoCompactAt}
              <dt>Compacts at</dt>
              <dd>{shortNum(data.autoCompactAt)} tokens</dd>
            {/if}
            {#if data.cache}
              <dt>Prompt cache</dt>
              <dd>
                {#if cacheHit !== null}{cacheHit}% read{:else}none{/if}
                <span class="dim">· {shortNum(data.cache.read)} read, {shortNum(data.cache.write)} written</span>
              </dd>
            {/if}
            {#if spend}
              <dt>Spend</dt>
              <dd>
                {usd(spend.sessionTotalUsd, spend.sessionCostUnknown)} <span class="dim">this chat</span>
                <span class="dim">· {usd(spend.projectTotalUsd, spend.projectCostUnknown)} project</span>
                {#if capUsd}<span class="dim">· {usd(capUsd)} cap</span>{/if}
              </dd>
            {/if}
            {#if data.model}
              <dt>Model</dt>
              <dd class="dim">{data.model}</dd>
            {/if}
          </dl>

          {#if !data.windowTokens}
            <div class="note">The model's window isn't known, so the bar is drawn against the point where the chat compacts.</div>
          {/if}
          {#if data.source === "estimated"}
            <div class="note">Estimated from the size of the text: the provider hasn't counted this yet.</div>
          {:else if view?.anyEstimated}
            <div class="note">The total is the provider's count. Slices marked ~ are estimates, scaled to fit it.</div>
          {:else if data.source === "unknown"}
            <div class="note">This agent doesn't say how full its context is.</div>
          {/if}
          {#if error}<div class="note err">{error}</div>{/if}
        {/if}
      </Popover.Content>
    </Popover.Portal>
  {/if}
</Popover.Root>

<style>
  /* Icon-sized, with the percentage beside it where there's room (the narrow composer hides the label). */
  :global(.ctx-trigger) {
    gap: 0.36rem;
    padding: 0 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  .ring-wrap {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
  }
  /* Near the session spend cap. */
  :global(.ctx-trigger.cap) .ring-wrap::after {
    content: "";
    position: absolute;
    top: -2px;
    right: -3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warning);
  }
  .track {
    fill: none;
    stroke: currentColor;
    stroke-opacity: 0.22;
    stroke-width: 2;
  }
  .arc {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dasharray calc(0.3s * var(--anim-speed, 1)) ease;
  }
  /* A guess rather than a count: the arc is broken up. */
  .arc.est {
    stroke-opacity: 0.8;
  }
  :global(.ctx-trigger.warn) .arc {
    stroke: var(--warning);
  }
  :global(.ctx-trigger.hot) .arc {
    stroke: var(--danger);
  }
  :global(.ctx-trigger.warn),
  :global(.ctx-trigger.hot) {
    color: var(--text);
  }
  :global(.ctx-trigger.empty) .track,
  :global(.ctx-trigger.unknown) .track {
    stroke-dasharray: 2.2 2.2;
    stroke-opacity: 0.35;
  }

  :global(.ctx-panel) {
    width: 21rem;
    max-width: calc(100vw - 2rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    padding: 0.5rem 0.64rem 0.64rem;
    z-index: var(--z-popover);
    color: var(--text);
    font-size: 0.74rem;
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.ctx-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0 0.4rem;
  }
  .heading {
    flex: 1;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .refresh {
    display: grid;
    place-items: center;
    padding: 0.2rem;
    color: var(--text-dim);
    background: none;
    border: none;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .refresh:hover:not(:disabled) {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .refresh:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dim {
    color: var(--text-dim);
  }
  .total {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    font-variant-numeric: tabular-nums;
  }
  .big {
    font-size: 1.05rem;
    font-weight: 600;
  }
  .of {
    color: var(--text-dim);
  }
  .pct {
    margin-left: auto;
    color: var(--text-dim);
  }

  .bar {
    position: relative;
    display: flex;
    height: 0.62rem;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    margin-bottom: 0.55rem;
    gap: 1px;
  }
  .seg {
    min-width: 0;
    background: oklch(0.72 0.11 var(--hue, 0));
  }
  .seg.free {
    background: transparent;
  }
  .seg.buffer {
    background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0 2px, transparent 2px 5px);
  }
  /* An apportioned figure rather than a counted one: hatched. */
  .seg.est,
  .dot.est {
    background-image: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.28) 0 2px, transparent 2px 5px);
    background-color: oklch(0.72 0.11 var(--hue, 0));
  }
  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    opacity: 0.85;
  }

  .legend {
    list-style: none;
    margin: 0 0 0.55rem;
    padding: 0;
    display: grid;
    gap: 0.22rem;
  }
  .legend li {
    display: grid;
    grid-template-columns: 0.6rem 1fr auto 2.8rem;
    align-items: center;
    gap: 0.45rem;
    font-variant-numeric: tabular-nums;
  }
  .legend li.free,
  .legend li.buffer {
    color: var(--text-dim);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 3px;
    background: oklch(0.72 0.11 var(--hue, 0));
  }
  .dot.free {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.25);
  }
  .dot.buffer {
    background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.25) 0 2px, transparent 2px 4px);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .share {
    text-align: right;
    color: var(--text-dim);
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.22rem 0.7rem;
    margin: 0;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .facts dt {
    color: var(--text-dim);
  }
  .facts dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note {
    margin-top: 0.5rem;
    font-size: 0.68rem;
    line-height: 1.4;
    color: var(--text-dim);
  }
  .note.err {
    color: var(--danger);
  }
</style>

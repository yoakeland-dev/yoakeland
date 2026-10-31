<script lang="ts">
  // The desktop's status bar has no room on a phone, so its facts live here: one calm line under
  // Home's title with the counts that matter, and a sheet behind it with the rest (servers,
  // activity, subscription limits, spend).
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { usd } from "../format";
  import { level, limitCards, resetText } from "../rateLimits";
  import SheetDialog from "./SheetDialog.svelte";
  import Icon from "./Icon.svelte";

  const servers = $derived(Object.values(app.servers));
  const connected = $derived(servers.filter((s) => s.connectionStatus === "connected"));
  const waiting = $derived(new Set(servers.flatMap((s) => s.pendingAsks.map((a) => s.connectionId + a.sessionId))).size);
  const running = $derived(
    servers.reduce(
      (n, s) => n + Object.entries(s.activeTurnBySession).filter(([id, t]) => !!t && !s.pendingAsks.some((a) => a.sessionId === id)).length,
      0,
    ),
  );
  const queued = $derived(servers.reduce((n, s) => n + (s.serverStatus?.queuedTurns ?? 0), 0));
  const reporting = $derived(servers.filter((s) => s.serverStatus?.spend));
  const spend = $derived({
    today: reporting.length
      ? reporting.reduce((n, s) => n + s.serverStatus!.spend!.todayUsd, 0)
      : app.spendToday.day === new Date().toDateString()
        ? app.spendToday.usd
        : 0,
    month: reporting.length ? reporting.reduce((n, s) => n + s.serverStatus!.spend!.monthUsd, 0) : undefined,
  });
  const cards = $derived(limitCards(servers));

  const health = (s: (typeof servers)[number]) => {
    const st = s.serverStatus;
    if (!st) return "";
    const cpu = st.load1 != null && st.cpus ? `CPU ${Math.round((st.load1 / st.cpus) * 100)}%` : "";
    const mem = st.memTotalBytes && st.memAvailBytes != null ? `Memory ${Math.round(((st.memTotalBytes - st.memAvailBytes) / st.memTotalBytes) * 100)}%` : "";
    return [cpu, mem].filter(Boolean).join(" · ");
  };
  const dot = (s: (typeof servers)[number]) => (s.connectionStatus === "connected" ? "ok" : s.connectionStatus === "connecting" ? "wait" : "bad");

  let open = $state(false);
  const lead = $derived(connected.length ? (connected.length === 1 ? connected[0].label : `${connected.length} servers`) : "Offline");
</script>

{#if servers.length}
  <button type="button" class="line" onclick={() => (open = true)} aria-label="Status">
    <span class="dot" class:off={!connected.length}></span>
    <span class="txt"><b>{lead}</b>{#if waiting} · {waiting} waiting{/if}{#if running} · {running} running{/if}{#if spend.today > 0} · {usd(spend.today)} today{/if}</span>
    <Icon name="chevron-right" size={16} />
  </button>
{/if}

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <SheetDialog variant="tall" class="dialog-content status-sheet">
      <Dialog.Title class="title">Status</Dialog.Title>
      <div class="body">
        <h3>Right now</h3>
        <div class="group">
          <div class="r"><span class="t">Waiting on you</span><span class="v">{waiting}</span></div>
          <div class="r"><span class="t">Running</span><span class="v">{running}</span></div>
          <div class="r"><span class="t">Queued turns</span><span class="v">{queued}</span></div>
        </div>

        <h3>Servers</h3>
        <div class="group">
          {#each servers as s (s.connectionId)}
            <div class="r col">
              <div class="kv"><span class="lamp {dot(s)}"></span><b class="t">{s.label}</b><span class="v">{s.connectionStatus}</span></div>
              {#if health(s)}<small>{health(s)}</small>{/if}
            </div>
          {/each}
        </div>

        {#if cards.length}
          <h3>Usage</h3>
          <div class="group">
            {#each cards as c (c.id)}
              {#each c.windows as w (w.label)}
                <div class="r col">
                  <div class="kv"><span class="t">{c.title} · {w.label}</span><span class="v">{w.pct}%</span></div>
                  <div class="meter {level(w.pct)}"><i style:width="{Math.min(100, w.pct)}%"></i></div>
                  {#if w.resetsAt}<small>Resets {resetText(w.resetsAt, app.now)}</small>{/if}
                </div>
              {/each}
            {/each}
          </div>
        {/if}

        <h3>Spend</h3>
        <div class="group">
          <div class="r"><span class="t">Today</span><span class="v">{usd(spend.today)}</span></div>
          {#if spend.month != null}<div class="r"><span class="t">This month</span><span class="v">{usd(spend.month)}</span></div>{/if}
        </div>
        <p class="cap">Counted on the server, across every device.</p>

        <div class="group go">
          <button
            type="button"
            class="r"
            onclick={() => {
              open = false;
              app.showUsage = true;
            }}
          >
            <span class="t">Usage details</span><Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: calc(100% - 2rem);
    min-height: 2.2rem;
    margin: 0 1rem 0.4rem;
    padding: 0 0.25rem;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    position: relative;
  }
  .line::after {
    content: "";
    position: absolute;
    inset: -0.4rem -0.5rem;
  }
  .line :global(svg) {
    margin-left: auto;
    opacity: 0.6;
    flex: none;
  }
  .txt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt b {
    color: var(--text);
    font-weight: 600;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--success);
  }
  .dot.off {
    background: var(--text-dim);
  }

  :global(.status-sheet) {
    display: flex;
    flex-direction: column;
    padding: 0 !important;
  }
  :global(.status-sheet .title) {
    margin: 0;
    padding: 0.2rem 1.25rem 0.5rem;
    font-size: 1.1rem;
    font-weight: 700;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: max(var(--safe-bottom, 0px), 1.5rem);
  }
  h3 {
    margin: 1.3rem 1.75rem 0.45rem;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .group {
    margin: 0 0.75rem;
    overflow: hidden;
    border-radius: 20px;
    background: var(--wash-2);
  }
  .r {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.2rem;
    padding: 0.55rem 1rem;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .r + .r::before {
    content: "";
    position: absolute;
    top: 0;
    left: 1rem;
    right: 0;
    height: 1px;
    background: var(--wash-2);
  }
  .r.col {
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }
  button.r:active {
    background: var(--wash-3);
  }
  .t {
    flex: 1;
    min-width: 0;
  }
  .v {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .kv {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  small {
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .lamp {
    align-self: center;
    width: 0.6rem;
    height: 0.6rem;
    flex: none;
    border-radius: 50%;
    background: var(--success);
  }
  .lamp.bad {
    background: var(--danger);
  }
  .lamp.wait {
    background: var(--warning);
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--wash-3);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--accent);
  }
  .meter.hot i {
    background: var(--warning);
  }
  .meter.full i {
    background: var(--danger);
  }
  .cap {
    margin: 0.5rem 1.75rem 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .group.go {
    margin-top: 1.3rem;
  }
</style>

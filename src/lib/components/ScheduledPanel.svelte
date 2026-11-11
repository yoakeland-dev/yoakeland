<script lang="ts">
  import { app } from "../state.svelte";
  import { cancelScheduled, pauseScheduled } from "../ipc";
  import { tip } from "../tooltip.svelte";
  import Icon from "./Icon.svelte";
  import type { ScheduledTurn } from "../types";

  let { sessionId }: { sessionId: string } = $props();

  const cid = $derived(app.activeConnectionId);
  // Waiting turns only. A "now" turn (a widget click) is the generation you're already watching, not a queue entry.
  const entries = $derived(
    (app.active?.schedules ?? []).filter((e) => e.sessionId === sessionId && e.trigger.kind !== "now" && ["pending", "running", "paused"].includes(e.status)),
  );
  const allPaused = $derived(!!app.active?.allPaused);
  let open = $state(false);

  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function every(ms: number) {
    const min = Math.round(ms / 60000);
    return min % 60 === 0 && min >= 60 ? `${min / 60} h` : `${min} min`;
  }
  function trigger(e: ScheduledTurn) {
    const t = e.trigger;
    if (t.kind === "at") return `at ${clock(t.atMs ?? 0)}`;
    if (t.kind === "limit_reset") return "when limits reset";
    if (t.kind === "repeat") return `every ${every(t.everyMs ?? 0)} · ${e.runs}/${t.maxRuns || "∞"}`;
    return "now";
  }
  const next = (e: ScheduledTurn) => (e.nextRunAtMs ? `next ${clock(e.nextRunAtMs)}` : "");
</script>

{#if entries.length > 0}
  <div class="sched">
    <button type="button" class="head" aria-expanded={open} onclick={() => (open = !open)}>
      <Icon name="clock" size={12} />
      <span class="now">{entries.length} scheduled{allPaused ? " · all paused" : ""}</span>
      <Icon name={open ? "chevron-down" : "chevron-up"} size={14} />
    </button>
    {#if open}
      <ul>
        {#each entries as e (e.id)}
          <li class={e.status}>
            <div class="main">
              <span class="text">{e.text}</span>
              <span class="meta">
                {trigger(e)}{next(e) ? ` · ${next(e)}` : ""}{e.status === "paused" ? " · paused" : ""}
                {#if e.status === "running"}<span class="badge">Autonomous</span>{/if}
                {#if e.error}<span class="err">{e.error}</span>{/if}
              </span>
            </div>
            {#if cid}
              {#if e.status !== "running"}
                <button class="ic" aria-label={e.status === "paused" ? "Resume" : "Pause"} {@attach tip(e.status === "paused" ? "Resume" : "Pause")} onclick={() => pauseScheduled(cid, { id: e.id, paused: e.status !== "paused" })}>
                  <Icon name={e.status === "paused" ? "player-play" : "pause"} size={13} />
                </button>
              {/if}
              <button class="ic" aria-label="Cancel" {@attach tip("Cancel")} onclick={() => cancelScheduled(cid, e.id)}><Icon name="xmark" size={13} /></button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if cid}
        <div class="foot">
          <button class="all" onclick={() => pauseScheduled(cid, { all: true, paused: !allPaused })}>{allPaused ? "Resume all" : "Pause all"}</button>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .sched {
    position: relative;
    z-index: 0;
    margin: 0 22px -1px;
    background: var(--panel-bg);
    border: 1px solid var(--float-border);
    border-bottom: 0;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    font-size: var(--text-label-size);
    pointer-events: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.36rem 0.71rem;
    background: none;
    border: 0;
    color: var(--text-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .now {
    flex: 1;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 0.71rem 0.25rem;
    max-height: 9.5rem;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.18rem 0;
    color: var(--text-dim);
  }
  li.paused .text {
    opacity: 0.6;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .text {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-variant-numeric: tabular-nums;
  }
  .badge {
    margin-left: 0.4rem;
    padding: 0 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--bg, #fff);
    font-size: 0.79rem;
  }
  .err {
    margin-left: 0.4rem;
    color: var(--danger, #d44);
  }
  .ic,
  .all {
    background: none;
    border: 0;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: var(--radius-sm);
    font: inherit;
  }
  .ic:hover,
  .all:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .foot {
    padding: 0 0.71rem 0.4rem;
  }
  .all {
    padding: 0.15rem 0.4rem;
  }
</style>

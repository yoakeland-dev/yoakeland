<script lang="ts">
  // The chat is stuck at the provider's usage limit: say when it resets and what happens next.
  // Sits on the composer's top edge like ScheduledPanel, but louder.
  import { onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { app } from "../state.svelte";
  import { cancelScheduled, limitContinue, limitDismiss } from "../ipc";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);
  const hit = $derived(server?.limitHits.find((h) => h.sessionId === sessionId));
  const armed = $derived(
    server?.schedules.find((e) => e.sessionId === sessionId && e.origin?.label === "limit-continue" && ["pending", "paused", "running"].includes(e.status)),
  );
  const stop = $derived(server?.limitAction === "stop");

  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 30_000);
  onDestroy(() => clearInterval(timer));

  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " " + clock(ms);
  function until(ms: number) {
    const mins = Math.max(0, Math.ceil((ms - now) / 60000));
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }
  const at = $derived(hit ? (armed?.nextRunAtMs ?? hit.resetsAtMs) : 0);
  const est = $derived(hit?.estimated ? " (estimated)" : "");
  const dismiss = () => cid && limitDismiss(cid, sessionId);
  function cancel() {
    if (!cid) return;
    if (armed) cancelScheduled(cid, armed.id);
    limitDismiss(cid, sessionId);
  }
</script>

{#if hit && cid}
  <div class="limit" role="status" transition:fade={{ duration: 120 }}>
    <div class="body">
      <Icon name="warning" size={14} />
      <div class="text">
        {#if armed?.status === "running"}
          <strong>Continuing now…</strong>
        {:else if armed}
          <strong>{(hit.attempt ?? 0) > 0 ? "Still limited — trying again at" : "Continuing automatically at"} {clock(at)}</strong>
          <span class="sub">in {until(at)}{est}</span>
        {:else if hit.gaveUp}
          <strong>Still limited after {hit.attempt ?? 0} tries</strong>
        {:else if hit.tooFar}
          <strong>Limit resets on {date(hit.resetsAtMs)}</strong>
          <span class="sub">Too far away to wait for automatically.</span>
        {:else}
          <strong>Usage limit reached</strong>
          <span class="sub">Resets about {clock(hit.resetsAtMs)} (in {until(hit.resetsAtMs)}){est}</span>
          <span class="sub">Or switch to another model and send a message.</span>
        {/if}
      </div>
    </div>
    {#if armed?.status !== "running"}
      <div class="actions">
        {#if armed}
          <button type="button" onclick={cancel}>Cancel</button>
        {:else}
          {#if !hit.tooFar && !stop}
            <button type="button" class="primary" onclick={() => limitContinue(cid, sessionId)}>{hit.gaveUp ? "Try again" : "Continue when it resets"}</button>
          {/if}
          <button type="button" onclick={dismiss}>Dismiss</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .limit {
    position: relative;
    z-index: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 22px -1px;
    padding: 0.55rem 0.8rem;
    background: color-mix(in srgb, var(--danger) 12%, var(--panel-bg));
    border: 1px solid var(--float-border);
    border-bottom: 0;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    font-size: var(--text-label-size);
    pointer-events: auto;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    color: var(--danger);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  strong {
    color: var(--text);
    font-weight: 600;
  }
  .sub {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  button {
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--float-border);
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--sidebar-hover);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg, #fff);
  }
  @media (max-width: 560px) {
    .limit {
      flex-direction: column;
      align-items: stretch;
    }
    .actions {
      justify-content: flex-start;
    }
  }
</style>

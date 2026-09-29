<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import { approvePlan } from "../ipc";
  import { MODE_BY_ID, LADDER, sessionModes } from "../modes";
  import type { ChatMode } from "../types";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);
  const plan = $derived(server?.planBySession[sessionId]);
  // Only a chat still in Plan has something to approve; once it is carried out the panel is a record.
  const planning = $derived(server?.modeBySession[sessionId] === "plan");
  // Carry it out on any rung but Read, Edit first: the plan already says what to change.
  const rungs = $derived(LADDER.filter((m) => m.id !== "read_only" && sessionModes(server, sessionId).available.includes(m.id)));
  const preferred = $derived<ChatMode>(rungs.some((m) => m.id === "accept_edits") ? "accept_edits" : "read_write");

  function close() {
    if (server?.openPlanSessionId === sessionId) server.openPlanSessionId = null;
  }

  function approve(mode: ChatMode) {
    if (cid) approvePlan(cid, sessionId, mode);
  }
</script>

{#if plan}
  <aside class="plan-panel">
    <div class="plan-header">
      <span class="plan-title"><Icon name="clipboard-list" size={14} /> Plan</span>
      <button type="button" class="icon-chip" {@attach tip("Close")} onclick={close}>
        <Icon name="xmark" size={14} />
      </button>
    </div>
    <div class="plan-body">
      <Markdown text={plan.content} />
    </div>
    {#if planning}
      <div class="plan-actions">
        <span class="lead">Carry it out in</span>
        {#each rungs as m (m.id)}
          <button
            type="button"
            class={m.id === preferred ? "approve" : "ghost"}
            {@attach tip(m.id === preferred ? "Approve the plan" : `Approve the plan and run it in ${m.label}`)}
            onclick={() => approve(m.id)}
          >
            <Icon name={MODE_BY_ID[m.id].icon as any} size={13} />{m.label}
          </button>
        {/each}
      </div>
      <p class="revise">Or say what to change in the message box.</p>
    {/if}
  </aside>
{/if}

<style>
  .plan-panel {
    position: absolute;
    top: calc(var(--header-height) + 12px);
    right: 12px;
    bottom: calc(var(--composer-height, 90px) + 24px);
    width: min(24rem, calc(100% - 2rem));
    display: flex;
    flex-direction: column;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    z-index: 3;
  }
  .plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.71rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .plan-title {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }
  .icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.71rem;
    height: 1.71rem;
    background: transparent;
    border: none;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .icon-chip:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .plan-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.71rem;
    font-size: 0.85rem;
  }
  .plan-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.71rem 0.71rem 0.36rem;
    border-top: 1px solid var(--panel-border);
  }
  .lead {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    margin-right: 0.15rem;
  }
  .revise {
    margin: 0;
    padding: 0 0.71rem 0.71rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .plan-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    flex: 1;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.71rem;
    font-size: var(--text-label-size);
    font-weight: 600;
    cursor: pointer;
  }
  .approve {
    background: var(--accent);
    color: #0d1020;
  }
  .ghost {
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
  }
</style>

<script lang="ts">
  // A subagent call (`subagent`, or a CLI agent's Task): its task, what it's doing right now, the
  // calls it made, and its report. Its own calls never mix into the chat's timeline (§3.2
  // `parentToolCallId`); they live here.
  import { untrack } from "svelte";
  import { fade } from "svelte/transition";
  import type { ToolCallEntry } from "../types";
  import { activityFor } from "../toolMeta";
  import { IN_FLIGHT, isSubagentCall, subagentTitle } from "../subagents";
  import ToolCallCard from "./ToolCallCard.svelte";
  import SubagentCard from "./SubagentCard.svelte";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";

  let { call, open = false }: { call: ToolCallEntry; open?: boolean } = $props();

  // Only where it starts; the user's own toggling wins afterwards.
  let expanded = $state(untrack(() => open));
  let showTask = $state(false);

  const run = $derived(call.subagent);
  const calls = $derived(run?.calls ?? []);
  const running = $derived(IN_FLIGHT.has(call.status));
  const failed = $derived(call.status === "error" || call.status === "denied");
  const asking = $derived(calls.find((c) => c.status === "awaiting_permission" || c.status === "awaiting_answer"));
  const latest = $derived(calls.findLast((c) => IN_FLIGHT.has(c.status)) ?? calls[calls.length - 1]);
  const prompt = $derived(typeof call.args?.prompt === "string" ? call.args.prompt : "");
  // Its report is the call's result; while it works, whatever it has written so far.
  const report = $derived(call.output || (running ? run?.text : "") || "");

  const status = $derived(
    asking ? (asking.status === "awaiting_answer" ? "needs an answer" : "needs approval") : running ? "working" : failed ? "failed" : "done",
  );
  const counts = $derived(calls.length ? `${calls.length} tool${calls.length === 1 ? "" : "s"}` : "");

  // Something inside needs the user: open up so the ask is in view.
  $effect(() => {
    if (asking) expanded = true;
  });
</script>

<div class="subagent" class:running class:failed class:asking={!!asking}>
  <button type="button" class="head" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
    <span class="icon" class:spin={running && !asking}>
      {#if running && !asking}
        <span transition:fade={{ duration: 140 }}><Icon name="loader-2" size={14} /></span>
      {:else}
        <span transition:fade={{ duration: 140 }}><Icon name={failed ? "alert-circle" : "robot"} size={14} /></span>
      {/if}
    </span>
    <span class="title-col">
      <span class="title">{subagentTitle(call)}</span>
      {#if running && latest}
        <span class="activity">{asking ? activityFor(asking) : activityFor(latest)}</span>
      {/if}
    </span>
    {#if counts}<span class="meta">{counts}</span>{/if}
    <span class="status">{status}</span>
    <span class="chevron" class:open={expanded}><Icon name="chevron-right" size={13} /></span>
  </button>

  <div class="accordion" class:open={expanded}>
    <div class="accordion-inner">
      <div class="body">
        {#if prompt}
          <button type="button" class="task-toggle" onclick={() => (showTask = !showTask)}>
            <Icon name={showTask ? "chevron-down" : "chevron-right"} size={12} /> Task
          </button>
          {#if showTask}<pre class="task selectable">{prompt}</pre>{/if}
        {/if}
        {#if calls.length}
          <div class="steps">
            {#each calls as c (c.toolCallId)}
              {#if isSubagentCall(c)}
                <SubagentCard call={c} />
              {:else}
                <ToolCallCard call={c} />
              {/if}
            {/each}
          </div>
        {:else if running}
          <div class="empty">Starting…</div>
        {/if}
        {#if report}
          <div class="report" class:live={running}>
            <Markdown text={report} live={running} />
          </div>
        {/if}
        {#if call.error}
          <pre class="error selectable">{call.error}</pre>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .subagent {
    container-type: inline-size;
    margin: 0.43rem 0;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
    overflow: hidden;
  }
  .subagent.running {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--panel-border));
  }
  .subagent.asking {
    border-color: color-mix(in srgb, var(--warning) 55%, var(--panel-border));
  }
  .subagent.failed {
    background: var(--danger-dim);
    border-color: color-mix(in srgb, var(--danger) 35%, var(--panel-border));
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.57rem 0.71rem;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }
  .head:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .icon {
    position: relative;
    flex: none;
    width: 1rem;
    height: 1rem;
    color: var(--accent);
  }
  .icon > span {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .failed .icon {
    color: var(--danger);
  }
  .icon.spin :global(svg) {
    animation: spin calc(1s * var(--icon-slow, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .title-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .title,
  .activity {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-weight: 600;
  }
  .activity {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .meta,
  .status {
    flex: none;
    font-size: 0.7rem;
    color: var(--text-dim);
  }
  .status {
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  /* Narrow (the side panel): the title matters more than the tool count. */
  @container (max-width: 22rem) {
    .meta {
      display: none;
    }
  }
  .asking .status {
    color: var(--warning);
  }
  .failed .status {
    color: var(--danger);
  }
  .chevron {
    flex: none;
    display: flex;
    color: var(--text-dim);
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .accordion {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows calc(0.22s * var(--anim-speed, 1)) ease;
  }
  .accordion.open {
    grid-template-rows: 1fr;
  }
  .accordion-inner {
    overflow: hidden;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    padding: 0 0.71rem 0.71rem;
    /* A thread line down the left marks everything here as the subagent's, not the chat's. */
    margin-left: 0.5rem;
    border-left: 2px solid var(--panel-border);
    padding-left: 0.71rem;
  }
  .task-toggle {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 0.21rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
  }
  .task-toggle:hover {
    color: var(--text);
  }
  pre {
    margin: 0;
    padding: var(--space-1);
    background: rgba(0, 0, 0, 0.25);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 16rem;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .steps :global(.card),
  .steps :global(.subagent) {
    margin: 0.21rem 0;
  }
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
  }
  .report {
    font-size: 0.9em;
  }
  .report.live {
    color: var(--text-dim);
  }
  .error {
    color: var(--danger);
  }
</style>

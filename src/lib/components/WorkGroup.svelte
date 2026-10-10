<script lang="ts">
  import { fly, fade } from "svelte/transition";
  import type { AssistantStep } from "../types";
  import { metaFor, summaryFor, briefFor } from "../toolMeta";
  import { heldLabel } from "../heldLabel.svelte";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import Icon from "./Icon.svelte";

  // Used only when `steps` contains a thought; pure tool-call runs render as a plain
  // ToolCallGroup instead. `live` covers a thought step, which carries no status of its own.
  let { steps, live }: { steps: AssistantStep[]; live: boolean } = $props();

  let expanded = $state(false);

  const IN_FLIGHT = new Set(["requested", "awaiting_permission", "running"]);
  const allCalls = $derived(steps.flatMap((s) => (s.kind === "cluster" ? s.calls : [])));
  const isRunning = $derived(live || allCalls.some((c) => IN_FLIGHT.has(c.status)));
  const hasError = $derived(allCalls.some((c) => c.status === "error" || c.status === "denied"));

  // Always has at least one thought (the reason this component is used at all), so the prefix is unconditional.
  const brief = $derived(`Thought, then ${briefFor(allCalls, { capitalize: false })}`);

  const lastStep = $derived(steps[steps.length - 1]);
  const latestKey = $derived(
    lastStep?.kind === "cluster" ? lastStep.calls[lastStep.calls.length - 1]?.toolCallId : `thought-${lastStep?.kind === "thought" ? lastStep.at : ""}`,
  );
  const latestLabel = $derived.by(() => {
    if (!lastStep) return "";
    if (lastStep.kind === "thought") return "Thinking…";
    const call = lastStep.calls[lastStep.calls.length - 1];
    if (!call) return "";
    const label = metaFor(call).label;
    const summary = summaryFor(call);
    return summary ? `${label} — ${summary}` : label;
  });

  // Same held-label treatment as ToolCallGroup's header: momentary flash only, no persistent checkmark.
  const held = heldLabel(() => ({
    key: isRunning ? latestKey : "done",
    label: isRunning ? latestLabel : brief,
    hasError,
  }));

  // At rest, uses the same brain icon as a standalone ThinkingBlock thought.
</script>

<div class="group">
  <button class="head" onclick={() => (expanded = !expanded)}>
    <span class="icon-slot">
      {#if held.flashing}
        <span class="status-icon check" transition:fade={{ duration: 160 }}><Icon name="circle-check" size={14} /></span>
      {:else if isRunning}
        <span class="status-icon spin" transition:fade={{ duration: 160 }}><Icon name="loader-2" size={14} /></span>
      {:else}
        <span class="status-icon rest" class:err={hasError} transition:fade={{ duration: 160 }}><Icon name="brain" size={14} /></span>
      {/if}
      <span class="chevron-icon" class:open={expanded}><Icon name="chevron-right" size={14} /></span>
    </span>
    <span class="label-slot">
      {#key held.key}
        <span class="label" in:fly={{ y: 6, duration: 140 }} out:fly={{ y: -6, duration: 140 }}>
          {held.label}
        </span>
      {/key}
    </span>
  </button>
  <div class="accordion" class:open={expanded}>
    <div class="accordion-inner">
      <div class="body">
        <!-- A list of stops: a thought is its own bordered paragraph (the
             line marks it as reasoning), and a run of tool calls is its own
             subgroup, the exact same ToolCallGroup a thought-free run
             renders at the top level, collapsed to "Ran N commands" until
             opened. Tool calls stay grouped together until a thought (or
             the run ending) breaks them up, same as AssistantMessage.svelte
             already clusters them. One final "Done" stop closes the chain
             once nothing's left running. -->
        {#each steps as step (step.kind === "thought" ? `thought-${step.at}` : `cluster-${step.calls[0]?.toolCallId}`)}
          {#if step.kind === "thought"}
            <p class="thought-text">{step.text.trimEnd()}</p>
          {:else}
            <ToolCallGroup calls={step.calls} />
          {/if}
        {/each}
        {#if !isRunning}
          <div class="done-stop">
            <span class="done-icon" class:err={hasError}><Icon name={hasError ? "alert-circle" : "circle-check"} size={14} /></span>
            <span>Done</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .group {
    margin: 0.43rem 0;
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.29rem 0;
    cursor: pointer;
    font-size: 0.8rem;
    font-family: ui-monospace, monospace;
    text-align: left;
  }
  /* Same cross-fade slot as ToolCallCard/ToolCallGroup. */
  .icon-slot {
    position: relative;
    width: 1rem;
    height: 1rem;
    flex: none;
  }
  .icon-slot > span {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .status-icon.spin :global(svg) {
    animation: spin calc(1s * var(--icon-slow, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .status-icon.check,
  .status-icon.rest {
    color: var(--text-dim);
  }
  .status-icon.rest.err {
    color: var(--danger);
  }
  .chevron-icon {
    opacity: 0;
    transform: scale(0.6) rotate(0deg);
  }
  .chevron-icon.open {
    transform: scale(0.6) rotate(90deg);
  }
  .head:hover .status-icon,
  .head:focus-visible .status-icon {
    opacity: 0;
    transform: scale(0.6);
  }
  .head:hover .chevron-icon,
  .head:focus-visible .chevron-icon {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  .head:hover .chevron-icon.open,
  .head:focus-visible .chevron-icon.open {
    transform: scale(1) rotate(90deg);
  }
  .label-slot {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 1.2em;
  }
  .label {
    position: absolute;
    inset: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
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
    padding-top: 0.14rem;
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
  }
  /* ToolCallGroup's own margin is for sitting between message segments; here the body's `gap`
     already spaces it, so the margin would double up. */
  .body :global(.group) {
    margin: 0;
  }
  .thought-text {
    margin: 0;
    padding-left: 0.57rem;
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
    font-style: italic;
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .done-stop {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-dim);
    font-size: 0.8rem;
    font-family: ui-monospace, monospace;
  }
  .done-icon {
    display: inline-flex;
    color: var(--text-dim);
  }
  .done-icon.err {
    color: var(--danger);
  }
</style>

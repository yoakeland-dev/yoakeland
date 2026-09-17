<script lang="ts">
  import { fade } from "svelte/transition";
  import type { ToolCallEntry } from "../types";
  import { toolMeta, summaryFor } from "../toolMeta";
  import DiffView from "./DiffView.svelte";
  import Icon from "./Icon.svelte";

  let { call }: { call: ToolCallEntry } = $props();

  let expanded = $state(false);

  const statusLabel: Record<ToolCallEntry["status"], string> = {
    requested: "queued",
    awaiting_permission: "needs permission",
    running: "running",
    done: "done",
    denied: "denied",
    error: "error",
  };

  const meta = $derived(toolMeta[call.name]);
  const summary = $derived(summaryFor(call));
  const isBusy = $derived(call.status === "running" || call.status === "requested");
  const isError = $derived(call.status === "error" || call.status === "denied");

  // A persistent green check on a card that's just sitting there done adds
  // nothing you didn't already know — but the *moment* it finishes is worth
  // a beat of feedback. So: flash the tool icon over to a (muted, not
  // green) checkmark right as the status flips to done, then fade back to
  // the tool's own icon a moment later. Skipped for a card that was already
  // done on mount (reloaded history) — `prevStatus` starts undefined, which
  // never matches the "just turned done" transition below.
  let prevStatus: ToolCallEntry["status"] | undefined = undefined;
  let flashDone = $state(false);
  $effect(() => {
    const cur = call.status;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (prevStatus !== undefined && prevStatus !== "done" && cur === "done") {
      flashDone = true;
      timer = setTimeout(() => (flashDone = false), 500);
    }
    prevStatus = cur;
    return () => clearTimeout(timer);
  });
</script>

<div class="card status-{call.status}">
  <button class="head" onclick={() => (expanded = !expanded)}>
    <span class="icon-slot">
      {#if flashDone}
        <span class="check-icon" transition:fade={{ duration: 160 }}><Icon name="circle-check" size={14} /></span>
      {:else if isBusy}
        <span class="spin-icon" transition:fade={{ duration: 160 }}><Icon name="loader-2" size={14} /></span>
      {:else}
        <span class="tool-icon" class:err={isError} transition:fade={{ duration: 160 }}><Icon name={meta?.icon ?? "square"} size={14} /></span>
      {/if}
      <span class="chevron-icon" class:open={expanded}><Icon name="chevron-right" size={14} /></span>
    </span>
    <span class="name">{meta?.label ?? call.name}</span>
    {#if summary}
      <span class="summary">{summary}</span>
    {/if}
    <span class="status">{statusLabel[call.status]}</span>
  </button>
  <div class="accordion" class:open={expanded}>
    <div class="accordion-inner">
      <div class="body">
        <pre class="args selectable">{JSON.stringify(call.args, null, 2)}</pre>
        {#if call.diff}
          <DiffView diff={call.diff} />
        {/if}
        {#if call.output}
          <pre class="output selectable">{call.output}</pre>
        {/if}
        {#if call.error}
          <pre class="output error selectable">{call.error}</pre>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .card {
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.03);
    margin: 0.43rem 0;
    overflow: hidden;
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    color: var(--text);
    padding: 0.57rem 0.71rem;
    cursor: pointer;
    font-size: 0.8rem;
    font-family: ui-monospace, monospace;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .head:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  /* Tool icon and chevron sit stacked in the same slot, cross-fading on
     hover so the affordance to open the card only shows up when it's
     actionable — resting state reads as "here's what kind of call this is". */
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
  .tool-icon {
    color: var(--text-dim);
  }
  .tool-icon.err {
    color: var(--danger);
  }
  .spin-icon,
  .check-icon {
    color: var(--text-dim);
  }
  .spin-icon :global(svg) {
    animation: spin calc(1s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .chevron-icon {
    color: var(--text-dim);
    opacity: 0;
    transform: scale(0.6) rotate(0deg);
  }
  .chevron-icon.open {
    transform: scale(0.6) rotate(90deg);
  }
  .head:hover .tool-icon,
  .head:hover .spin-icon,
  .head:hover .check-icon,
  .head:focus-visible .tool-icon,
  .head:focus-visible .spin-icon,
  .head:focus-visible .check-icon {
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
  .name {
    flex: none;
    font-weight: 600;
  }
  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    text-align: left;
  }
  .status {
    flex: none;
    font-size: 0.7rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .status-error,
  .status-denied {
    background: var(--danger-dim);
    border-color: color-mix(in srgb, var(--danger) 35%, var(--panel-border));
  }
  .status-error .status,
  .status-denied .status {
    color: var(--danger);
  }
  .status-done .status {
    color: var(--success);
  }
  /* Zero-JS accordion: animating grid-template-rows between 0fr and 1fr lets
     the browser animate to the row's real content height, so it stays
     buttery smooth for a three-line diff or a huge command dump alike
     without measuring anything in JS. */
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
    padding: 0 0.71rem 0.71rem;
  }
  pre {
    margin: 0.43rem 0 0;
    padding: var(--space-1);
    background: rgba(0, 0, 0, 0.25);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .output.error {
    color: var(--danger);
  }
</style>

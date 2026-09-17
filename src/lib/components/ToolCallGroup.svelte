<script lang="ts">
  import { fly, fade } from "svelte/transition";
  import type { ToolCallEntry } from "../types";
  import { toolMeta, summaryFor, briefFor } from "../toolMeta";
  import { heldLabel } from "../heldLabel.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import Icon from "./Icon.svelte";

  let { calls }: { calls: ToolCallEntry[] } = $props();

  let expanded = $state(false);

  const IN_FLIGHT = new Set(["requested", "awaiting_permission", "running"]);
  const isRunning = $derived(calls.some((c) => IN_FLIGHT.has(c.status)));
  const hasError = $derived(calls.some((c) => c.status === "error" || c.status === "denied"));
  // The call to headline while the group is still going — the most recent
  // one, so a fresh call sliding in reads as "here's what's happening now".
  const latest = $derived(calls[calls.length - 1]);

  const brief = $derived(briefFor(calls));

  const latestLabel = $derived.by(() => {
    if (!latest) return "";
    const label = toolMeta[latest.name]?.label ?? latest.name;
    const summary = summaryFor(latest);
    return summary ? `${label} — ${summary}` : label;
  });

  // A group that's just sitting there done doesn't need a persistent
  // checkmark — it's the common case, not news. What's worth a beat of
  // feedback is the moment a call actually finishes, so the label holds
  // still for that moment (see heldLabel) while the icon flashes over to a
  // muted check, then both move on to whatever's next.
  const held = heldLabel(() => ({
    key: isRunning ? (latest?.toolCallId ?? "done") : "done",
    label: isRunning ? latestLabel : brief,
    hasError,
  }));

  // At rest, a group shows the specific tool's icon when every call in it
  // is the same tool (same identity ToolCallCard would show) — but a mixed
  // bag of tools has no single honest icon to pick, so it falls back to a
  // generic "tool use" glyph instead of misrepresenting itself as whichever
  // call happens to be latest. Flash/spinner/error still take over it
  // exactly like ToolCallCard's own icon slot does.
  const restIcon = $derived.by(() => {
    const names = new Set(calls.map((c) => c.name));
    if (names.size === 1) return toolMeta[calls[0].name]?.icon ?? "square";
    return "tool";
  });
</script>

<div class="group">
  <button class="head" onclick={() => (expanded = !expanded)}>
    <span class="icon-slot">
      {#if held.flashing}
        <span class="status-icon check" transition:fade={{ duration: 160 }}><Icon name="circle-check" size={14} /></span>
      {:else if isRunning}
        <span class="status-icon spin" transition:fade={{ duration: 160 }}><Icon name="loader-2" size={14} /></span>
      {:else}
        <span class="status-icon rest" class:err={hasError} transition:fade={{ duration: 160 }}><Icon name={restIcon} size={14} /></span>
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
        {#each calls as call (call.toolCallId)}
          <ToolCallCard {call} />
        {/each}
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
  /* Same cross-fade slot as ToolCallCard's icon/chevron — status icon at
     rest, chevron only once hovering signals "this expands". */
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
    animation: spin calc(1s * var(--anim-speed, 1)) linear infinite;
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
  /* The sliding swap between calls needs its own stacking context, same
     0-size-but-not-clipped trick as .icon-slot, so the fly transitions don't
     shove the row's height around while a call enters/exits. */
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
  }
</style>

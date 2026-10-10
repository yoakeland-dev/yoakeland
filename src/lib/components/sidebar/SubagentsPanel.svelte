<script lang="ts">
  // Every subagent this chat's agent started, newest first: the same cards as in the chat, so a
  // long conversation's helpers can be followed without scrolling back to find them.
  import { app } from "../../state.svelte";
  import { IN_FLIGHT, subagentCalls } from "../../subagents";
  import SubagentCard from "../SubagentCard.svelte";
  import EmptyState from "./EmptyState.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const all = $derived(subagentCalls(app.active?.messagesBySession[sessionId]).toReversed());
  const running = $derived(all.filter((c) => IN_FLIGHT.has(c.status)).length);
</script>

{#if !all.length}
  <EmptyState
    icon="robot"
    title="No subagents yet"
    body="Each helper the agent starts shows up here with its progress, tools and report."
  />
{:else}
  <div class="panel">
    <div class="summary">
      {all.length} subagent{all.length === 1 ? "" : "s"}
      {#if running}<span class="live">· {running} running</span>{/if}
    </div>
    <div class="list">
      {#each all as call (call.toolCallId)}
        <SubagentCard {call} open={IN_FLIGHT.has(call.status)} />
      {/each}
    </div>
  </div>
{/if}

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .summary {
    padding: 0.57rem var(--space-2) 0.29rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .live {
    color: var(--accent);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 0 var(--space-1) var(--space-2);
  }
</style>

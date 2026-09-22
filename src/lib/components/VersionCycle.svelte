<script lang="ts">
  import { app } from "../state.svelte";
  import { switchBranch } from "../ipc";
  import type { ChatMessage } from "../types";
  import Icon from "./Icon.svelte";

  let { message, sessionId }: { message: ChatMessage; sessionId: string } = $props();

  // alternateIds (§3.2) is an unordered set of "other versions at this
  // point" — no explicit sequence comes over the wire. Every id observed so
  // far in this protocol is "m" + a monotonically issued number (SPEC.md's
  // own examples), so sorting on that numeric suffix recovers a real
  // creation order and a real "i / N" position instead of a fabricated one.
  // Falls back to encounter order (still cycles correctly, just an arbitrary
  // starting position) if an id doesn't match that shape.
  function order(id: string): number {
    const n = parseInt(id.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  const versions = $derived(
    [message.id, ...(message.alternateIds ?? [])].sort((a, b) => order(a) - order(b)),
  );
  const index = $derived(versions.indexOf(message.id));
  const cid = $derived(app.activeConnectionId);

  function go(delta: number) {
    if (!cid) return;
    const target = versions[index + delta];
    if (target) switchBranch(cid, sessionId, target);
  }
</script>

{#if message.alternateIds?.length}
  <span class="cycle">
    <button class="step" disabled={index <= 0} onclick={() => go(-1)} title="Previous version" aria-label="Previous version">
      <Icon name="chevron-left" size={12} />
    </button>
    <span class="pos">{index + 1} / {versions.length}</span>
    <button
      class="step"
      disabled={index >= versions.length - 1}
      onclick={() => go(1)}
      title="Next version"
      aria-label="Next version"
    >
      <Icon name="chevron-right" size={12} />
    </button>
  </span>
{/if}

<style>
  .cycle {
    display: inline-flex;
    align-items: center;
    gap: 0.14rem;
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0.1rem;
    opacity: 0.8;
  }
  .step:hover:not(:disabled) {
    opacity: 1;
  }
  .step:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .pos {
    font-variant-numeric: tabular-nums;
  }
</style>

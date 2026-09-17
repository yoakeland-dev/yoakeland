<script lang="ts">
  import type { ChatMessage, ToolCallEntry } from "../types";
  import { app } from "../state.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";

  let { message }: { message: ChatMessage } = $props();

  let thinkingOpen = $state(false);

  type Segment = { key: string; kind: "text"; text: string } | { key: string; kind: "tool"; call: ToolCallEntry };

  // Tool calls are appended with the text offset they occurred at (state.svelte.ts),
  // so the reply can be sliced back into the order things actually happened —
  // a card sits right where it was invoked instead of every card stacking above
  // the whole reply. Calls without a recorded offset (rebuilt from persisted
  // history) fall back to 0, i.e. before all text — the same place they
  // rendered before this existed.
  const segments = $derived.by((): Segment[] => {
    const calls = [...message.toolCalls].sort((a, b) => (a.textOffset ?? 0) - (b.textOffset ?? 0));
    const segs: Segment[] = [];
    let cursor = 0;
    for (const call of calls) {
      const offset = Math.min(Math.max(call.textOffset ?? 0, cursor), message.text.length);
      if (offset > cursor) segs.push({ key: `text-${cursor}`, kind: "text", text: message.text.slice(cursor, offset) });
      segs.push({ key: call.toolCallId, kind: "tool", call });
      cursor = offset;
    }
    if (cursor < message.text.length || segs.length === 0) {
      segs.push({ key: `text-${cursor}`, kind: "text", text: message.text.slice(cursor) });
    }
    return segs;
  });
</script>

<div class="assistant">
  {#if message.thinking}
    <button class="thinking-toggle" onclick={() => (thinkingOpen = !thinkingOpen)}>
      <span class="chevron" class:open={thinkingOpen}><Icon name="chevron-right" size={12} /></span> Thinking
    </button>
    <div class="accordion" class:open={thinkingOpen}>
      <div class="accordion-inner">
        <pre class="thinking selectable">{message.thinking}</pre>
      </div>
    </div>
  {/if}

  {#each segments as seg, i (seg.key)}
    {#if seg.kind === "tool"}
      <ToolCallCard call={seg.call} />
    {:else if seg.text || (i === segments.length - 1 && message.streaming)}
      <div class="text">
        <Markdown text={seg.text} />
        {#if i === segments.length - 1 && message.streaming}<span class="cursor"></span>{/if}
      </div>
    {/if}
  {/each}

  {#if !message.text && message.toolCalls.length === 0 && message.streaming}
    <p class="text dim">Thinking…</p>
  {/if}

  {#if message.finish}
    <div
      class="finish"
      class:cancelled={message.finish.finishReason === "cancelled" ||
        message.finish.finishReason === "budget_exceeded" ||
        message.finish.finishReason === "no_provider"}
      class:truncated={message.finish.finishReason === "length"}
    >
      {#if message.finish.finishReason === "cancelled"}
        Cancelled
      {:else if message.finish.finishReason === "budget_exceeded"}
        Session budget exceeded — turn not run
      {:else if message.finish.finishReason === "no_provider"}
        No provider configured yet —
        <button class="link" onclick={() => app.openProviderSettings()}>add one</button>
        and pick it from the toolbar below.
      {:else}
        {message.finish.usage.totalTokens ?? 0} tokens · ${(message.finish.usage.costUsd ?? 0).toFixed(4)} · {((message.finish.durationMs ?? 0) / 1000).toFixed(1)}s
        {#if message.finish.finishReason === "length"}
          · cut off at the output limit
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .assistant {
    padding: 0.14rem 0.29rem;
  }
  .thinking-toggle {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    cursor: pointer;
    padding: 0.29rem 0;
  }
  .chevron {
    display: inline-block;
    transition: transform calc(0.15s * var(--anim-speed, 1));
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  /* Zero-JS accordion: grid-template-rows animates between 0fr and 1fr, so the
     row's content (of whatever height) is what gets measured, not a guessed
     max-height. The inner div needs its own overflow:hidden — a 0fr grid
     track still lets its content paint past the row without one. */
  .accordion {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .accordion.open {
    grid-template-rows: 1fr;
  }
  .accordion-inner {
    overflow: hidden;
  }
  .thinking {
    margin: 0 0 0.57rem;
    padding: 0.57rem 0.71rem;
    background: rgba(255, 255, 255, 0.03);
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
  .text {
    margin: 0.29rem 0;
    font-size: 0.92rem;
  }
  .text :global(.markdown) {
    line-height: 1.55;
  }
  .text.dim {
    color: var(--text-dim);
    font-style: italic;
  }
  .cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1em;
    margin-left: 0.07rem;
    background: var(--text-dim);
    vertical-align: text-bottom;
    animation: blink calc(1s * var(--anim-speed, 1)) step-start infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .finish {
    margin-top: 0.43rem;
    font-size: var(--text-heading-size);
    color: var(--text-dim);
  }
  .finish.cancelled {
    color: var(--danger);
  }
  .finish.truncated {
    color: var(--warning);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
</style>

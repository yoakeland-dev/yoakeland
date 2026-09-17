<script lang="ts">
  import type { AssistantStep, ChatMessage, ToolCallEntry } from "../types";
  import { app } from "../state.svelte";
  import { vendorMetaFor, titleFor, type Entry } from "../modelVendor";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import WorkGroup from "./WorkGroup.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import Markdown from "./Markdown.svelte";
  import ModelPicker from "./ModelPicker.svelte";

  let { message, sessionId }: { message: ChatMessage; sessionId: string } = $props();

  type Segment =
    | { key: string; kind: "text"; text: string }
    | { key: string; kind: "thinking"; text: string }
    | { key: string; kind: "toolgroup"; calls: ToolCallEntry[] }
    | { key: string; kind: "workgroup"; steps: AssistantStep[] };

  // Tool calls are appended with the text/thinking length they occurred at
  // (state.svelte.ts), so the reply can be sliced back into the order things
  // actually happened. A run — everything between two spans of answer text —
  // is built up as an ordered list of steps (a thought, or a cluster of
  // consecutive tool calls with no thought between them) and only decided
  // *after* it closes: a run with no thought in it at all renders as a plain
  // ToolCallGroup (unchanged, the common case for non-reasoning providers);
  // a run with a thought anywhere in it renders as a WorkGroup, which nests
  // each cluster back into its own ToolCallGroup rather than flattening
  // everything — a reasoning model that thinks before every single tool call
  // still collapses into one row, not one row per call. A thought with no
  // tool call ever attached to it (plain reasoning-then-answer, no tools at
  // all) falls out of the same logic as a standalone `thinking` segment.
  const segments = $derived.by((): Segment[] => {
    const calls = [...message.toolCalls].sort((a, b) => (a.textOffset ?? 0) - (b.textOffset ?? 0));
    const segs: Segment[] = [];
    let cursor = 0;
    let thinkCursor = 0;
    const thinkingLen = message.thinking?.length ?? 0;

    let runSteps: AssistantStep[] = [];
    let pendingCluster: ToolCallEntry[] = [];

    function flushCluster() {
      if (pendingCluster.length) {
        runSteps.push({ kind: "cluster", calls: pendingCluster });
        pendingCluster = [];
      }
    }
    function flushRun() {
      flushCluster();
      if (runSteps.length === 0) return;
      const hasCluster = runSteps.some((s) => s.kind === "cluster");
      if (!hasCluster) {
        for (const s of runSteps) {
          if (s.kind === "thought") segs.push({ key: `think-${s.at}`, kind: "thinking", text: s.text });
        }
      } else if (runSteps.some((s) => s.kind === "thought")) {
        const first = runSteps.find((s): s is Extract<AssistantStep, { kind: "cluster" }> => s.kind === "cluster");
        segs.push({ key: `work-${first?.calls[0]?.toolCallId ?? "0"}`, kind: "workgroup", steps: runSteps });
      } else {
        const only = runSteps[0] as Extract<AssistantStep, { kind: "cluster" }>;
        segs.push({ key: `tools-${only.calls[0]?.toolCallId ?? "0"}`, kind: "toolgroup", calls: only.calls });
      }
      runSteps = [];
    }

    for (const call of calls) {
      const offset = Math.min(Math.max(call.textOffset ?? 0, cursor), message.text.length);
      if (offset > cursor) {
        flushRun();
        segs.push({ key: `text-${cursor}`, kind: "text", text: message.text.slice(cursor, offset) });
        cursor = offset;
      }
      const thinkOffset = Math.min(Math.max(call.thinkingOffset ?? 0, thinkCursor), thinkingLen);
      if (thinkOffset > thinkCursor) {
        flushCluster();
        runSteps.push({ kind: "thought", text: message.thinking!.slice(thinkCursor, thinkOffset), at: thinkCursor });
        thinkCursor = thinkOffset;
      }
      pendingCluster.push(call);
    }
    // Trailing reasoning (after the last tool call, before the final answer,
    // or the entirety of a message with no tool calls at all) joins whatever
    // run is still open before that run is decided — matches the
    // think-then-write order a live stream actually happened in.
    if (thinkCursor < thinkingLen) {
      flushCluster();
      runSteps.push({ kind: "thought", text: message.thinking!.slice(thinkCursor), at: thinkCursor });
      thinkCursor = thinkingLen;
    }
    flushRun();
    if (cursor < message.text.length || segs.length === 0) {
      segs.push({ key: `text-${cursor}`, kind: "text", text: message.text.slice(cursor) });
    }
    return segs;
  });

  // Provider/model stamped on the message at send time (state.svelte.ts) —
  // resolved against the live provider/model lists for an icon + display
  // name. Absent for a reply rebuilt from session history (no per-message
  // model info on the wire, §3.2) or if the provider/model was since
  // removed, in which case the footer just omits the model chip.
  const modelEntry = $derived.by((): Entry | null => {
    if (!message.provider || !message.model) return null;
    const provider = app.providers.find((p) => p.name === message.provider);
    if (!provider) return null;
    const model = app.modelsByProvider[message.provider]?.find((m) => m.id === message.model) ?? {
      id: message.model,
    };
    return { provider, model };
  });
  const modelMeta = $derived(modelEntry ? vendorMetaFor(modelEntry) : null);
  const modelTitle = $derived(modelEntry ? titleFor(modelEntry) : "");

  const contextPct = $derived.by(() => {
    const ctx = message.finish?.context;
    if (!ctx || !ctx.maxTokens) return null;
    return Math.min(100, Math.round((ctx.estimatedTokens / ctx.maxTokens) * 100));
  });
</script>

<div class="assistant">
  {#each segments as seg, i (seg.key)}
    {@const live = i === segments.length - 1 && message.streaming}
    {#if seg.kind === "toolgroup"}
      <ToolCallGroup calls={seg.calls} />
    {:else if seg.kind === "workgroup"}
      <WorkGroup steps={seg.steps} {live} />
    {:else if seg.kind === "thinking"}
      <ThinkingBlock text={seg.text} {live} />
    {:else if seg.text || live}
      <div class="text">
        <Markdown text={seg.text} />
        {#if live}<span class="cursor"></span>{/if}
      </div>
    {/if}
  {/each}

  {#if modelMeta || message.finish}
    <div
      class="finish"
      class:cancelled={message.finish?.finishReason === "cancelled" ||
        message.finish?.finishReason === "budget_exceeded" ||
        message.finish?.finishReason === "no_provider"}
      class:truncated={message.finish?.finishReason === "length"}
    >
      {#if modelMeta}
        <span class="model-chip">
          <ModelPicker {sessionId} displayOverride={{ icon: modelMeta.icon, label: modelTitle }} />
        </span>
      {/if}
      {#if message.finish?.finishReason === "cancelled"}
        <span class="stat">Cancelled</span>
      {:else if message.finish?.finishReason === "budget_exceeded"}
        <span class="stat">Session budget exceeded — turn not run</span>
      {:else if message.finish?.finishReason === "no_provider"}
        <span class="stat"
          >No provider configured yet —
          <button class="link" onclick={() => app.openProviderSettings()}>add one</button>
          and pick it from the toolbar below.</span
        >
      {:else if message.finish}
        <span class="stat">{message.finish.usage.totalTokens ?? 0} tokens</span>
        <span class="stat">${(message.finish.usage.costUsd ?? 0).toFixed(4)}</span>
        <span class="stat">{((message.finish.durationMs ?? 0) / 1000).toFixed(1)}s</span>
        {#if contextPct !== null}<span class="stat">{contextPct}% context</span>{/if}
        {#if message.finish.finishReason === "length"}
          <span class="stat">cut off at the output limit</span>
        {/if}
      {:else}
        <span class="stat">Generating…</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .assistant {
    padding: 0.14rem 0.29rem;
  }
  .text {
    margin: 0.29rem 0;
    font-size: 0.92rem;
  }
  .text :global(.markdown) {
    line-height: 1.55;
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.07rem 0.57rem;
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
  .model-chip {
    display: inline-flex;
    align-items: center;
  }
  /* ModelPicker's default trigger is sized for the composer toolbar — shrink
     it to sit inline in this dense stats row instead, keeping its actual
     popover/click behavior untouched. */
  .model-chip :global(.picker-trigger) {
    padding: 0;
    border: none;
    max-width: none;
    font-size: inherit;
    font-weight: 600;
    color: var(--text);
  }
  .model-chip :global(.picker-trigger:hover),
  .model-chip :global(.picker-trigger.open) {
    background: none;
    color: var(--accent);
  }
  .stat {
    display: inline-flex;
  }
  .stat + .stat::before,
  .model-chip + .stat::before {
    content: "·";
    margin-right: 0.57rem;
    color: var(--text-dim);
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

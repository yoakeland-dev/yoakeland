<script lang="ts">
  import type { AssistantStep, ChatMessage, ToolCallEntry } from "../types";
  import { app } from "../state.svelte";
  import { vendorMetaFor, titleFor, type Entry } from "../modelVendor";
  import { relTime, shortNum } from "../format";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import WorkGroup from "./WorkGroup.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let { message }: { message: ChatMessage } = $props();

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
    const calls = [...message.toolCalls].sort(
      (a, b) => (a.textOffset ?? 0) - (b.textOffset ?? 0),
    );
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
          if (s.kind === "thought")
            segs.push({ key: `think-${s.at}`, kind: "thinking", text: s.text });
        }
      } else if (runSteps.some((s) => s.kind === "thought")) {
        const first = runSteps.find(
          (s): s is Extract<AssistantStep, { kind: "cluster" }> =>
            s.kind === "cluster",
        );
        segs.push({
          key: `work-${first?.calls[0]?.toolCallId ?? "0"}`,
          kind: "workgroup",
          steps: runSteps,
        });
      } else {
        const only = runSteps[0] as Extract<AssistantStep, { kind: "cluster" }>;
        segs.push({
          key: `tools-${only.calls[0]?.toolCallId ?? "0"}`,
          kind: "toolgroup",
          calls: only.calls,
        });
      }
      runSteps = [];
    }

    for (const call of calls) {
      const offset = Math.min(
        Math.max(call.textOffset ?? 0, cursor),
        message.text.length,
      );
      if (offset > cursor) {
        flushRun();
        segs.push({
          key: `text-${cursor}`,
          kind: "text",
          text: message.text.slice(cursor, offset),
        });
        cursor = offset;
      }
      const thinkOffset = Math.min(
        Math.max(call.thinkingOffset ?? 0, thinkCursor),
        thinkingLen,
      );
      if (thinkOffset > thinkCursor) {
        flushCluster();
        runSteps.push({
          kind: "thought",
          text: message.thinking!.slice(thinkCursor, thinkOffset),
          at: thinkCursor,
        });
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
      runSteps.push({
        kind: "thought",
        text: message.thinking!.slice(thinkCursor),
        at: thinkCursor,
      });
      thinkCursor = thinkingLen;
    }
    flushRun();
    if (cursor < message.text.length || segs.length === 0) {
      segs.push({
        key: `text-${cursor}`,
        kind: "text",
        text: message.text.slice(cursor),
      });
    }
    return segs;
  });

  // Provider/model on the message — stamped client-side at send time
  // (state.svelte.ts) and, once persisted, also carried by a reply rebuilt
  // from session history (§3.2's `provider`/`model` per message). Resolved
  // against the live provider/model lists for an icon + display name;
  // absent if that provider/model has since been removed, or for a message
  // stored before the backend persisted these fields, in which case the
  // footer just omits the model chip.
  const modelEntry = $derived.by((): Entry | null => {
    if (!message.provider || !message.model) return null;
    const provider = app.providers.find((p) => p.name === message.provider);
    if (!provider) return null;
    const model = app.modelsByProvider[message.provider]?.find(
      (m) => m.id === message.model,
    ) ?? {
      id: message.model,
    };
    return { provider, model };
  });
  const modelMeta = $derived(modelEntry ? vendorMetaFor(modelEntry) : null);
  const modelTitle = $derived(modelEntry ? titleFor(modelEntry) : "");

  const contextPct = $derived.by(() => {
    const ctx = message.finish?.context;
    if (!ctx || !ctx.maxTokens) return null;
    return Math.min(
      100,
      Math.round((ctx.estimatedTokens / ctx.maxTokens) * 100),
    );
  });

  // The persisted per-message usage (§3.2 `usage`) once a reload has it;
  // falls back to the live turn's own usage while streaming/just-completed,
  // before that persisted value exists yet. `inputTokens` is already the
  // full conversation resent as this round-trip's request, so it doubles as
  // "tokens in, cumulative up to this point" — `outputTokens` is just this
  // reply.
  const usage = $derived(message.usage ?? message.finish?.usage ?? null);

  const durationS = $derived.by(() => {
    const ms = message.finish?.durationMs ?? message.generationMs;
    return ms !== undefined ? (ms / 1000).toFixed(1) : null;
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

  {#if modelMeta || message.finish || usage || durationS !== null}
    <div
      class="finish"
      class:cancelled={message.finish?.finishReason === "cancelled" ||
        message.finish?.finishReason === "budget_exceeded" ||
        message.finish?.finishReason === "no_provider"}
      class:truncated={message.finish?.finishReason === "length"}
    >
      {#if modelMeta}
        <span class="model-chip" title={modelTitle}>
          <LobeIcon name={modelMeta.icon} fallback="openrouter" size={13} />
          <span class="model-label">{modelTitle}</span>
        </span>
      {/if}

      {#if message.finish?.finishReason === "cancelled"}
        {#if modelMeta}<span class="dot">·</span>{/if}
        <span class="stat">cancelled</span>
      {:else if message.finish?.finishReason === "budget_exceeded"}
        {#if modelMeta}<span class="dot">·</span>{/if}
        <span class="stat">session budget exceeded — turn not run</span>
      {:else if message.finish?.finishReason === "no_provider"}
        {#if modelMeta}<span class="dot">·</span>{/if}
        <span class="stat"
          >no provider configured yet —
          <button class="link" onclick={() => app.openProviderSettings()}
            >add one</button
          >
          and pick it from the toolbar below</span
        >
      {:else}
        {#if usage}
          {#if modelMeta}<span class="dot">·</span>{/if}
          <span
            class="stat"
            title="Tokens in — the full conversation sent with this reply"
          >
            <Icon name="arrow-narrow-down" size={12} />{shortNum(
              usage.inputTokens ?? 0,
            )}
          </span>
          <span class="stat" title="Tokens out — this reply only">
            <Icon name="arrow-narrow-up" size={12} />{shortNum(
              usage.outputTokens ?? 0,
            )}
          </span>
          <span class="dot">·</span>
          <span class="stat">${(usage.costUsd ?? 0).toFixed(4)}</span>
        {/if}

        {#if message.streaming}
          <span class="dot">·</span>
          <span class="stat">generating…</span>
        {:else}
          {#if durationS !== null}
            <span class="dot">·</span>
            <span class="stat">{durationS}s</span>
          {/if}
          {#if contextPct !== null}
            <span class="dot">·</span>
            <span class="stat">{contextPct}% context</span>
          {/if}
          {#if message.finish?.finishReason === "length"}
            <span class="dot">·</span>
            <span class="stat">cut off at the output limit</span>
          {/if}
        {/if}
      {/if}

      <span class="dot">·</span>
      <span class="stat" title={new Date(message.createdAt).toLocaleString()}
        >{relTime(message.createdAt)}</span
      >
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
    gap: 0.4rem;
    margin-top: 0.43rem;
    font-size: var(--text-heading-size);
    color: var(--text-dim);
    line-height: 1;
  }
  .finish.cancelled {
    color: var(--danger);
  }
  .finish.truncated {
    color: var(--warning);
  }

  .dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    opacity: 0.5;
    color: var(--text-dim);
    line-height: 1;
  }

  .model-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-right: 0.3rem;
    font-weight: 600;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .model-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 0.14rem;
    line-height: 1;
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

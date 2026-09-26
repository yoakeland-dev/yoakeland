<script lang="ts">
  import type { AssistantStep, ChatMessage, ToolCallEntry } from "../types";
  import { app } from "../state.svelte";
  import { retryMessage } from "../ipc";
  import { vendorMetaFor, titleFor, type Entry } from "../modelVendor";
  import { relTime, shortNum } from "../format";
  import { liveActivity } from "../activity.svelte";
  import { fade } from "svelte/transition";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import WorkGroup from "./WorkGroup.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import VersionCycle from "./VersionCycle.svelte";
  import DotMatrix from "./DotMatrix.svelte";

  let { message, sessionId }: { message: ChatMessage; sessionId: string } = $props();

  function retry() {
    const cid = app.activeConnectionId;
    if (!cid) return;
    retryMessage(cid, sessionId, message.id);
  }

  type Segment =
    | { key: string; kind: "text"; text: string }
    | { key: string; kind: "thinking"; text: string }
    | { key: string; kind: "toolgroup"; calls: ToolCallEntry[] }
    | { key: string; kind: "workgroup"; steps: AssistantStep[] };

  // Rebuilds each run (span between answer text) into steps; a run with no
  // thought renders as a plain ToolCallGroup, one with a thought as a
  // WorkGroup nesting each cluster, so a model thinking before every call
  // still collapses into one row instead of one per call.
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
    // Trailing reasoning joins whatever run is still open, matching the
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

  // Resolved against the live provider/model lists (§3.2 `provider`/`model`
  // per message); null if removed since, or predates the field, so the
  // footer just omits the model chip.
  const modelEntry = $derived.by((): Entry | null => {
    if (!message.provider || !message.model) return null;
    const provider = app.active?.providers.find((p) => p.name === message.provider);
    if (!provider) return null;
    const model = app.active?.modelsByProvider[message.provider]?.find(
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

  // `inputTokens` is the full conversation resent with this request, so it
  // doubles as cumulative tokens-in; `outputTokens` is just this reply.
  const usage = $derived(message.usage ?? message.finish?.usage ?? null);

  // What the spinner in the model chip shows, and the elapsed time beside it.
  const activity = liveActivity(() => message);

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
      <ThinkingBlock text={seg.text} />
    {:else if seg.text}
      <div class="text">
        <Markdown text={seg.text} {live} mentions />
      </div>
    {/if}
  {/each}

  {#if message.streaming || modelMeta || message.finish || usage || durationS !== null}
    <div
      class="finish"
      class:cancelled={message.finish?.finishReason === "cancelled" ||
        message.finish?.finishReason === "budget_exceeded" ||
        message.finish?.finishReason === "no_provider"}
      class:truncated={message.finish?.finishReason === "length"}
    >
      {#if modelMeta || message.streaming}
        <!-- While streaming the model's icon gives way to the spinner; hovering brings it back. -->
        <span class="model-chip" class:live={message.streaming} title={modelTitle || undefined}>
          <span class="icon-slot">
            {#if modelMeta}
              <span class="model-icon"><LobeIcon name={modelMeta.icon} fallback="openrouter" size={13} /></span>
            {/if}
            {#if message.streaming}
              <span class="spinner" transition:fade={{ duration: 200 }}><DotMatrix mode={activity.mode} size={13} /></span>
            {/if}
          </span>
          {#if modelMeta}<span class="model-label">{modelTitle}</span>{/if}
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
          {#if modelMeta || usage}<span class="dot">·</span>{/if}
          <span class="stat elapsed">{activity.elapsed}</span>
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

      {#if !message.streaming}
        <span class="dot">·</span>
        <span class="stat" title={new Date(message.createdAt).toLocaleString()}
          >{relTime(message.createdAt)}</span
        >
        <span class="dot">·</span>
        <VersionCycle {message} {sessionId} />
        <button
          class="action"
          onclick={retry}
          title={message.toolCalls.length
            ? "Retry — regenerates from here; doesn't undo the file changes this reply's tool calls made"
            : "Retry — regenerates a fresh reply from here"}
        >
          <Icon name="refresh" size={12} />
          Retry
        </button>
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
  /* Same crossfade slot as ThinkingBlock's icon: the hidden one shrinks as it fades. */
  .icon-slot {
    position: relative;
    width: 13px;
    height: 13px;
    flex: none;
  }
  .icon-slot > span {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity calc(0.2s * var(--anim-speed, 1)) ease,
      transform calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .model-chip.live .model-icon,
  .model-chip.live:has(.model-icon):hover .spinner {
    opacity: 0;
    transform: scale(0.6);
  }
  .model-chip.live:hover .model-icon {
    opacity: 1;
    transform: none;
  }
  .elapsed {
    font-variant-numeric: tabular-nums;
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
  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
    background: none;
    border: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
    padding: 0;
  }
  .action:hover {
    color: var(--text);
  }
</style>

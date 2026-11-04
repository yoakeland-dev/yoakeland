<script lang="ts">
  // Simple view: everything a reply did before its final text, folded into one dropdown. The rows
  // inside (tool groups, thoughts, narration) are the same blocks the verbose view shows inline.
  import { tick, type Snippet } from "svelte";
  import { fly, fade } from "svelte/transition";
  import type { ToolCallEntry } from "../types";
  import { metaFor, summaryFor, briefFor } from "../toolMeta";
  import { callActivity } from "../activity.svelte";
  import { heldLabel } from "../heldLabel.svelte";
  import { workView, toggleFull } from "../workView.svelte";
  import { tip } from "../tooltip.svelte";
  import Icon from "./Icon.svelte";

  let {
    id,
    calls,
    live,
    hasFinal,
    narration,
    durationMs,
    children,
  }: {
    id: string;
    calls: ToolCallEntry[];
    live: boolean;
    /** The reply ends in text outside the dropdown; without it the dropdown is all there is. */
    hasFinal: boolean;
    /** The narration text inside, so chat find can tell whether a match is in here. */
    narration: string;
    durationMs?: number;
    children: Snippet;
  } = $props();

  // Open while the reply is still working, so progress is visible as it happens; once there's an
  // answer to read it folds away. It stays open when the work is all there is to see.
  const open = $derived(workView.open[id] ?? (live || !hasFinal));
  // The body mounts on first open and then stays, so closing still animates.
  let opened = $state(false);
  $effect(() => {
    if (open) opened = true;
  });

  let root: HTMLDivElement;
  let head: HTMLButtonElement;
  let body: HTMLDivElement | undefined = $state();

  // While live, the body follows its newest row; scrolling up to read stops it until you return to the end.
  let follow = true;
  $effect(() => {
    if (!body || !live) return;
    const el = body;
    const onScroll = () => (follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24);
    const mo = new MutationObserver(() => {
      if (follow) el.scrollTop = el.scrollHeight;
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  });

  /** Keeps the header where the pointer is while the body grows or shrinks under it, and stops
   * the list's stick-to-bottom from carrying it away. */
  function pin() {
    const list = head.closest<HTMLElement>(".list");
    if (!list) return;
    const top = head.getBoundingClientRect().top;
    const end = performance.now() + 320;
    const step = () => {
      const d = head.getBoundingClientRect().top - top;
      if (Math.abs(d) > 0.5) list.scrollTop += d;
      if (performance.now() < end) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function toggle() {
    pin();
    workView.open[id] = !open;
  }
  $effect(() => {
    root.addEventListener("togglework", toggle);
    return () => root.removeEventListener("togglework", toggle);
  });

  // Chat find landed on this reply and the term is in the narration: show it.
  $effect(() => {
    const { id: rid, q } = workView.reveal;
    if (rid === id && q && narration.toLowerCase().includes(q) && !open) {
      workView.open[id] = true;
      void tick();
    }
  });

  const IN_FLIGHT = new Set(["requested", "awaiting_permission", "awaiting_answer", "running"]);
  const isRunning = $derived(live || calls.some((c) => IN_FLIGHT.has(c.status)));
  const failed = $derived(calls.filter((c) => c.status === "error" || c.status === "denied").length);
  const latest = $derived(calls[calls.length - 1]);

  const liveLabel = $derived.by(() => {
    const running = calls.findLast((c) => IN_FLIGHT.has(c.status));
    if (running) {
      const inner = running.subagent ? callActivity(running) : "";
      if (inner) return inner;
      const summary = summaryFor(running);
      return summary ? `${metaFor(running).label}: ${summary}` : metaFor(running).label;
    }
    return "Thinking…";
  });
  const brief = $derived(calls.length ? briefFor(calls) : "Thought");
  const secs = $derived(durationMs ? `${Math.max(1, Math.round(durationMs / 1000))}s` : "");

  // Previous step slides up as the next arrives; the finished summary replaces it at the end.
  const held = heldLabel(() => ({
    key: isRunning ? `${latest?.toolCallId ?? "none"}|${liveLabel}` : "done",
    label: isRunning ? liveLabel : brief,
    hasError: false,
  }));
</script>

<div class="work" data-work bind:this={root}>
  <div class="bar">
    <button class="head" bind:this={head} onclick={toggle} aria-expanded={open}>
      <span class="icon-slot">
        {#if held.flashing}
          <span class="status-icon rest" transition:fade={{ duration: 160 }}><Icon name="circle-check" size={14} /></span>
        {:else if isRunning}
          {#if !calls.some((c) => c.status === "awaiting_permission" || c.status === "awaiting_answer")}
          <span class="status-icon spin" transition:fade={{ duration: 160 }}><Icon name="loader-2" size={14} /></span>
          {:else}
            <span class="status-icon rest" transition:fade={{ duration: 160 }}><Icon name="tool" size={14} /></span>
          {/if}
        {:else}
          <span class="status-icon rest" transition:fade={{ duration: 160 }}><Icon name="tool" size={14} /></span>
        {/if}
        <span class="chevron-icon" class:open><Icon name="chevron-right" size={14} /></span>
      </span>
      <span class="label-slot">
        {#key held.key}
          <span class="label" in:fly={{ y: 6, duration: 140 }} out:fly={{ y: -6, duration: 140 }}>{held.label}</span>
        {/key}
      </span>
      {#if failed && !isRunning}<span class="note fail">{failed} failed</span>{/if}
      {#if secs && !isRunning}<span class="note">{secs}</span>{/if}
    </button>
    <button class="all" onclick={() => toggleFull(id)} {@attach tip("Show every block inline for this reply")}>Show all</button>
  </div>
  <div class="accordion" class:open>
    <div class="accordion-inner">
      <div class="body" bind:this={body}>
        {#if opened}{@render children()}{/if}
      </div>
    </div>
  </div>
</div>

<style>
  .work {
    margin: 0.43rem 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.29rem 0;
    cursor: pointer;
    font-size: var(--text-label-size);
    font-family: inherit;
    text-align: left;
  }
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
  }
  /* A failure is a fact about the work, not a state of the whole row, so only this bit is tinted. */
  .note {
    flex: none;
    opacity: 0.7;
  }
  .note.fail {
    color: var(--danger);
    opacity: 1;
  }
  .all {
    flex: none;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    cursor: pointer;
    padding: 0.2rem 0.3rem;
    opacity: 0;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .bar:hover .all,
  .all:focus-visible {
    opacity: 1;
  }
  .all:hover {
    color: var(--text);
  }
  @media (max-width: 700px) {
    .all {
      opacity: 0.7;
    }
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
  /* The one scroller: a long reply's work stays a bounded box, and nothing inside scrolls on its own.
     No indent rail: this is the only level, so its rows line up with the dropdown's own row. */
  .body {
    max-height: min(60vh, 34rem);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--panel-border) transparent;
    padding: 0.14rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
  }
  .body :global(.scroll-cap) {
    max-height: none;
    overflow-y: visible;
  }
  /* Groups carry their own margin for sitting between message blocks; the gap above does that here. */
  .body :global(.group) {
    margin: 0;
  }
</style>

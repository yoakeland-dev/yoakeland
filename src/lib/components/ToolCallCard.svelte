<script lang="ts">
  import type { ToolCallEntry } from "../types";
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

  // The backend's tool set is a small fixed list (SPEC.md §5) — each gets a
  // recognizable icon and label instead of the raw wire name.
  const toolMeta: Record<string, { icon: "file-text" | "file-plus" | "pencil" | "terminal-2"; label: string }> = {
    file_read: { icon: "file-text", label: "Read" },
    file_write: { icon: "file-plus", label: "Write" },
    file_edit: { icon: "pencil", label: "Edit" },
    bash: { icon: "terminal-2", label: "Bash" },
  };
  const meta = $derived(toolMeta[call.name]);

  // A one-line preview of what the call is doing, shown collapsed so the
  // card is useful without opening it — the file path for file tools, the
  // command for bash, falling back to the raw args for anything else.
  // `call.args` comes off the wire/persisted history, so a missing or
  // malformed value here shouldn't be able to crash the card.
  const summary = $derived.by(() => {
    const args = call.args ?? {};
    if (typeof args.path === "string") return args.path;
    if (typeof args.command === "string") return args.command;
    return Object.keys(args).length ? JSON.stringify(args) : "";
  });
</script>

<div class="card status-{call.status}">
  <button class="head" onclick={() => (expanded = !expanded)}>
    <span class="icon-slot">
      <span class="tool-icon"><Icon name={meta?.icon ?? "square"} size={14} /></span>
      <span class="chevron-icon" class:open={expanded}><Icon name="chevron-right" size={14} /></span>
    </span>
    <span class="name">{meta?.label ?? call.name}</span>
    {#if summary}
      <span class="summary">{summary}</span>
    {/if}
    {#if call.status === "error" || call.status === "denied"}
      <span class="err-icon"><Icon name="alert-circle" size={13} /></span>
    {:else if call.status === "running" || call.status === "requested"}
      <span class="spin-icon"><Icon name="loader-2" size={13} /></span>
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
  .chevron-icon {
    color: var(--text-dim);
    opacity: 0;
    transform: scale(0.6) rotate(0deg);
  }
  .chevron-icon.open {
    transform: scale(0.6) rotate(90deg);
  }
  .head:hover .tool-icon,
  .head:focus-visible .tool-icon {
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
  .err-icon {
    display: inline-flex;
    flex: none;
    color: var(--danger);
  }
  .spin-icon {
    display: inline-flex;
    flex: none;
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

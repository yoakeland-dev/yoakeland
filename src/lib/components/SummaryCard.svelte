<script lang="ts" module>
  // Which replies' summaries the user closed. Kept in the browser: a convenience, not chat data.
  const KEY = "yoake.dismissedSummaries";
  function load(): Record<string, true> {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  let dismissed = $state<Record<string, true>>(load());
  /** The first follow-up of the newest reply when its box is still up: what Ctrl+Enter in an empty composer sends. */
  export function primaryAction(sessionId: string, message?: { id: string; actions?: { prompt: string }[] }): string | undefined {
    return message && !dismissed[`${sessionId}:${message.id}`] ? message.actions?.[0]?.prompt : undefined;
  }
  function dismiss(key: string) {
    dismissed[key] = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(dismissed));
    } catch {}
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import { tip } from "../tooltip.svelte";
  import { isMac } from "../keybinds.svelte";
  import type { QuickAction } from "../types";

  // The short summary of a reply (summarizeMessage) in a muted box under it, with the follow-ups
  // the summarizer suggested: the button says it briefly, the prompt it sends says it fully.
  let {
    sessionId,
    id,
    summary,
    ask,
    actions,
    pending = false,
    error = "",
    onaction,
  }: { sessionId: string; id: string; summary?: string; ask?: string; actions?: QuickAction[]; pending?: boolean; error?: string; onaction?: (prompt: string) => void } = $props();
  const failed = $derived(!!error && !summary);
  const key = $derived(`${sessionId}:${id}`); // message ids (m1, m2…) repeat from chat to chat
</script>

{#if (summary || pending || error) && !dismissed[key]}
  <aside class="summary" class:failed class:pending={pending && !summary}>
    <button class="close" aria-label="Dismiss summary" {@attach tip("Dismiss")} onclick={() => dismiss(key)}><Icon name="xmark" size={12} /></button>
    {#if summary}
      <div class="body selectable"><Markdown text={summary} /></div>
      {#if actions?.length}
        {#if ask}<p class="ask">{ask}</p>{/if}
        <div class="actions" class:asked={!!ask}>
          {#each actions as a, i (a.label)}
            <button class="action" class:primary={i === 0} {@attach tip(a.prompt, { side: "bottom" })} onclick={() => onaction?.(a.prompt)}>
              {a.label}{#if i === 0}<kbd>{isMac ? "⌘ ⏎" : "Ctrl ⏎"}</kbd>{/if}
            </button>
          {/each}
        </div>
      {/if}
    {:else if failed}
      <p class="note selectable">Couldn't summarize: {error}</p>
    {:else}
      <div class="lines" aria-label="Summarizing"><i></i><i></i></div>
    {/if}
  </aside>
{/if}

<style>
  .summary {
    position: relative;
    margin: 0.75rem 0.29rem 0;
    padding: 0.6rem 2rem 0.65rem 0.85rem;
    border: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: var(--radius-md, 0.7rem);
    background: transparent;
  }
  .close {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border: 0;
    border-radius: var(--radius-sm, 0.4rem);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }
  .summary:hover .close,
  .close:focus-visible {
    opacity: 0.55;
  }
  .close:hover {
    opacity: 1;
    background: var(--sidebar-hover);
  }
  .body {
    font-size: 0.86rem;
    line-height: 1.55;
    color: color-mix(in srgb, var(--text) 82%, transparent);
  }
  .body :global(.md-block > :first-child) {
    margin-top: 0;
  }
  .body :global(.md-block > :last-child) {
    margin-bottom: 0;
  }
  .ask {
    margin: 0.85rem 0 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--text);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.75rem;
  }
  .actions.asked {
    margin-top: 0.6rem;
  }
  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: var(--ctrl-h, 2rem);
    padding: 0 0.95rem;
    border: none;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, filter 0.15s, transform 0.1s;
  }
  .action:hover,
  .action:focus-visible {
    background: color-mix(in srgb, var(--text) 16%, transparent);
    outline: none;
  }
  .action.primary {
    background: var(--text);
    color: var(--bg);
  }
  .action.primary:hover,
  .action.primary:focus-visible {
    background: var(--text);
    filter: brightness(0.92);
  }
  .action:active {
    transform: scale(0.97);
  }
  kbd {
    padding: 0.05rem 0.32rem;
    border-radius: var(--radius-xs, 0.25rem);
    background: color-mix(in srgb, var(--bg) 14%, transparent);
    font-family: inherit;
    font-size: 0.79rem;
    font-weight: 500;
    opacity: 0.7;
  }
  .note {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .failed {
    border-color: color-mix(in srgb, var(--danger) 25%, transparent);
  }
  .lines {
    display: grid;
    gap: 0.32rem;
    max-width: 22rem;
  }
  .lines i {
    height: 0.6rem;
    border-radius: var(--radius-pill);
    background: linear-gradient(90deg, var(--sidebar-hover), var(--sidebar-active), var(--sidebar-hover));
    background-size: 200% 100%;
    animation: shimmer calc(1.4s * var(--anim-speed, 1)) linear infinite;
  }
  .lines i:last-child {
    width: 62%;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>

<script lang="ts">
  import { slide } from "svelte/transition";
  import type { ChatMessage } from "../types";
  import { app } from "../state.svelte";
  import { askThread, threadRun } from "../sideChat";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  // The side thread on a reply: asked and answered without touching the chat's own context.
  let { message, sessionId }: { message: ChatMessage; sessionId: string } = $props();

  const server = $derived(app.active);
  const run = $derived(threadRun(server, message.id));
  const busy = $derived(!!run && !run.done);
  let draft = $state("");

  function send() {
    const q = draft.trim();
    const cid = app.activeConnectionId;
    if (!q || busy || !cid) return;
    draft = "";
    askThread(cid, sessionId, message.id, q);
  }
</script>

<div class="thread" transition:slide={{ duration: 160 }}>
  {#each message.thread ?? [] as t, i (i)}
    <div class="turn {t.role} selectable">
      {#if t.role === "user"}{t.content}{:else}<Markdown text={t.content} />{/if}
    </div>
  {/each}
  {#if run}
    <div class="turn user selectable">{run.question}</div>
    {#if run.error}
      <div class="turn err">{run.error}</div>
    {:else}
      <div class="turn assistant selectable">
        {#if run.text}<Markdown text={run.text} live={!run.done} />{:else}<span class="dim">Thinking…</span>{/if}
      </div>
    {/if}
  {/if}
  <form class="reply" onsubmit={(e) => (e.preventDefault(), send())}>
    <input bind:value={draft} placeholder="Reply in thread" aria-label="Reply in thread" disabled={busy} />
    <button type="submit" aria-label="Send" disabled={busy || !draft.trim()}><Icon name="send" size={13} /></button>
  </form>
  <div class="note">Threads aren't part of the chat's context.</div>
</div>

<style>
  .thread {
    margin: 0.5rem 0.29rem 0;
    padding: 0.2rem 0 0.2rem 0.75rem;
    border-left: 2px solid var(--panel-border);
    font-size: 0.88rem;
  }
  .turn {
    margin: 0.3rem 0;
  }
  .user {
    color: var(--text-dim);
  }
  .err,
  .dim,
  .note {
    color: var(--text-dim);
  }
  .note {
    margin-top: 0.3rem;
    font-size: 0.72rem;
  }
  .reply {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
  }
  button {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
  }
  button:disabled {
    color: var(--text-dim);
    cursor: default;
  }
</style>

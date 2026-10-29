<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { slide } from "svelte/transition";
  import { app } from "../state.svelte";
  import { closeBtw } from "../sideChat";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  // The answer to a /btw: over the composer, dismissed with the x, and kept nowhere.
  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const run = $derived(server ? server.sideRuns[server.btwBySession[sessionId] ?? ""] : undefined);
</script>

{#if run && server}
  <div class="btw selectable" transition:slide={{ duration: 160 }}>
    <div class="head">
      <Icon name="message-circle" size={12} />
      <span class="q">{run.question}</span>
      <button type="button" class="close" aria-label="Dismiss" {@attach tip("Dismiss")} onclick={() => closeBtw(server, sessionId)}>
        <Icon name="xmark" size={12} />
      </button>
    </div>
    {#if run.error}
      <div class="err">{run.error}</div>
    {:else if run.text}
      <div class="body"><Markdown text={run.text} live={!run.done} /></div>
    {:else}
      <div class="wait">Thinking…</div>
    {/if}
    <div class="foot">Not added to the chat</div>
  </div>
{/if}

<style>
  .btw {
    margin: 0 0 var(--space-2);
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    background: var(--panel-bg);
    font-size: 0.88rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-dim);
  }
  .q {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    display: grid;
    place-items: center;
    padding: 0.15rem;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
  }
  .body {
    max-height: 18rem;
    margin-top: 0.4rem;
    overflow-y: auto;
  }
  .wait,
  .err {
    margin-top: 0.4rem;
    color: var(--text-dim);
  }
  .err {
    color: var(--error, #e5484d);
  }
  .foot {
    margin-top: 0.4rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
</style>

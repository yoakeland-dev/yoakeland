<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import type { ChatMessage } from "../types";
  import { shortNum } from "../format";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  // Where the context was compacted (§4g). A summary compaction opens to show what the model
  // now sees in place of everything above this line; a "clear" has nothing more to show.
  let { message }: { message: ChatMessage } = $props();

  const c = $derived(message.compaction);
  const summary = $derived(message.text.trim());
  let open = $state(false);
</script>

{#if c}
  <div class="compacted" class:open>
    {#if summary}
      <button class="label" onclick={() => (open = !open)} aria-expanded={open} {@attach tip("Show what the model sees in place of everything above")}>
        <Icon name="arrows-minimize" size={12} />
        {c.manual ? "Context compacted" : "Context auto-compacted"} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
        <span class="chevron" class:open><Icon name="chevron-right" size={12} /></span>
      </button>
    {:else}
      <span class="label" {@attach tip(c.kind === "clear" ? "Older tool results were cleared from what the model sees; it can run those tools again" : "The agent didn't report a summary")}>
        <Icon name="arrows-minimize" size={12} />
        {c.kind === "clear" ? "Tool results cleared" : c.manual ? "Context compacted" : "Context auto-compacted"} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
      </span>
    {/if}
  </div>
  {#if summary}
    <div class="accordion" class:open>
      <div class="accordion-inner">
        {#if open}
          <div class="summary selectable"><Markdown text={summary} /></div>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  /* A quiet dashed rule across the chat, not a bubble: it's about the context, not a message. */
  .compacted {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .compacted::before,
  .compacted::after {
    content: "";
    flex: 1;
    border-top: 1px dashed var(--panel-border);
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    background: none;
    border: none;
    padding: 0.14rem 0.43rem;
    border-radius: 6px;
    color: inherit;
    font: inherit;
  }
  button.label {
    cursor: pointer;
  }
  button.label:hover,
  button.label:focus-visible,
  .open button.label {
    color: var(--text);
  }
  .chevron {
    display: inline-flex;
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  /* Same zero-JS accordion as ThinkingBlock. */
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
  .summary {
    margin: 0.57rem 0 0;
    padding: 0.57rem 0.86rem;
    max-height: 22rem;
    overflow-y: auto;
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
    font-size: 0.85rem;
  }
</style>

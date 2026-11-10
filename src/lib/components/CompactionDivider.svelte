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
  const chapters = $derived(c?.chapters ?? []);
  const expandable = $derived(!!summary || chapters.length > 0);
  const title = $derived(
    chapters.length
      ? `${c?.manual ? "Folded" : "Auto-folded"} into ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`
      : c?.manual ? "Context compacted" : "Context auto-compacted",
  );
  let open = $state(false);
  let root: HTMLElement | undefined = $state();

  // A chapter's first message, when the chat has it loaded; the title is only a link then.
  const rowFor = (id: string) => root?.closest(".list")?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
</script>

{#if c}
  <div class="compacted" class:open bind:this={root}>
    {#if expandable}
      <button class="label" onclick={() => (open = !open)} aria-expanded={open} {@attach tip(chapters.length ? "Show the chapters the model sees in place of everything above" : "Show what the model sees in place of everything above")}>
        <Icon name="arrows-minimize" size={12} />
        {title} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
        <span class="chevron" class:open><Icon name="chevron-right" size={12} /></span>
      </button>
    {:else}
      <span class="label" {@attach tip(c.kind === "clear" ? "Older tool results cleared from the model's view. It can run those tools again." : "The agent didn't report a summary")}>
        <Icon name="arrows-minimize" size={12} />
        {c.kind === "clear" ? "Tool results cleared" : c.manual ? "Context compacted" : "Context auto-compacted"} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
      </span>
    {/if}
  </div>
  {#if expandable}
    <div class="accordion" class:open>
      <div class="accordion-inner">
        {#if open && chapters.length}
          <ol class="chapters selectable">
            {#each chapters as ch (ch.n)}
              {@const row = rowFor(ch.from)}
              <li>
                <div class="chapter-head">
                  <span class="num">{ch.n}</span>
                  {#if row}
                    <button class="chapter-title" onclick={() => row.scrollIntoView({ block: "start", behavior: "smooth" })}>{ch.title}</button>
                  {:else}
                    <span class="chapter-title">{ch.title}</span>
                  {/if}
                  <span class="size">{shortNum(ch.tokens)} tokens</span>
                </div>
                {#if ch.n > (c?.titlesOnly ?? 0)}
                  <div class="brief"><Markdown text={ch.brief} /></div>
                {:else}
                  <div class="brief folded">Brief folded. The model can still reopen it with recall.</div>
                {/if}
              </li>
            {/each}
          </ol>
        {:else if open}
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
  .chapters {
    list-style: none;
    margin: 0.57rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
  }
  .chapters li {
    padding: 0.14rem 0.86rem;
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .chapter-head {
    display: flex;
    align-items: baseline;
    gap: 0.43rem;
    min-width: 0;
  }
  .num,
  .size {
    font-size: var(--text-label-size);
    flex: none;
  }
  .chapter-title {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text);
  }
  button.chapter-title {
    cursor: pointer;
  }
  button.chapter-title:hover,
  button.chapter-title:focus-visible {
    color: var(--accent);
  }
  .brief {
    margin-top: 0.14rem;
  }
  .brief.folded {
    font-size: var(--text-label-size);
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

<script lang="ts">
  import { Popover } from "bits-ui";
  import { tip } from "../tooltip.svelte";
  import type { ChatMessage } from "../types";
  import { shortNum } from "../format";
  import Icon from "./Icon.svelte";
  import PopoverContent from "./PopoverContent.svelte";
  import Markdown from "./Markdown.svelte";

  // Where the context was compacted (§4g). A click opens a popover with what the model
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
  // One panel for hover and click: hover opens it after a beat and it closes when the pointer
  // leaves; a click pins it open until clicked again or dismissed.
  let open = $state(false);
  let pinned = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Trigger clicks and outside clicks land here. A click on a hover-opened panel pins it.
  const setOpen = (v: boolean) => {
    clearTimeout(timer);
    if (!v && open && !pinned) return void (pinned = true);
    pinned = open = v;
  };
  const hover = (on: boolean, e: PointerEvent) => {
    if (e.pointerType === "touch" || pinned) return;
    clearTimeout(timer);
    timer = setTimeout(() => (open = on), on ? 250 : 150);
  };
  let root: HTMLElement | undefined = $state();

  // A chapter's first message (a user message, or one round of a merged assistant bubble), looked
  // up when the title is clicked: the chat may load more of itself while the list stays open.
  const rowFor = (id: string) => root?.closest(".list")?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"], [data-msg-ids~="${CSS.escape(id)}"]`);
</script>

{#if c}
  <div class="compacted" bind:this={root}>
    {#if expandable}
      <Popover.Root bind:open={() => open, setOpen}>
        <Popover.Trigger
          class="label"
          onpointerenter={(e) => hover(true, e)}
          onpointerleave={(e) => hover(false, e)}
        >
          <Icon name="arrows-minimize" size={12} />
          {title} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
        </Popover.Trigger>
        <Popover.Portal>
          <PopoverContent class="compaction-panel selectable" side="bottom" align="center" sideOffset={6} collisionPadding={8}
            onpointerenter={(e: PointerEvent) => hover(true, e)} onpointerleave={(e: PointerEvent) => hover(false, e)}
            onOpenAutoFocus={(e: Event) => { if (!pinned) e.preventDefault(); }}>
            {#if chapters.length}
              <ol class="chapters">
                {#each chapters as ch (ch.n)}
                  {@const folded = ch.n <= (c?.titlesOnly ?? 0)}
                  <li>
                    <span class="node" class:folded>{ch.n}</span>
                    <div class="body">
                      <div class="chapter-head">
                        <button class="chapter-title" onclick={() => { open = false; rowFor(ch.from)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}>{ch.title}</button>
                        <span class="size">{shortNum(ch.tokens)} tokens</span>
                      </div>
                      {#if folded}
                        <div class="brief folded">Title only. The model can reopen it with recall.</div>
                      {:else}
                        <div class="brief"><Markdown text={ch.brief} /></div>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ol>
            {:else}
              <div class="summary"><Markdown text={summary} /></div>
            {/if}
          </PopoverContent>
        </Popover.Portal>
      </Popover.Root>
    {:else}
      <span class="label" {@attach tip(c.kind === "clear" ? "Older tool results cleared from the model's view. It can run those tools again." : "The agent didn't report a summary")}>
        <Icon name="arrows-minimize" size={12} />
        {c.kind === "clear" ? "Tool results cleared" : c.manual ? "Context compacted" : "Context auto-compacted"} · {shortNum(c.tokensBefore)} → {shortNum(c.tokensAfter)} tokens
      </span>
    {/if}
  </div>
{/if}

<style>
  /* A quiet dashed rule across the chat, not a bubble: it's about the context, not a message.
     The history above and below stays as it was; the popover shows what the model sees instead. */
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
  .compacted :global(.label) {
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
  .compacted :global(button.label) {
    cursor: pointer;
  }
  .compacted :global(button.label:hover),
  .compacted :global(button.label:focus-visible),
  .compacted :global(button.label[data-state="open"]) {
    color: var(--text);
  }
  :global(.compaction-panel) {
    width: 26rem;
    max-width: calc(100vw - 2rem);
    max-height: min(26rem, 60vh);
    overflow-y: auto;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-dialog);
    padding: 0.64rem 0.86rem;
    z-index: var(--z-popover);
    color: var(--text-dim);
    font-size: 0.85rem;
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.compaction-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  /* A roadmap: outlined stops on a rail. A dashed stop is one the model sees as a title only. */
  .chapters {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .chapters li {
    position: relative;
    display: grid;
    grid-template-columns: 1.5rem 1fr;
    column-gap: 0.7rem;
    padding-bottom: 0.9rem;
  }
  .chapters li:last-child {
    padding-bottom: 0.1rem;
  }
  .chapters li:not(:last-child)::before {
    content: "";
    position: absolute;
    left: calc(0.75rem - 1px);
    top: 1.95rem;
    bottom: 0.45rem;
    border-left: 2px solid var(--panel-border);
  }
  .node {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    box-sizing: border-box;
    border: 1.5px solid var(--text-dim);
    border-radius: var(--radius-pill);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
  }
  .node.folded {
    border-style: dashed;
    opacity: 0.7;
  }
  .body {
    min-width: 0;
  }
  .chapter-head {
    display: flex;
    align-items: baseline;
    gap: 0.57rem;
    min-height: 1.5rem;
    align-items: center;
  }
  .size {
    flex: none;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
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
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }
  .chapter-title:hover,
  .chapter-title:focus-visible {
    color: var(--accent);
  }
  .brief {
    margin-top: 0.1rem;
    line-height: 1.5;
  }
  .brief.folded {
    font-size: var(--text-label-size);
    font-style: italic;
    opacity: 0.8;
  }
</style>

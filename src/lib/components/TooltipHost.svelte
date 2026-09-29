<script lang="ts">
  // The one tooltip every `{@attach tip(...)}` shares (tooltip.svelte.ts). bits-ui positions it
  // against the hovered element (customAnchor) and flips it to whichever side has room; hover
  // timing lives in tooltip.svelte.ts since there's no bits-ui Trigger per element.
  import { Tooltip } from "bits-ui";
  import { tooltip, hideTip, type Tip } from "../tooltip.svelte";
  import Kbd from "./Kbd.svelte";

  // Vertical extent from the element, horizontal from the `outside` ancestor.
  function anchorFor(t: Tip) {
    if (!t.outside) return t.el;
    return {
      getBoundingClientRect: () => {
        const r = t.el.getBoundingClientRect();
        const b = t.el.closest(t.outside!)?.getBoundingClientRect();
        return b ? new DOMRect(b.left, r.top, b.width, r.height) : r;
      },
    };
  }

  // The *Behavior props below keep this out of bits-ui's layer stack: otherwise a tooltip over an
  // open popover becomes the top layer and swallows the outside click that should close it.

  // Kept after close so the content doesn't blank out during the exit animation.
  let shown = $state<Tip | null>(null);
  $effect(() => {
    if (tooltip.current) shown = tooltip.current;
  });
</script>

<svelte:window onblur={() => hideTip()} onwheel={() => hideTip()} />

<Tooltip.Provider delayDuration={0} disableHoverableContent>
  <Tooltip.Root open={!!tooltip.current} onOpenChange={(o) => !o && hideTip()}>
    <Tooltip.Portal>
      {#if shown}
        <Tooltip.Content
          customAnchor={anchorFor(shown)}
          side={shown.side ?? "top"}
          sideOffset={6}
          collisionPadding={8}
          interactOutsideBehavior="defer-otherwise-ignore"
          escapeKeydownBehavior="defer-otherwise-ignore"
          class="tooltip{typeof shown.content === 'string' ? '' : ' rich'}"
        >
          {#if typeof shown.content === "string"}
            <span class="tooltip-text">{shown.content}</span>
          {:else}
            {@render shown.content()}
          {/if}
          {#if shown.keys}<Kbd id={shown.keys} />{/if}
        </Tooltip.Content>
      {/if}
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.tooltip) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 22rem;
    padding: 0.29rem 0.5rem;
    font-size: var(--text-label-size);
    line-height: 1.4;
    color: var(--text);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    z-index: var(--z-tooltip);
    pointer-events: none;
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.tooltip[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  :global(.tooltip.rich) {
    flex-direction: column;
    align-items: stretch;
    /* Spacing between a card's parts is the parts' own (.tip-list etc. in app.css). */
    gap: 0;
    min-width: 12rem;
    padding: 0.5rem 0.64rem;
  }
  .tooltip-text {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
</style>

<script lang="ts">
  import Icon from "./Icon.svelte";

  // Collapsed by default; the reply's model chip shows it's still going.
  let { text }: { text: string } = $props();

  let open = $state(false);
</script>

<button class="thinking-toggle" onclick={() => (open = !open)}>
  <span class="icon-slot">
    <span class="brain-icon"><Icon name="brain" size={14} /></span>
    <span class="chevron-icon" class:open><Icon name="chevron-right" size={14} /></span>
  </span>
  Thinking
</button>
<div class="accordion" class:open>
  <div class="accordion-inner">
    <pre class="thinking selectable">{text.trimEnd()}</pre>
  </div>
</div>

<style>
  .thinking-toggle {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    cursor: pointer;
    padding: 0.29rem 0;
  }
  /* Same cross-fade slot as ToolCallCard/ToolCallGroup: chevron only takes over on hover. */
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
  .chevron-icon {
    opacity: 0;
    transform: scale(0.6) rotate(0deg);
  }
  .chevron-icon.open {
    transform: scale(0.6) rotate(90deg);
  }
  .thinking-toggle:hover .brain-icon,
  .thinking-toggle:focus-visible .brain-icon {
    opacity: 0;
    transform: scale(0.6);
  }
  .thinking-toggle:hover .chevron-icon,
  .thinking-toggle:focus-visible .chevron-icon {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  .thinking-toggle:hover .chevron-icon.open,
  .thinking-toggle:focus-visible .chevron-icon.open {
    transform: scale(1) rotate(90deg);
  }
  /* Zero-JS accordion: grid-template-rows 0fr/1fr measures real content height instead of a
     guessed max-height. Inner div needs its own overflow:hidden or a 0fr track still lets content paint past it. */
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
  .thinking {
    margin: 0 0 0.57rem;
    padding: 0.57rem 0.71rem;
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
</style>

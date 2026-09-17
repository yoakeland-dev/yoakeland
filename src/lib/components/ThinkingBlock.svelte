<script lang="ts">
  import Icon from "./Icon.svelte";

  // `live` marks this as the trailing, still-streaming reasoning chunk of a
  // message with no tool calls at all (a standalone thought). Collapsed by
  // default either way — thinking stays opt-in to view, live or not — but if
  // the user has already opened it, a still-growing thought gets the same
  // blinking-cursor treatment the visible answer text uses while streaming,
  // instead of just silently updating.
  let { text, live = false }: { text: string; live?: boolean } = $props();

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
    <pre class="thinking selectable">{text}{#if live}<span class="cursor"></span>{/if}</pre>
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
  /* Same cross-fade slot as ToolCallCard/ToolCallGroup: the brain icon sits
     at rest, the chevron only takes over on hover to signal "expandable". */
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
  /* Zero-JS accordion: grid-template-rows animates between 0fr and 1fr, so the
     row's content (of whatever height) is what gets measured, not a guessed
     max-height. The inner div needs its own overflow:hidden — a 0fr grid
     track still lets its content paint past the row without one. */
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
  .cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1em;
    margin-left: 0.07rem;
    background: var(--text-dim);
    vertical-align: text-bottom;
    animation: blink calc(1s * var(--anim-speed, 1)) step-start infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
</style>

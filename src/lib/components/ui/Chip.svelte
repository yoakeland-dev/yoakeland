<script lang="ts">
  // Two kinds. With `onremove`, a removable tag with a close button. With `pressed`, a filter that
  // toggles: on, it takes an accent tint. With neither, a plain label.
  import type { Snippet } from "svelte";
  import Icon from "../Icon.svelte";

  let {
    pressed = $bindable(),
    onremove,
    removeLabel = "Remove",
    children,
  }: {
    pressed?: boolean;
    onremove?: () => void;
    removeLabel?: string;
    children?: Snippet;
  } = $props();
</script>

{#if pressed !== undefined}
  <button type="button" class="chip toggle" aria-pressed={pressed} onclick={() => (pressed = !pressed)}>{@render children?.()}</button>
{:else}
  <span class="chip" class:removable={!!onremove}>
    {@render children?.()}
    {#if onremove}
      <button type="button" class="ui-mini" aria-label={removeLabel} onclick={onremove}><Icon name="xmark" size={11} /></button>
    {/if}
  </span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    height: 1.71rem;
    padding: 0 0.78rem;
    border-radius: var(--radius-pill);
    background: var(--field-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
  }
  .removable {
    padding-right: 0.21rem;
  }
  .removable :global(.ui-mini) {
    width: 1.14rem;
    height: 1.14rem;
    border-radius: 50%;
  }
  .toggle {
    color: var(--text-dim);
    cursor: pointer;
    outline: none;
    transition:
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease,
      border-color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .toggle:hover {
    color: var(--text);
    border-color: var(--field-border-hover);
  }
  .toggle[aria-pressed="true"] {
    background: var(--accent-dim);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--text);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
</style>

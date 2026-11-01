<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Escape clears a non-empty field instead of bubbling (e.g. closing the dialog it's in).
  import Icon from "./Icon.svelte";

  // `boxed` keeps the field's well and border at rest, for where it stands alone instead of in a list header.
  let { value = $bindable(""), placeholder = "Search…", boxed = false, hint = "" }: { value?: string; placeholder?: string; boxed?: boolean; hint?: string } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && value) {
      e.preventDefault();
      e.stopPropagation();
      value = "";
    }
  }
</script>

<div class="search" class:boxed>
  <Icon name="search" size={13} />
  <input type="text" {placeholder} bind:value {onkeydown} />
  {#if hint && !value}<kbd class="search-hint">{hint}</kbd>{/if}
  {#if value}
    <button class="search-clear" onclick={() => (value = "")} {@attach tip("Clear search")} aria-label="Clear search">
      <Icon name="xmark" size={12} />
    </button>
  {/if}
</div>

<style>
  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0 var(--space-1);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    height: var(--ctrl-h, 2rem);
  }
  .search.boxed {
    background: var(--field-bg, var(--wash-1));
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .search:focus-within {
    background: var(--wash-1);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-label-size);
  }
  .search-hint {
    flex-shrink: 0;
    padding: 0 0.36rem;
    font: inherit;
    font-size: var(--text-label-size);
    line-height: 1.3rem;
    color: var(--sidebar-fg-dim);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-xs);
  }
  .search:focus-within .search-hint {
    display: none;
  }
  .search-clear {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 1.29rem;
    background: none;
    border: none;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .search-clear:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
</style>

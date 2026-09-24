<script lang="ts">
  // Escape clears a non-empty field instead of bubbling (e.g. closing the dialog it's in).
  import Icon from "./Icon.svelte";

  let { value = $bindable(""), placeholder = "Search…" }: { value?: string; placeholder?: string } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && value) {
      e.preventDefault();
      e.stopPropagation();
      value = "";
    }
  }
</script>

<div class="search">
  <Icon name="search" size={13} />
  <input type="text" {placeholder} bind:value {onkeydown} />
  {#if value}
    <button class="search-clear" onclick={() => (value = "")} title="Clear search" aria-label="Clear search">
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
    height: var(--ctrl-h);
  }
  .search:focus-within {
    background: rgba(255, 255, 255, 0.04);
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
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .search-clear:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
</style>

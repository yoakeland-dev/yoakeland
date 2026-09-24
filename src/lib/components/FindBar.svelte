<script lang="ts">
  // Owns only the widget (query input, prev/next/close, counter); every
  // caller supplies its own onNext/onPrevious since "next match" differs per backend.
  import Icon from "./Icon.svelte";

  let {
    query = $bindable(""),
    matchIndex = -1,
    matchCount = 0,
    placeholder = "Find",
    inputEl = $bindable<HTMLInputElement | null>(null),
    class: className = "",
    onInput,
    onNext,
    onPrevious,
    onClose,
  }: {
    query: string;
    /** 0-based index of the current match, -1 when there isn't one, same
     * convention as xterm addon-search's ISearchResultChangeEvent. */
    matchIndex?: number;
    matchCount?: number;
    placeholder?: string;
    inputEl?: HTMLInputElement | null;
    /** Extra class(es) on the root: a caller overrides position (top/right)
     * to fit its own container; the widget's own look stays fixed. */
    class?: string;
    /** Fires on every keystroke: wire to an incremental/as-you-type search
     * if the backend supports it (xterm's findNext does); omit otherwise. */
    onInput?: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onClose: () => void;
  } = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    }
  }
</script>

<div class="find-bar {className}">
  <Icon name="search" size={13} />
  <input type="text" {placeholder} bind:value={query} bind:this={inputEl} oninput={onInput} onkeydown={onKeydown} />
  {#if query}
    <span class="find-count">{matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "No results"}</span>
  {/if}
  <button class="find-btn" title="Previous match (Shift+Enter)" onclick={onPrevious}>
    <Icon name="chevron-up" size={13} />
  </button>
  <button class="find-btn" title="Next match (Enter)" onclick={onNext}>
    <Icon name="chevron-down" size={13} />
  </button>
  <button class="find-btn" title="Close (Esc)" onclick={onClose}>
    <Icon name="xmark" size={13} />
  </button>
</div>

<style>
  .find-bar {
    position: absolute;
    top: 0.4rem;
    right: 0.6rem;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.21rem 0.43rem;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    color: var(--text-dim);
  }
  .find-bar input {
    width: 10rem;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-label-size);
  }
  .find-count {
    flex-shrink: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .find-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.14rem;
    height: 1.14rem;
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
  }
  .find-btn:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
</style>

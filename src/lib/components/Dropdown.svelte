<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Shared "pick one of these" control on top of bits-ui's Select; owns
  // layout/chrome/search, item content is up to the caller via `item`.
  import { Select } from "bits-ui";
  import Icon from "./Icon.svelte";
  import type { Snippet } from "svelte";

  export interface DropdownItem {
    value: string;
    label: string;
    /** Items sharing a group get one header above the first of them. */
    group?: string;
    /** Selectable stand-in for its group's header (e.g. "everything on this
     * server"): drawn like the header, and the plain header is skipped. */
    header?: boolean;
  }

  let {
    items,
    value = $bindable(),
    placeholder = "Select…",
    triggerIcon,
    triggerLead,
    triggerTitle,
    searchable = false,
    searchPlaceholder = "Search…",
    emptyText = "No matches.",
    triggerClass = "",
    contentClass = "",
    item,
    groupHeader,
  }: {
    items: DropdownItem[];
    value: string | undefined;
    placeholder?: string;
    triggerIcon?: string;
    /** Custom leading element (e.g. a server monogram) in the icon's slot,
     * crossfades with the chevron exactly like triggerIcon; wins over it. */
    triggerLead?: Snippet;
    triggerTitle?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    emptyText?: string;
    triggerClass?: string;
    contentClass?: string;
    item?: Snippet<[DropdownItem & { selected: boolean }]>;
    groupHeader?: Snippet<[string]>;
  } = $props();

  let search = $state("");
  const filtered = $derived(
    searchable && search.trim()
      ? items.filter((i) =>
          i.label.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : items,
  );

  function onOpenChange(open: boolean) {
    if (!open) search = "";
  }
</script>

<Select.Root type="single" bind:value {items} {onOpenChange}>
  <Select.Trigger
    class={`dropdown-trigger ${triggerClass}`}
    {@attach tip(triggerTitle)}
  >
    {#if triggerLead || triggerIcon}
      <!-- Icon and chevron crossfade in one slot instead of sitting side by side. -->
      <span class="dropdown-trigger-icon">
        <span class="crossfade icon-face">
          {#if triggerLead}{@render triggerLead()}{:else}<Icon name={triggerIcon as any} size={12} />{/if}
        </span>
        <span class="crossfade chevron-face">
          <Icon name="chevron-down" size={12} />
        </span>
      </span>
    {:else}
      <Icon name="chevron-down" size={12} />
    {/if}
    <span class="dropdown-value-wrap">
      <Select.Value class="dropdown-value" {placeholder} />
    </span>
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      class={`dropdown-content ${contentClass}`}
      sideOffset={4}
      collisionPadding={8}
    >
      {#if searchable}
        <div class="dropdown-search">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder={searchPlaceholder}
            bind:value={search}
            onkeydown={(e) => e.stopPropagation()}
          />
          {#if search}
            <button
              type="button"
              class="dropdown-search-clear"
              onclick={() => (search = "")}
              {@attach tip("Clear search")}
              aria-label="Clear search"
            >
              <Icon name="xmark" size={11} />
            </button>
          {/if}
        </div>
      {/if}
      <Select.Viewport class="dropdown-viewport">
        {#each filtered as opt, i (opt.value)}
          {#if opt.group && !opt.header && opt.group !== filtered[i - 1]?.group}
            <div class="dropdown-group">
              {#if groupHeader}{@render groupHeader(opt.group)}{:else}{opt.group}{/if}
            </div>
          {/if}
          <Select.Item
            value={opt.value}
            label={opt.label}
            class={opt.header ? "dropdown-item dropdown-group-item" : opt.group ? "dropdown-item grouped" : "dropdown-item"}
          >
            {#snippet children({ selected })}
              {#if item}
                {@render item({ ...opt, selected })}
              {:else}
                <span class="dropdown-item-label">{opt.label}</span>
                {#if selected}<Icon name="check" size={11} />{/if}
              {/if}
            {/snippet}
          </Select.Item>
        {:else}
          <p class="dropdown-empty">{emptyText}</p>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  /* Transparent until hovered/open, matching the sidebar's other inline
     chrome so this doesn't read as a heavier, more "form-like" control. */
  :global(.dropdown-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    box-sizing: border-box;
    min-width: 4rem;
    max-width: 100%;
    height: var(--ctrl-h, 2rem);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    font-size: var(--text-label-size);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      border-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.dropdown-trigger:hover),
  :global(.dropdown-trigger:focus-visible),
  :global(.dropdown-trigger[data-state="open"]) {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    outline: none;
  }
  /* Both faces stacked and absolutely positioned so the slot keeps one fixed
     footprint and the swap crossfades rather than jumps. */
  :global(.dropdown-trigger-icon) {
    position: relative;
    width: 0.86rem;
    height: 0.86rem;
    flex-shrink: 0;
  }
  :global(.dropdown-trigger-icon .crossfade) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.dropdown-trigger-icon .chevron-face) {
    opacity: 0;
  }
  :global(.dropdown-trigger:hover .dropdown-trigger-icon .icon-face),
  :global(.dropdown-trigger:focus-visible .dropdown-trigger-icon .icon-face),
  :global(
      .dropdown-trigger[data-state="open"] .dropdown-trigger-icon .icon-face
    ) {
    opacity: 0;
  }
  :global(.dropdown-trigger:hover .dropdown-trigger-icon .chevron-face),
  :global(.dropdown-trigger:focus-visible .dropdown-trigger-icon .chevron-face),
  :global(
      .dropdown-trigger[data-state="open"] .dropdown-trigger-icon .chevron-face
    ) {
    opacity: 1;
  }
  /* Gives the value a definite width to clamp against, so an over-long
     label ellipsizes instead of stretching the trigger. */
  :global(.dropdown-value-wrap) {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  :global(.dropdown-value) {
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.dropdown-content) {
    display: flex;
    flex-direction: column;
    /* Never narrower than the trigger, never wider than the viewport has
       room for; caps size so an oversized list scrolls instead of overflowing. */
    width: max-content;
    min-width: var(--bits-floating-anchor-width, 12rem);
    max-width: var(--bits-floating-available-width, 90vw);
    max-height: var(--bits-floating-available-height, 22rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    padding: var(--space-half);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    z-index: var(--z-dropdown);
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.dropdown-content[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  :global(.dropdown-search) {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin: 0.14rem 0.14rem var(--space-half);
    padding: 0 0.43rem;
    height: 1.86rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
  }
  :global(.dropdown-search:focus-within) {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  :global(.dropdown-search input) {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-label-size);
    font-family: inherit;
  }
  :global(.dropdown-search-clear) {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.14rem;
    height: 1.14rem;
    background: none;
    border: none;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  :global(.dropdown-search-clear:hover) {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  :global(.dropdown-viewport) {
    overflow-y: auto;
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .dropdown-group {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.5rem 0.57rem 0.21rem;
    font-size: 0.66rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  :global(.dropdown-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    padding: 0.43rem 0.57rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    color: var(--sidebar-fg);
    cursor: pointer;
  }
  /* A selectable header: the header's type treatment with an item's hover. */
  :global(.dropdown-item.dropdown-group-item) {
    margin-top: 0.21rem;
    font-size: 0.66rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  :global(.dropdown-item.dropdown-group-item[data-highlighted]),
  :global(.dropdown-item.dropdown-group-item[data-selected]) {
    color: var(--sidebar-fg);
  }
  /* Indent the content (not the highlight) under its group header. */
  :global(.dropdown-item.grouped) {
    padding-left: 1.29rem;
  }
  :global(.dropdown-item[data-highlighted]) {
    background: var(--sidebar-hover);
  }
  :global(.dropdown-item-label) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.dropdown-empty) {
    margin: 0;
    padding: 0.71rem 0.57rem;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    text-align: center;
  }
</style>

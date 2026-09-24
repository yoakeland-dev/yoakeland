<script lang="ts">
  // Shared dropdown primitive on top of bits-ui's Select — one styled
  // trigger/popover treatment for every plain "pick one of these" control in
  // the app, with an optional search filter for longer lists. Custom
  // per-item rendering (icons, truncated labels with a title tooltip, a
  // trailing badge) is still up to the caller via the `item` snippet; this
  // component owns layout/chrome/search, not item content.
  import { Select } from "bits-ui";
  import Icon from "./Icon.svelte";
  import type { Snippet } from "svelte";

  export interface DropdownItem {
    value: string;
    label: string;
  }

  let {
    items,
    value = $bindable(),
    placeholder = "Select…",
    triggerIcon,
    triggerTitle,
    searchable = false,
    searchPlaceholder = "Search…",
    emptyText = "No matches.",
    triggerClass = "",
    contentClass = "",
    item,
  }: {
    items: DropdownItem[];
    value: string | undefined;
    placeholder?: string;
    triggerIcon?: string;
    triggerTitle?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    emptyText?: string;
    triggerClass?: string;
    contentClass?: string;
    item?: Snippet<[DropdownItem & { selected: boolean }]>;
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
    title={triggerTitle}
  >
    {#if triggerIcon}
      <!-- Icon and chevron crossfade in one slot rather than sitting side by
           side: the chevron reads as "this icon opens a list" instead of as a
           second glyph crowding the value. Same treatment as the model
           picker's trigger. -->
      <span class="dropdown-trigger-icon">
        <span class="crossfade icon-face">
          <Icon name={triggerIcon as any} size={12} />
        </span>
        <span class="crossfade chevron-face">
          <Icon name="chevron-down" size={12} />
        </span>
      </span>
    {:else}
      <!-- No leading icon to trade places with, so the chevron is this
           trigger's only affordance and stays put. -->
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
              title="Clear search"
              aria-label="Clear search"
            >
              <Icon name="xmark" size={11} />
            </button>
          {/if}
        </div>
      {/if}
      <Select.Viewport class="dropdown-viewport">
        {#each filtered as opt (opt.value)}
          <Select.Item
            value={opt.value}
            label={opt.label}
            class="dropdown-item"
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
  /* House style for a plain "pick one" control: transparent until hovered
     or open, rather than a permanently visible box — matches the sidebar's
     other inline chrome (its search field, the split/session rows) so a
     dropdown trigger doesn't read as a heavier, more "form-like" control
     than its neighbors. */
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
  /* The icon/chevron slot (only rendered when the caller passes triggerIcon;
     else the chevron is a plain trailing glyph). Both faces are stacked and
     absolutely positioned so the slot keeps one fixed footprint, and the swap
     is a crossfade rather than a jump. */
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
  /* The trigger hugs whatever value it's showing, so a short label doesn't
     leave a gap where a longer item's text would have gone. The wrap gives
     the value a definite width to clamp against, so an over-long label
     ellipsizes (see --fc-pill's / .mode-trigger's max-width) instead of
     stretching the trigger. The popup has its own width below. */
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
    /* Size to the longest item, never narrower than the trigger (so a short
       list still reads as "attached" to it), and never wider than the
       viewport has room for — avoidCollisions/shift on Select.Content
       already repositions the popup so it doesn't run off-screen; this caps
       its size for the same reason, so an oversized item list scrolls/
       truncates instead of overflowing past the edge. */
    width: max-content;
    min-width: var(--bits-floating-anchor-width, 12rem);
    max-width: var(--bits-floating-available-width, 90vw);
    max-height: var(--bits-floating-available-height, 22rem);
    /* A floating surface — see the --float-* tokens in app.css: the plain panel
       fill by default, translucent over a backdrop blur when Settings >
       Appearance > Surfaces is set to Frosted. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
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
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  :global(.dropdown-search-clear:hover) {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  :global(.dropdown-viewport) {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
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
  :global(.dropdown-item[data-highlighted]) {
    background: var(--sidebar-hover);
  }
  :global(.dropdown-item-label) {
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

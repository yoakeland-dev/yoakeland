<script module lang="ts">
  export interface ContextMenuItem {
    label: string;
    icon: string;
    onSelect: () => void;
    disabled?: boolean;
    danger?: boolean;
  }
</script>

<script lang="ts">
  // bits-ui's ContextMenu primitive: positioning/edge collision, portal-to-body,
  // focus trap and keyboard nav for free instead of hand-rolling them.
  import { ContextMenu } from "bits-ui";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  // `items` also accepts a thunk for callers needing a fresh read of
  // non-reactive state at open time (e.g. xterm's term.hasSelection()).
  // `restoreFocus={false}` keeps focus where a menu action put it (e.g. an inline name input)
  // instead of returning it to the right-clicked element.
  let {
    items,
    children,
    restoreFocus = true,
  }: { items: ContextMenuItem[] | (() => ContextMenuItem[]); children: Snippet; restoreFocus?: boolean } = $props();

  let open = $state(false);
  const resolvedItems = $derived(open ? (typeof items === "function" ? items() : items) : []);
</script>

<ContextMenu.Root bind:open>
  <ContextMenu.Trigger class="context-menu-trigger">
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="context-menu" onCloseAutoFocus={(e) => !restoreFocus && e.preventDefault()}>
      {#each resolvedItems as item}
        <ContextMenu.Item
          class={item.danger ? "context-menu-item danger" : "context-menu-item"}
          disabled={item.disabled}
          onSelect={() => item.onSelect()}
        >
          <Icon name={item.icon as any} size={13} />
          <span>{item.label}</span>
        </ContextMenu.Item>
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>

<style>
  :global(.context-menu-trigger) {
    display: contents;
  }
  :global(.context-menu) {
    z-index: var(--z-context-menu);
    min-width: 10.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
    /* A floating surface, see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    padding: var(--space-half);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.context-menu[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  :global(.context-menu-item) {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    text-align: left;
    padding: 0.43rem 0.57rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    color: var(--sidebar-fg);
    cursor: pointer;
    user-select: none;
  }
  :global(.context-menu-item[data-highlighted]) {
    background: var(--sidebar-hover);
  }
  :global(.context-menu-item[data-disabled]) {
    color: var(--sidebar-fg-dim);
    opacity: 0.5;
    cursor: default;
  }
  :global(.context-menu-item.danger) {
    color: var(--danger, #ff6b6b);
  }
</style>

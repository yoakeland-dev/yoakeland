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
  // Right-click menu for a single row, via bits-ui's ContextMenu primitive
  // instead of a hand-rolled implementation — gets correct positioning/edge
  // collision, portal-to-body, focus trap, and keyboard nav (roving focus,
  // typeahead, Escape/outside-click dismissal) for free. Wrap whatever should
  // be right-clickable in this component; it doesn't add its own visible
  // element (the Trigger wrapper is `display: contents`).
  import { ContextMenu } from "bits-ui";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let { items, children }: { items: ContextMenuItem[]; children: Snippet } = $props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="context-menu-trigger">
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="context-menu">
      {#each items as item}
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
    /* A floating surface — see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    padding: var(--space-half);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
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

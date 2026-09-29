<script lang="ts">
  // An action's first shortcut as quiet text ("Ctrl+Shift+K", "⌘K"); renders nothing while it's
  // unbound. `id` that isn't an action is taken as a fixed combo ("Escape", "Shift+Enter").
  import { ACTION_BY_ID, bindsFor, comboParts, isMac } from "../keybinds.svelte";

  let { id, combo }: { id?: string; combo?: string } = $props();
  const parts = $derived.by(() => {
    const c = combo ?? (id && ACTION_BY_ID.has(id) ? bindsFor(id)[0] : id);
    return c ? comboParts(c) : [];
  });
</script>

{#if parts.length}
  <kbd class="keys">{#each parts as p, i (i)}{#if i && !isMac}<span class="sep">+</span>{/if}{p}{/each}</kbd>
{/if}

<style>
  .keys {
    display: inline-flex;
    align-items: baseline;
    flex-shrink: 0;
    font-family: inherit;
    font-size: 0.72rem;
    color: var(--text-dim);
    opacity: 0.8;
    white-space: nowrap;
  }
  .sep {
    margin: 0 0.07rem;
    opacity: 0.6;
  }
</style>

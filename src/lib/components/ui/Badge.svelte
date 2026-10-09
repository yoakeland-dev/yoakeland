<script lang="ts">
  // A small status tag: a tint of its tone with text in the tone. `dot` leads with a status dot,
  // `mono` is for counts and diff numbers.
  import type { Snippet } from "svelte";

  let {
    tone = "neutral",
    dot = false,
    mono = false,
    children,
  }: {
    tone?: "neutral" | "accent" | "success" | "warning" | "danger";
    dot?: boolean;
    mono?: boolean;
    children?: Snippet;
  } = $props();
</script>

<span class="badge {tone}" class:mono>
  {#if dot}<i></i>{/if}
  {@render children?.()}
</span>

<style>
  .badge {
    --c: var(--text-dim);
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    height: 1.43rem;
    padding: 0 0.5rem;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--c) 15%, transparent);
    color: var(--c);
    font-size: 0.72rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .accent {
    --c: var(--accent);
  }
  .success {
    --c: var(--success);
  }
  .warning {
    --c: var(--warning);
  }
  .danger {
    --c: var(--danger);
  }
  .mono {
    font-family: var(--code-font-family);
    font-weight: 400;
  }
  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
</style>

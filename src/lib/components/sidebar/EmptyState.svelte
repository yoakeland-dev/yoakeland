<script lang="ts">
  // The one empty/error look every tool panel shares: an icon in a soft disc, a short title,
  // a line of help, and optionally an action or two underneath.
  import type { Snippet } from "svelte";
  import Icon from "../Icon.svelte";

  let {
    icon,
    title,
    body,
    tone = "neutral",
    children,
  }: {
    icon: string;
    title: string;
    body?: string;
    tone?: "neutral" | "danger" | "success";
    children?: Snippet;
  } = $props();
</script>

<div class="empty-state {tone}">
  <span class="disc"><Icon name={icon as any} size={20} /></span>
  <span class="title">{title}</span>
  {#if body}<span class="body">{body}</span>{/if}
  {#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.36rem;
    padding: var(--space-2) var(--space-3, 1.5rem);
    text-align: center;
    min-height: 10rem;
  }
  .disc {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.57rem;
    height: 2.57rem;
    margin-bottom: 0.29rem;
    border-radius: 50%;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .danger .disc {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .success .disc {
    color: var(--success, #58d68d);
    background: color-mix(in srgb, var(--success, #58d68d) 12%, transparent);
  }
  .title {
    font-weight: 500;
    color: var(--text);
  }
  .body {
    max-width: 18rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.43rem;
    margin-top: 0.43rem;
  }
  .actions :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.29rem 0.71rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .actions :global(button:hover) {
    background: var(--sidebar-hover);
  }
</style>

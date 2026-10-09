<script lang="ts">
  // The box is a ::before layer, so a press scales the container and the label stays still.
  // `variant`: default, primary (the one solid accent), ghost (bare until hovered), danger (a tint).
  // Extra attributes, handlers and attachments go to the button; `class` is for placement only.
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Spinner from "./Spinner.svelte";

  let {
    variant = "default",
    size = "md",
    icon = false,
    loading = false,
    destructive = false,
    type = "button",
    disabled = false,
    class: cls = "",
    children,
    ...rest
  }: Omit<HTMLButtonAttributes, "class" | "type"> & {
    variant?: "default" | "primary" | "ghost" | "danger";
    size?: "md" | "sm";
    /** Square, for a lone icon. */
    icon?: boolean;
    loading?: boolean;
    /** The label turns red on hover. For a remove or clear button that sits quietly until then. */
    destructive?: boolean;
    type?: "button" | "submit" | "reset";
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<button {...rest} {type} class="btn {variant} {size} {cls}" class:icon class:loading class:destructive disabled={disabled || loading} aria-busy={loading || undefined}>
  {#if loading}<Spinner size="s" />{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    --bg: rgba(255, 255, 255, 0.06);
    --bd: var(--panel-border);
    --bdt: var(--panel-border-top);
    --bdb: var(--panel-border-bottom);
    position: relative;
    isolation: isolate;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.43rem;
    box-sizing: border-box;
    height: var(--ctrl-h, 2rem);
    padding: 0 0.86rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    outline: none;
    transition: color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .btn::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--bg);
    border: 1px solid var(--bd);
    border-block-color: var(--bdt) var(--bdb);
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      scale calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .btn:hover:not(:disabled) {
    --bg: var(--sidebar-hover);
  }
  .btn:active:not(:disabled)::before {
    scale: 0.96;
  }
  .btn:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.loading {
    cursor: progress;
    opacity: 1;
  }
  .sm {
    --ctrl-h: 1.71rem;
    padding: 0 0.64rem;
  }
  .icon {
    width: var(--ctrl-h, 2rem);
    padding: 0;
  }
  .primary {
    --bg: var(--accent);
    --bd: var(--accent);
    --bdt: var(--accent);
    --bdb: var(--accent);
    color: #0d1020;
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    --bg: color-mix(in srgb, var(--accent) 88%, #fff);
  }
  .ghost {
    --bg: transparent;
    --bd: transparent;
    --bdt: transparent;
    --bdb: transparent;
    color: var(--text-dim);
  }
  .ghost:hover:not(:disabled) {
    --bg: var(--sidebar-hover);
    color: var(--text);
  }
  .danger {
    --bg: color-mix(in srgb, var(--danger) 14%, transparent);
    --bd: color-mix(in srgb, var(--danger) 35%, transparent);
    --bdt: var(--bd);
    --bdb: var(--bd);
    color: var(--danger);
  }
  .danger:hover:not(:disabled) {
    --bg: color-mix(in srgb, var(--danger) 22%, transparent);
  }
  /* Quiet until hovered, then red: a destructive action that is not yet being confirmed. */
  .destructive:hover:not(:disabled) {
    color: var(--danger);
  }
</style>

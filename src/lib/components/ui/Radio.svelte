<script lang="ts">
  // One option of a group: `<Radio bind:group value="a">Label</Radio>`. Selected, the well fills with the
  // accent and keeps a hole in the middle rather than a dot.
  import type { Snippet } from "svelte";

  let {
    group = $bindable(),
    value,
    name,
    disabled = false,
    children,
  }: {
    group?: string;
    value: string;
    name?: string;
    disabled?: boolean;
    children?: Snippet;
  } = $props();
</script>

<label class="radio" class:disabled>
  <input type="radio" {name} {value} {disabled} bind:group />
  {#if children}<span class="text">{@render children()}</span>{/if}
</label>

<style>
  .radio {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.71rem;
    cursor: pointer;
    font-size: var(--text-body-size);
  }
  .radio.disabled {
    cursor: default;
  }
  input {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    flex-shrink: 0;
    width: 1.29rem;
    height: 1.29rem;
    margin: 0;
    border-radius: 50%;
    cursor: inherit;
    background: var(--well);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    transition:
      background calc(0.18s * var(--anim-speed, 1)) ease,
      border-color calc(0.18s * var(--anim-speed, 1)) ease;
  }
  input:hover:not(:disabled) {
    background: var(--sidebar-active);
  }
  input::before {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--panel-bg);
    scale: 0;
    transition: scale calc(0.24s * var(--anim-speed, 1)) var(--ui-spring);
  }
  input:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  input:checked::before {
    scale: 1;
  }
  input:disabled {
    opacity: 0.5;
  }
  input:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
</style>

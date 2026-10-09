<script lang="ts">
  // On/off. A sunk well with a flat bead; on, the well fills with the accent. Held, the bead
  // stretches into a pill (no spring while held, so it doesn't bounce), and springs on release.
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    id,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    id?: string;
    onchange?: (checked: boolean) => void;
  } = $props();

  function toggle() {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button type="button" role="switch" class="switch" aria-checked={checked} aria-label={label} {id} {disabled} onclick={toggle}>
  <span class="bead"></span>
</button>

<style>
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 2.86rem;
    height: 1.57rem;
    padding: 0;
    border-radius: var(--radius-pill);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    background: var(--well);
    cursor: pointer;
    outline: none;
    transition:
      background calc(0.2s * var(--anim-speed, 1)) ease,
      border-color calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .switch:not(:disabled):hover {
    background: var(--sidebar-active);
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .switch:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .bead {
    position: absolute;
    top: 0.14rem;
    left: 0.14rem;
    width: 1.14rem;
    height: 1.14rem;
    /* Half the height rather than 50%, so stretching it makes a pill, not an ellipse. */
    border-radius: 0.57rem;
    background: color-mix(in srgb, var(--bead) 70%, var(--text-dim));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    transition:
      transform calc(0.3s * var(--anim-speed, 1)) var(--ui-spring),
      width calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .switch:not(:disabled):active .bead {
    width: 1.43rem;
    transition:
      transform calc(0.12s * var(--anim-speed, 1)) ease,
      width calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked="true"]:not(:disabled):hover {
    background: color-mix(in srgb, var(--accent) 88%, #fff);
  }
  .switch[aria-checked="true"] .bead {
    transform: translateX(1.29rem);
    background: var(--bead);
  }
  /* Held while on: grow leftward so the right edge stays put. */
  .switch[aria-checked="true"]:not(:disabled):active .bead {
    transform: translateX(1rem);
  }
</style>

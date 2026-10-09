<script lang="ts">
  // A sunk bar with a solid fill. `value` is 0 to 100; leave it out for an indeterminate bar.
  let { value, label }: { value?: number; label?: string } = $props();
  const pct = $derived(value === undefined ? undefined : Math.min(100, Math.max(0, value)));
</script>

<div class="progress" class:indeterminate={pct === undefined} role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
  <i style:width={pct === undefined ? undefined : `${pct}%`}></i>
</div>

<style>
  .progress {
    height: 0.43rem;
    border-radius: var(--radius-pill);
    background: var(--well);
    overflow: hidden;
  }
  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width calc(0.4s * var(--anim-speed, 1)) var(--ui-ease);
  }
  .indeterminate i {
    width: 34%;
    animation: slide calc(1.3s / var(--anim-speed, 1)) ease-in-out infinite;
  }
  @keyframes slide {
    from {
      translate: -100% 0;
    }
    to {
      translate: 300% 0;
    }
  }
</style>

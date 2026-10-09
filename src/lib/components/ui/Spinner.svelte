<script lang="ts">
  // A thin ring that takes the colour of the text around it, or the accent on its own.
  let { size = "m", label = "Loading" }: { size?: "s" | "m" | "l"; label?: string } = $props();
</script>

<span class="spinner {size}" role="status" aria-label={label}></span>

<style>
  .spinner {
    display: inline-block;
    flex-shrink: 0;
    width: 1.14rem;
    height: 1.14rem;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, currentColor 22%, transparent);
    border-top-color: currentColor;
    color: var(--accent);
    animation: turn calc(0.8s / var(--anim-speed, 1)) linear infinite;
  }
  .s {
    width: 0.86rem;
    height: 0.86rem;
    border-width: 1.5px;
    color: inherit;
  }
  .l {
    width: 1.71rem;
    height: 1.71rem;
    border-width: 2.5px;
  }
  @keyframes turn {
    to {
      rotate: 360deg;
    }
  }
</style>

<script lang="ts">
  // One ring for a chat's quiet life: spinning while it runs, a dashed blue ring once it was
  // stopped, a small gray dot at rest. "stop" is the filled disc the row swaps in on hover.
  let { state, size = 13 }: { state: "running" | "stop" | "stopped" | "quiet"; size?: number } = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} class="ring {state}" aria-hidden="true">
  {#if state === "running"}
    <circle class="trk" cx="8" cy="8" r="6.75" />
    <path class="arc" d="M8 1.25A6.75 6.75 0 0 1 14.75 8" />
  {:else if state === "stop"}
    <g class="sv">
      <circle class="disc" cx="8" cy="8" r="7.55" />
      <rect class="sq" x="4.75" y="4.75" width="6.5" height="6.5" rx="1.25" />
    </g>
  {:else}
    <circle class="dash" cx="8" cy="8" r="6.25" />
  {/if}
</svg>

<style>
  .ring {
    display: block;
    flex-shrink: 0;
  }
  .disc {
    fill: var(--info);
  }
  .trk {
    fill: none;
    stroke: color-mix(in srgb, var(--info) 30%, transparent);
    stroke-width: 1.6;
  }
  .arc {
    fill: none;
    stroke: var(--info);
    stroke-width: 1.6;
    stroke-linecap: round;
    transform-box: view-box;
    transform-origin: 8px 8px;
    animation: spin-global calc(1s * var(--icon-slow, 1)) linear infinite;
  }
  .sq {
    fill: var(--bg);
  }
  .sv {
    transform-box: view-box;
    transform-origin: 8px 8px;
    transition: transform 0.1s;
  }
  .dash {
    fill: none;
    stroke-width: 1.5;
    stroke-dasharray: 2 1.27;
  }
  .stopped .dash {
    stroke: var(--info);
  }
  /* At rest: a small plain dot, so it can't be mistaken for the working ring or the lamp. */
  .quiet .dash {
    r: 2.5px;
    fill: var(--sidebar-fg-dim);
    stroke: none;
  }
</style>

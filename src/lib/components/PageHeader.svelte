<script lang="ts">
  // The strip across the top of a full page (usage, extensions, diagnostics): the title island on
  // the left, `controls` on the right. Padding leaves room for the sidebar toggle and the chrome
  // buttons that float over the corners.
  import type { Snippet } from "svelte";
  import ScopeTitle from "./ScopeTitle.svelte";

  let { controls, ...rest }: { controls?: Snippet } & Omit<import("svelte").ComponentProps<typeof ScopeTitle>, "variant"> = $props();
</script>

<header class="head">
  <ScopeTitle {...rest} />
  {#if controls}<div class="controls">{@render controls()}</div>{/if}
</header>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    flex-shrink: 0;
    min-height: var(--header-line);
    padding: var(--header-pad-y) calc(var(--header-pad-x) + var(--page-reserve)) var(--header-pad-y) var(--chrome-inset-in-panel);
    background: var(--panel-bg);
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  :global(.panel.sidebar-collapsed) .head {
    padding-left: var(--toggle-reserve-in-panel);
  }
  @media (max-width: 700px) {
    .head {
      padding-right: var(--header-pad-x);
    }
  }
  /* Held to the header line so the taller dropdowns don't push the island off the sidebar toggle's line. */
  .controls {
    display: flex;
    align-items: center;
    height: var(--header-line);
    gap: 0.2rem;
    margin-left: auto;
  }
</style>

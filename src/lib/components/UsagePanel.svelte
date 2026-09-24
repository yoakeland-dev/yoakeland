<script lang="ts">
  // Placeholder for the usage page; the bars are decoration until there's real data behind them.
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  const BARS = [30, 52, 41, 68, 45, 80, 62, 38, 71, 55, 90, 48, 66, 34];
</script>

<div class="panel" class:sidebar-collapsed={app.sidebarCollapsed}>
  <div class="wrap">
    <h1><Icon name="chart-bar" size={18} /> Usage</h1>
    <p class="sub">Token and cost breakdowns per server, provider and project will live here.</p>
    <div class="chart" aria-hidden="true">
      {#each BARS as h, i (i)}<span class="bar" style="height: {h}%"></span>{/each}
    </div>
    <p class="soon">Coming soon</p>
  </div>
</div>

<style>
  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-xl);
    margin: var(--chat-margin) var(--chat-margin) var(--chat-margin) 0;
    transition: margin-left calc(0.2s * var(--anim-speed, 1)) ease;
    overflow-y: auto;
  }
  .panel.sidebar-collapsed {
    margin-left: var(--chat-margin);
  }
  :global(:root[data-main="flat"]) .panel {
    border-radius: 0;
    border-width: 0 0 0 1px;
  }
  .wrap {
    width: min(32rem, 100%);
    padding: 2rem;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 var(--space-half);
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
    color: var(--text);
  }
  .sub {
    margin: 0 0 1.5rem;
    color: var(--text-dim);
    font-size: var(--text-body-size);
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 0.36rem;
    height: 9rem;
    padding-bottom: 1px;
    border-bottom: 1px solid var(--panel-border);
  }
  .bar {
    flex: 1;
    border-radius: 3px 3px 0 0;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .soon {
    margin: 0.86rem 0 0;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>

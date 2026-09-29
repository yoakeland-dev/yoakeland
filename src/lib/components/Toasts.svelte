<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Live notifications pop up bottom-right for a few seconds (see
  // AppState.toast for which ones); the bell in the status bar keeps them.
  import { fly } from "svelte/transition";
  import { app } from "../state.svelte";
  import { openNotificationTarget } from "../ipc";
  import Icon from "./Icon.svelte";

  const ICONS = { info: "bell", success: "circle-check", warning: "warning", error: "alert-circle" } as const;
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast level-{t.level}" transition:fly={{ y: 12, duration: 160 }}>
      <button
        type="button"
        class="body"
        onclick={() => {
          openNotificationTarget(t.connectionId, t);
          app.dropToast(t.id);
        }}
      >
        <Icon name={ICONS[t.level] ?? "bell"} size={14} />
        <span class="text">
          <span class="title">{t.title}</span>
          {#if t.body}<span class="detail">{t.body}</span>{/if}
        </span>
      </button>
      {#if t.action}
        <button
          type="button"
          class="action"
          onclick={() => {
            t.action?.run();
            app.dropToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button type="button" class="x" {@attach tip("Close")} onclick={() => app.dropToast(t.id)}>
        <Icon name="xmark" size={12} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 2.6rem; /* above the status bar */
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    z-index: var(--z-popover);
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    width: min(22rem, 90vw);
    display: flex;
    align-items: flex-start;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 0.57rem;
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 0.64rem 0.71rem;
    cursor: pointer;
  }
  .level-success .body :global(.icon) {
    color: var(--success);
  }
  .level-warning .body :global(.icon) {
    color: var(--warning);
  }
  .level-error .body :global(.icon) {
    color: var(--danger);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    min-width: 0;
  }
  .title {
    font-size: 0.82rem;
  }
  .detail {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action {
    align-self: center;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-label-size);
    font-weight: 600;
    padding: 0.36rem 0.5rem;
    cursor: pointer;
  }
  .x {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.64rem 0.5rem;
    cursor: pointer;
  }
</style>

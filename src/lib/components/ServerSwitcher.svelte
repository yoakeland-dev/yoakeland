<script lang="ts">
  // Only appears once there's something to switch between — a single
  // connected server looks exactly like the sidebar always has (see the
  // multi-server-connections plan's Phase 4: this is additive, not a
  // redesign of the common case). Picking a pill focuses that connection
  // (app.activeConnectionId) — everything else in the sidebar (the project
  // picker, session list, Active/Archive tabs) already reads through
  // app.active, so nothing else here needs to change to follow it.
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  const entries = $derived(Object.entries(app.servers));
</script>

{#if entries.length > 1}
  <div class="server-switcher">
    {#each entries as [cid, server] (cid)}
      {@const label = server.serverIdentity ?? (server.connectionMode === "local" ? "Local" : "Remote")}
      <button
        type="button"
        class="server-pill"
        class:active={cid === app.activeConnectionId}
        title={label}
        onclick={() => (app.activeConnectionId = cid)}
      >
        <span
          class="dot"
          class:live={server.connectionStatus === "connected"}
          class:err={server.connectionStatus === "error" || server.connectionStatus === "disconnected"}
        ></span>
        <span class="label">{label}</span>
      </button>
    {/each}
    <button
      type="button"
      class="add-server"
      title="Add another server"
      aria-label="Add another server"
      onclick={() => (app.showConnectModal = true)}
    >
      <Icon name="plus" size={12} />
    </button>
  </div>
{/if}

<style>
  .server-switcher {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    flex-wrap: wrap;
  }
  .server-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    max-width: 8rem;
    background: transparent;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-pill);
    padding: 0.21rem 0.57rem;
    font-size: var(--text-heading-size);
    cursor: pointer;
  }
  .server-pill:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .server-pill.active {
    background: var(--sidebar-active);
    border-color: var(--accent);
    color: var(--text);
  }
  .server-pill .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex-shrink: 0;
    width: 0.43rem;
    height: 0.43rem;
    border-radius: 50%;
    background: var(--sidebar-fg-dim);
  }
  .dot.live {
    background: var(--success);
  }
  .dot.err {
    background: var(--danger);
  }
  .add-server {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 1.29rem;
    background: transparent;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--sidebar-fg-dim);
    border-radius: 50%;
    cursor: pointer;
  }
  .add-server:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
</style>

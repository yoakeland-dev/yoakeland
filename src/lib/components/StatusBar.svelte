<script lang="ts">
  import { app } from "../state.svelte";
  import { basename } from "../format";

  const lastFinish = $derived(
    [...app.currentMessages].reverse().find((m) => m.role === "assistant" && m.finish)?.finish,
  );
  const projectName = $derived(app.currentProjectPath ? basename(app.currentProjectPath) : null);
</script>

<footer class="statusbar">
  <div class="left">
    <span class="item" class:live={app.connectionStatus === "connected"}>
      ● {app.connectionStatus}
    </span>
    <span class="item">{app.connectionMode}</span>
    {#if app.serverIdentity}
      <span class="item" title="Server identity">{app.serverIdentity}</span>
    {/if}
    {#if projectName}
      <span class="item" title={app.currentProjectPath}>{projectName}</span>
    {/if}
    {#if app.isCurrentTurnActive}
      <span class="item busy">turn in progress…</span>
    {/if}
  </div>
  <div class="right">
    {#if lastFinish?.spend}
      <span class="item">project ${(lastFinish.spend.projectTotalUsd ?? 0).toFixed(2)}</span>
    {/if}
    {#if app.cliAvailability.claude || app.cliAvailability.codex}
      <span class="item">
        CLI: {app.cliAvailability.claude ? "claude" : ""}{app.cliAvailability.claude && app.cliAvailability.codex ? ", " : ""}{app.cliAvailability.codex ? "codex" : ""}
      </span>
    {/if}
    <span class="item">{app.projects.length} project{app.projects.length === 1 ? "" : "s"}</span>
    <span class="item">{app.currentSessions.length} thread{app.currentSessions.length === 1 ? "" : "s"}</span>
  </div>
</footer>

<style>
  .statusbar {
    height: 1.86rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    background: var(--statusbar-bg);
    color: var(--statusbar-fg);
    font-size: var(--text-heading-size);
    border-top: 1px solid var(--panel-border);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .item.live {
    color: var(--success);
  }
  .item.busy {
    color: var(--accent);
  }
</style>

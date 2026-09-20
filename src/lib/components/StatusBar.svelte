<script lang="ts">
  import { app } from "../state.svelte";
  import { basename } from "../format";

  // Per-server fields live on the active connection's own ServerState now —
  // see the multi-server-connections plan.
  let server = $derived(app.active);

  const lastFinish = $derived(
    [...(server?.currentMessages ?? [])].reverse().find((m) => m.role === "assistant" && m.finish)?.finish,
  );
  const projectName = $derived(server?.currentProjectPath ? basename(server.currentProjectPath) : null);
</script>

<footer class="statusbar">
  <div class="left">
    <span class="item" class:live={app.connectionStatus === "connected"}>
      ● {app.connectionStatus}
    </span>
    <span class="item">{app.connectionMode}</span>
    {#if server?.serverIdentity}
      <span class="item" title="Server identity">{server.serverIdentity}</span>
    {/if}
    {#if projectName}
      <span class="item" title={server?.currentProjectPath}>{projectName}</span>
    {/if}
    {#if server?.isCurrentTurnActive}
      <span class="item busy">turn in progress…</span>
    {/if}
  </div>
  <div class="right">
    {#if lastFinish?.spend}
      <span class="item">project ${(lastFinish.spend.projectTotalUsd ?? 0).toFixed(2)}</span>
    {/if}
    {#if server?.cliAvailability.claude || server?.cliAvailability.codex}
      <span class="item">
        CLI: {server.cliAvailability.claude ? "claude" : ""}{server.cliAvailability.claude && server.cliAvailability.codex ? ", " : ""}{server.cliAvailability.codex ? "codex" : ""}
      </span>
    {/if}
    <span class="item">{server?.projects.length ?? 0} project{(server?.projects.length ?? 0) === 1 ? "" : "s"}</span>
    <span class="item">{server?.currentSessions.length ?? 0} thread{(server?.currentSessions.length ?? 0) === 1 ? "" : "s"}</span>
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

<script lang="ts">
  // Every file that differs from HEAD, staged or not, each expanding into its diff.
  import { app } from "../../state.svelte";
  import { listGitChanges } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import type { GitChange } from "../../types";
  import Icon from "../Icon.svelte";
  import EmptyState from "./EmptyState.svelte";
  import ChangedFile, { latest, statusOf } from "./ChangedFile.svelte";

  let { sessionId, projectPath, visible = true }: { sessionId: string; projectPath: string; visible?: boolean } = $props();

  const server = $derived(app.active);
  let files = $state<GitChange[]>([]);
  let truncated = $state(false);
  let error = $state("");
  let open = $state<Record<string, boolean>>({});

  async function load() {
    const cid = app.activeConnectionId;
    if (!cid) return;
    try {
      const r = await listGitChanges(cid, projectPath);
      error = r.error ?? "";
      files = r.files ?? [];
      truncated = !!r.truncated;
    } catch (e) {
      error = String(e);
    }
  }

  refreshWhenVisible(() => `${projectPath}#${server?.fsTickByProject[projectPath] ?? 0}`, () => visible, load);

  const anyOpen = $derived(Object.values(open).some(Boolean));
</script>

<div class="panel">
  {#if !error && files.length}
  <div class="toolbar">
    <span class="title">{files.length}{truncated ? "+" : ""} changed {files.length === 1 ? "file" : "files"}</span>
    <button type="button" class="btn" title="Refresh" onclick={load}><Icon name="refresh" size={14} /></button>
    <button
      type="button"
      class="btn"
      title={anyOpen ? "Collapse all" : "Expand all"}
      onclick={() => (open = anyOpen ? {} : Object.fromEntries(files.map((f) => [f.path, true])))}
    >
      <Icon name={anyOpen ? "arrows-minimize" : "maximize"} size={14} />
    </button>
  </div>
  {/if}
  <div class="list">
    {#if error}
      {#if /not a git repository/i.test(error)}
        <EmptyState icon="git-branch" title="Not a git repository" body="Changes are tracked against git; run git init in the project to see them here." />
      {:else}
        <EmptyState icon="alert-circle" tone="danger" title="Couldn't read changes" body={error}>
          <button type="button" onclick={load}><Icon name="refresh" size={12} /> Try again</button>
        </EmptyState>
      {/if}
    {:else if !files.length}
      <EmptyState icon="checks" tone="success" title="No changes" body="The working tree matches the last commit." />
    {/if}
    {#each files as f (f.path)}
      {@const s = statusOf(latest(f), f.conflict)}
      <ChangedFile {sessionId} {projectPath} path={f.path} basePath={f.origPath} badge={s.badge} tone={s.tone} bind:expanded={open[f.path]} {visible} />
    {/each}
  </div>
</div>

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.14rem;
    padding: 0.29rem var(--space-1);
    border-bottom: 1px solid var(--panel-border);
  }
  .title {
    flex: 1;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .btn {
    display: flex;
    padding: 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .btn:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-bottom: var(--space-2);
  }
</style>

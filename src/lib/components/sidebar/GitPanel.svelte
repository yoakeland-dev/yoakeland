<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // Full `git status`: branch and upstream from git_status (§3.2), files grouped like VS Code's
  // Source Control view from list_git_changes. A file staged and then edited again shows in both.
  import { app } from "../../state.svelte";
  import { listGitChanges } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import type { GitChange } from "../../types";
  import Icon from "../Icon.svelte";
  import EmptyState from "./EmptyState.svelte";
  import ChangedFile, { statusOf } from "./ChangedFile.svelte";

  let { sessionId, projectPath, visible = true }: { sessionId: string; projectPath: string; visible?: boolean } = $props();

  const server = $derived(app.active);
  const git = $derived(server?.gitStatusByProject[projectPath]);
  let files = $state<GitChange[]>([]);
  let truncated = $state(false);
  let error = $state("");
  let collapsed = $state<Record<string, boolean>>({});

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

  const groups = $derived([
    { id: "conflicts", label: "Merge conflicts", items: files.filter((f) => f.conflict).map((f) => ({ f, letter: "U" })) },
    {
      id: "staged",
      label: "Staged",
      items: files.filter((f) => !f.conflict && f.index !== "." && f.index !== "?").map((f) => ({ f, letter: f.index })),
    },
    {
      id: "changes",
      label: "Changes",
      items: files.filter((f) => !f.conflict && f.worktree !== "." && f.worktree !== "?").map((f) => ({ f, letter: f.worktree })),
    },
    { id: "untracked", label: "Untracked", items: files.filter((f) => f.index === "?").map((f) => ({ f, letter: "?" })) },
  ]);
</script>

<div class="panel">
  <div class="head">
    <Icon name="git-branch" size={14} />
    {#if git}
      <span class="branch">{git.detached ? "detached HEAD" : git.branch}</span>
      {#if git.hasUpstream}
        <span class="sync" {@attach tip(`${git.ahead} to push, ${git.behind} to pull`)}>
          {#if git.ahead}<span>↑{git.ahead}</span>{/if}
          {#if git.behind}<span class="behind">↓{git.behind}</span>{/if}
          {#if !git.ahead && !git.behind}<span class="dim">in sync</span>{/if}
        </span>
      {:else}
        <span class="dim" {@attach tip("No upstream branch")}>no upstream</span>
      {/if}
    {:else}
      <span class="branch dim">{error ? "No repository" : "…"}</span>
    {/if}
    <button type="button" class="btn" {@attach tip("Refresh")} onclick={load}><Icon name="refresh" size={14} /></button>
  </div>
  <div class="list">
    {#if error}
      {#if /not a git repository/i.test(error)}
        <EmptyState icon="git-branch" title="Not a git repository" body="Changes are tracked against git; run git init in the project to see them here." />
      {:else}
        <EmptyState icon="alert-circle" tone="danger" title="Couldn't read git status" body={error}>
          <button type="button" onclick={load}><Icon name="refresh" size={12} /> Try again</button>
        </EmptyState>
      {/if}
    {:else if !files.length}
      <EmptyState icon="checks" tone="success" title="Working tree clean" body="Nothing staged, changed or untracked." />
    {/if}
    {#each groups as g (g.id)}
      {#if g.items.length}
        <button type="button" class="group" onclick={() => (collapsed[g.id] = !collapsed[g.id])}>
          <Icon name={collapsed[g.id] ? "chevron-right" : "chevron-down"} size={12} />
          <span>{g.label}</span>
          <span class="count">{g.items.length}</span>
        </button>
        {#if !collapsed[g.id]}
          {#each g.items as { f, letter } (f.path)}
            {@const s = statusOf(letter, f.conflict)}
            <ChangedFile {sessionId} {projectPath} path={f.path} basePath={f.origPath} badge={s.badge} tone={s.tone} {visible} />
          {/each}
        {/if}
      {/if}
    {/each}
    {#if truncated}<div class="more">Only the first {files.length} changes are listed.</div>{/if}
  </div>
</div>

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.29rem var(--space-1);
    border-bottom: 1px solid var(--panel-border);
    font-size: var(--text-label-size);
  }
  .head :global(.icon) {
    color: var(--text-dim);
  }
  .branch {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .sync {
    display: flex;
    gap: 0.36rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .behind {
    color: var(--accent);
  }
  .dim {
    color: var(--text-dim);
    font-weight: normal;
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
  .more {
    padding: var(--space-1);
    color: var(--text-dim);
    text-align: center;
    font-size: var(--text-label-size);
  }
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-bottom: var(--space-2);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    width: 100%;
    padding: 0.43rem var(--space-1) 0.21rem;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .count {
    margin-left: auto;
    font-weight: normal;
  }
</style>

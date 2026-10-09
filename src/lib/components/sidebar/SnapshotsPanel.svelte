<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // Snapshots (§3.1 list_snapshots/restore_snapshot): one per agent turn that edited files.
  // Each file's diff is "what restoring would revert": that turn's copy against the file now.
  import { onDestroy } from "svelte";
  import { app } from "../../state.svelte";
  import { listSnapshots, restoreSnapshot } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import Icon from "../Icon.svelte";
  import EmptyState from "./EmptyState.svelte";
  import ChangedFile from "./ChangedFile.svelte";

  let { sessionId, projectPath, visible = true }: { sessionId: string; projectPath: string; visible?: boolean } = $props();

  const server = $derived(app.active);
  const snapshots = $derived([...(server?.snapshotsByProject[projectPath] ?? [])].reverse());
  let open = $state<string | null>(null);

  // Snapshots appear as turns finish and restores add one, both of which bump the tick.
  refreshWhenVisible(
    () => `${projectPath}#${server?.fsTickByProject[projectPath] ?? 0}`,
    () => visible,
    () => app.activeConnectionId && listSnapshots(app.activeConnectionId, projectPath),
  );

  // restore_snapshot has no request id, so wait for snapshot_restored, bounded by a timeout.
  let restoringId = $state<string | null>(null);
  let restoreTimeout: ReturnType<typeof setTimeout> | undefined;

  function restore(snapshotId: string, when: string) {
    const cid = app.activeConnectionId;
    if (!cid) return;
    const ok = confirm(
      `Restore the project to how it was before ${when}?\n\nEvery file this and later snapshots touched goes back. Your current state is saved as a new snapshot first, so you can undo this.`,
    );
    if (!ok) return;
    restoringId = snapshotId;
    restoreSnapshot(cid, sessionId, snapshotId, projectPath);
    clearTimeout(restoreTimeout);
    restoreTimeout = setTimeout(() => (restoringId = null), 15000);
  }

  $effect(() => {
    if (restoringId && server?.lastSnapshotRestored?.snapshotId === restoringId) {
      clearTimeout(restoreTimeout);
      restoringId = null;
    }
  });

  onDestroy(() => clearTimeout(restoreTimeout));

  const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<div class="panel">
  {#if snapshots.length}
    <div class="note">Only yoakeland's own edits are snapshotted; CLI agents edit files directly.</div>
  {/if}
  <div class="list">
    {#each snapshots as snap (snap.snapshotId)}
      {@const files = snap.files ?? []}
      <div class="snap" class:open={open === snap.snapshotId}>
        <div class="snap-row">
          <button type="button" class="snap-main" onclick={() => (open = open === snap.snapshotId ? null : snap.snapshotId)}>
            <Icon name={open === snap.snapshotId ? "chevron-down" : "chevron-right"} size={12} />
            <span class="info">
              <span class="desc" {@attach tip(snap.description)}>{snap.description || "Turn"}</span>
              <span class="meta">{time(snap.createdAt)}{files.length ? ` · ${files.length} ${files.length === 1 ? "file" : "files"}` : ""}</span>
            </span>
          </button>
          <button
            type="button"
            class="restore"
            disabled={restoringId !== null}
            {@attach tip("Restore the project to right before this snapshot")}
            onclick={() => restore(snap.snapshotId, time(snap.createdAt))}
          >
            <Icon name="corner-up-left" size={13} />
            {restoringId === snap.snapshotId ? "Restoring…" : "Restore"}
          </button>
        </div>
        {#if open === snap.snapshotId}
          <div class="files">
            {#each files as f (f)}
              <ChangedFile {sessionId} {projectPath} path={f} snapshotId={snap.snapshotId} badge="" {visible} />
            {:else}
              <div class="files-note">This server doesn't list a snapshot's files; update it to see them.</div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <EmptyState
        icon="history"
        title="No snapshots yet"
        body="Each turn where yoakeland's own agent edits files saves one here, so you can rewind it. CLI agents (Claude, Codex, …) edit files directly; use git for those."
      />
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
  .note {
    padding: 0.43rem var(--space-1);
    font-size: var(--text-label-size);
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
  }
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding-bottom: var(--space-2);
  }
  .snap.open {
    background: rgba(255, 255, 255, 0.02);
  }
  .snap-row {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    padding-right: var(--space-1);
  }
  .snap-row:hover {
    background: var(--sidebar-hover);
  }
  .snap-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.43rem var(--space-1);
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .snap-main :global(.icon) {
    color: var(--text-dim);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .desc {
    font-size: var(--text-label-size);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 0.7rem;
    color: var(--text-dim);
  }
  .restore {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.21rem 0.5rem;
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .restore:hover:not(:disabled) {
    color: var(--accent);
  }
  .restore:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .files-note {
    padding: 0.36rem var(--space-1);
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .files {
    padding: 0 0 var(--space-half) var(--space-1);
  }
</style>

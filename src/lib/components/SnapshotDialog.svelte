<script lang="ts">
  // Snapshot browse/restore UI (SPEC.md §3.1/§3.2 list_snapshots/restore_snapshot/
  // snapshot_restored) — state was already wired (snapshotsByProject), just no
  // UI to trigger it.
  import { onDestroy } from "svelte";
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { listSnapshots, restoreSnapshot } from "../ipc";
  import Icon from "./Icon.svelte";

  const snapshots = $derived(app.currentProjectPath ? app.snapshotsByProject[app.currentProjectPath] ?? [] : []);

  // Tracks the snapshot currently being restored so the dialog waits for the
  // backend's snapshot_restored confirmation instead of closing optimistically
  // right after sending the request. Bounded by a timeout since restore_snapshot
  // carries no correlation id to match a failure back to this specific request.
  let restoringId = $state<string | null>(null);
  let restoreTimeout: ReturnType<typeof setTimeout> | undefined;

  // bind:open below keeps app.showSnapshots in sync for every open/close
  // path; this effect just runs the "just opened" side effect (refresh the
  // list) on the false → true transition, matching the same idiom used in
  // ModelPicker/DirectoryBrowser.
  let wasOpen = false;
  $effect(() => {
    if (app.showSnapshots && !wasOpen && app.currentProjectPath) listSnapshots(app.currentProjectPath);
    wasOpen = app.showSnapshots;
  });

  function restore(snapshotId: string) {
    if (!app.currentSessionId) return;
    if (!confirm("Restore this snapshot? This overwrites the project's current files.")) return;
    restoringId = snapshotId;
    restoreSnapshot(app.currentSessionId, snapshotId);
    clearTimeout(restoreTimeout);
    restoreTimeout = setTimeout(() => {
      restoringId = null;
    }, 15000);
  }

  $effect(() => {
    if (restoringId && app.lastSnapshotRestored?.snapshotId === restoringId) {
      clearTimeout(restoreTimeout);
      restoringId = null;
      app.showSnapshots = false;
    }
  });

  onDestroy(() => clearTimeout(restoreTimeout));
</script>

<Dialog.Root bind:open={app.showSnapshots}>
  <Dialog.Portal>
    <Dialog.Overlay class="snap-overlay" />
    <Dialog.Content class="snap-content">
      <div class="head">
        <Dialog.Title>Snapshots</Dialog.Title>
        <Dialog.Close class="snap-close"><Icon name="xmark" size={14} /></Dialog.Close>
      </div>
      <ul class="list">
        {#each snapshots as snap (snap.snapshotId)}
          <li>
            <div class="info">
              <span class="desc">{snap.description}</span>
              <span class="date">{new Date(snap.createdAt).toLocaleString()}</span>
            </div>
            <button
              type="button"
              onclick={() => restore(snap.snapshotId)}
              disabled={restoringId !== null}
              title="Restore this snapshot"
            >
              <Icon name="corner-up-left" size={13} />
              {restoringId === snap.snapshotId ? "Restoring…" : "Restore"}
            </button>
          </li>
        {:else}
          <li class="empty">No snapshots for this project yet.</li>
        {/each}
      </ul>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims only — the dialog card above it is what frosts, so the blur is the
     card's own and the background behind it stays readable. */
  :global(.snap-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.5);
    z-index: var(--z-overlay-backdrop);
  }
  :global(.snap-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(31.43rem, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    /* A floating surface — see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.71rem;
    flex-shrink: 0;
  }
  .head :global(h2) {
    margin: 0;
    font-size: 1rem;
  }
  :global(.snap-close) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.71rem;
    height: 1.71rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.71rem;
    padding: 0.57rem;
    border-radius: var(--radius-sm);
  }
  .list li:hover {
    background: var(--sidebar-hover);
  }
  .list li.empty {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    min-width: 0;
  }
  .desc {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .date {
    font-size: 0.7rem;
    color: var(--text-dim);
  }
  .list button {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.36rem 0.71rem;
    font-size: 0.76rem;
    cursor: pointer;
  }
  .list button:hover {
    color: var(--accent);
  }
  .list button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

<script lang="ts">
  // In-app folder browser (SPEC.md §3.1 list_directory) — the correct way to
  // pick a project folder over a remote/TCP connection, where a native OS
  // dialog would browse this machine's disk instead of the backend's.
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { listDirectory, resolveDirectoryBrowser } from "../ipc";
  import Icon from "./Icon.svelte";

  // ponytail: naive POSIX-style path join/parent — fine since yoakeland
  // itself only targets POSIX today (§2a's unix-socket note).
  function parentOf(path: string): string {
    const trimmed = path.replace(/\/+$/, "");
    const idx = trimmed.lastIndexOf("/");
    return idx > 0 ? trimmed.slice(0, idx) : "/";
  }

  function childPath(path: string, name: string): string {
    return path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
  }

  // bind:open below keeps app.showDirectoryBrowser in sync for every close
  // path (Escape, outside click, the Close button) — this effect just runs
  // the side effect a plain assignment can't: resolving the pending
  // browseRemoteDirectory() promise with null so its caller doesn't hang
  // forever. Resolving "Select this folder" (below) already calls
  // resolveDirectoryBrowser directly with a real path; resolveDirectoryBrowser
  // is a no-op on a second call (its resolve callback is already cleared), so
  // this effect firing again afterward is harmless.
  let wasOpen = false;
  $effect(() => {
    if (wasOpen && !app.showDirectoryBrowser) resolveDirectoryBrowser(null);
    wasOpen = app.showDirectoryBrowser;
  });
</script>

<Dialog.Root bind:open={app.showDirectoryBrowser}>
  <Dialog.Portal>
    <Dialog.Overlay class="browser-overlay" />
    <Dialog.Content class="browser-content">
      <div class="head">
        <Dialog.Title>Choose a folder</Dialog.Title>
        <Dialog.Close class="browser-close"><Icon name="xmark" size={14} /></Dialog.Close>
      </div>
      {#if app.directoryListing}
        <div class="path-row">
          <button
            type="button"
            class="up"
            disabled={app.directoryListing.path === "/"}
            onclick={() => listDirectory(parentOf(app.directoryListing!.path))}
            title="Up one level"
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <span class="path" title={app.directoryListing.path}>{app.directoryListing.path}</span>
        </div>
        <ul class="entries">
          {#each app.directoryListing.entries.filter((e) => e.isDir) as entry (entry.name)}
            <li>
              <button type="button" onclick={() => listDirectory(childPath(app.directoryListing!.path, entry.name))}>
                <Icon name="folder" size={14} /> {entry.name}
              </button>
            </li>
          {:else}
            <li class="empty">No subfolders here.</li>
          {/each}
        </ul>
        <button
          type="button"
          class="primary"
          onclick={() => resolveDirectoryBrowser(app.directoryListing!.path)}
        >
          <Icon name="folder-open" size={13} /> Select this folder
        </button>
      {:else}
        <p class="hint">Loading…</p>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims only — the dialog card above it is what frosts, so the blur is the
     card's own and the background behind it stays readable. */
  :global(.browser-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.5);
    z-index: var(--z-overlay-backdrop);
  }
  :global(.browser-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(34.29rem, 92vw);
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
  :global(.browser-close) {
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
  .path-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
  }
  .up {
    flex-shrink: 0;
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
  .up:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    font-family: var(--code-font-family);
  }
  .entries {
    list-style: none;
    margin: 0 0 0.71rem;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .entries button {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.5rem 0.57rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .entries button:hover {
    background: var(--sidebar-hover);
  }
  .entries .empty {
    padding: 0.5rem 0.57rem;
    color: var(--text-dim);
    font-size: 0.8rem;
  }
  .hint {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .primary {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    background: var(--accent);
    color: #0d1020;
    font-weight: 600;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.57rem 1rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
</style>

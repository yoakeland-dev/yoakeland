<script lang="ts">
  // The connect modal — additive as of Phase 4 of the multi-server-connections
  // plan: opening it and connecting never replaces an existing connection
  // (ipc.ts's connectTcp/connectLocalUnix always add a new app.servers entry),
  // so this is equally "connect your first server" and "add another one."
  import { Dialog } from "bits-ui";
  import { app, loadKnownServers, type KnownServer } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import ConnectForm from "./ConnectForm.svelte";

  function onDismiss() {
    app.showConnectModal = false;
  }

  const hasAnyServer = $derived(Object.keys(app.servers).length > 0);

  // Remembered servers (yoake.knownServers, populated by ServerState's
  // hydrateFromServerId on every successful connect) minus whichever are
  // already live right now — nothing to "reconnect" to for one that's
  // already connected. Never includes an auth token (see KnownServer's own
  // doc comment) — a remembered remote server still needs it typed in.
  const knownServers = $derived(
    loadKnownServers().filter(
      (k) => !Object.values(app.servers).some((s) => s.serverId === k.serverId),
    ),
  );

  let form: ConnectForm | undefined = $state();

  function reconnectKnown(known: KnownServer) {
    if (known.mode === "local" && known.socketPath) {
      form?.connectToKnownLocal(known.socketPath);
    } else if (known.mode === "remote" && known.host && known.port) {
      form?.prefillKnownRemote(known.host, known.port);
    }
  }
</script>

<Dialog.Root bind:open={app.showConnectModal}>
  <Dialog.Portal>
    <Dialog.Overlay class="connect-overlay" />
    <Dialog.Content class="connect-card">
      <Dialog.Close class="connect-close" title="Explore without connecting">
        <Icon name="xmark" size={14} />
      </Dialog.Close>
      <h1>{hasAnyServer ? "Add a server" : "Connect to yoakeland"}</h1>
      <p class="sub">Talk to a local project directly, or open a remote/shared server.</p>

      {#if knownServers.length > 0}
        <ul class="known-list">
          {#each knownServers as known (known.serverId)}
            <li>
              <Icon name={known.mode === "local" ? "computer" : "cloud"} size={13} />
              <span class="known-label">{known.label || (known.mode === "local" ? known.socketPath : `${known.host}:${known.port}`)}</span>
              <button type="button" onclick={() => reconnectKnown(known)}>Reconnect</button>
            </li>
          {/each}
        </ul>
      {/if}

      <ConnectForm bind:this={form} onconnected={onDismiss} />

      <button class="explore-link" onclick={onDismiss}>Explore without connecting</button>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims only — the connect card above it is what frosts, so the blur is the
     card's own and the background behind it stays readable. */
  :global(.connect-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.55);
    z-index: var(--z-overlay-backdrop);
    animation: scrimIn var(--dialog-enter-duration) ease-out;
  }
  :global(.connect-overlay[data-state="closed"]) {
    animation: scrimOut var(--dialog-exit-duration) ease-in;
  }
  :global(.connect-card) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 31.43rem;
    /* A floating surface — see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    padding: 2rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
    animation: dialogIn var(--dialog-enter-duration) ease-out;
  }
  :global(.connect-card[data-state="closed"]) {
    animation: dialogOut var(--dialog-exit-duration) ease-in;
  }
  :global(.connect-close) {
    position: absolute;
    top: 1.14rem;
    right: 1.14rem;
    width: 1.86rem;
    height: 1.86rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-pill);
    color: var(--text-dim);
    cursor: pointer;
  }
  :global(.connect-close:hover) {
    color: var(--text);
  }
  .explore-link {
    display: block;
    margin: 1rem auto 0;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.78rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .explore-link:hover {
    color: var(--text);
  }
  h1 {
    margin: 0 0 var(--space-half);
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  .sub {
    margin: 0 0 1.29rem;
    color: var(--text-dim);
    font-size: var(--text-body-size);
  }
  .known-list {
    list-style: none;
    margin: 0 0 1.29rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .known-list li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.43rem 0.57rem;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .known-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
  }
  .known-list button {
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.29rem 0.71rem;
    font-size: var(--text-heading-size);
    cursor: pointer;
  }
</style>

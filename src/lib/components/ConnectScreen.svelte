<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { Dialog, Tabs } from "bits-ui";
  import {
    connectLocalUnix,
    connectTcp,
    caServerKey,
    importCaCertFile,
    FALLBACK_SOCKET_PATH,
    getDefaultSocketPath,
  } from "../ipc";
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  function onDismiss() {
    app.showConnectModal = false;
  }

  let tab = $state("local");

  // Local — a Unix domain socket (§2a): no token, the OS already restricts
  // who can connect to this user account. A yoakeland server is expected to
  // be its own standalone process, and isn't bound to any one project (§4b
  // — that's picked afterward, per session, from the sidebar). We only ever
  // try to launch one as a fallback, detached, after finding nothing already
  // listening at socketPath (see connectLocalUnix).
  let binPath = $state("yoakeland");
  let socketPath = $state(FALLBACK_SOCKET_PATH);
  getDefaultSocketPath().then((p) => (socketPath = p));

  // Remote (TCP) — always goes through the real auth handshake (§2a), and is
  // never something this app would launch on your behalf.
  let host = $state("");
  let port = $state(7890);
  let token = $state("");

  // TLS is mandatory on the TCP listener now (§2a) — either yoakeland's own
  // auto-managed CA (paired by importing its ca.pem, the common case) or an
  // operator-supplied real certificate (leave this blank to trust the OS's
  // own certificate store instead). Remembered per host:port so returning to
  // a known server doesn't ask again.
  let caPem = $state("");
  let importingCa = $state(false);
  let caImportError = $state<string | null>(null);
  $effect(() => {
    caPem = app.settings.trustedCaByServer[caServerKey(host, port)] ?? "";
  });

  async function importCa() {
    importingCa = true;
    caImportError = null;
    try {
      const contents = await importCaCertFile();
      if (contents) caPem = contents;
    } catch (err) {
      caImportError = String(err);
    } finally {
      importingCa = false;
    }
  }

  async function pickBinary() {
    const file = await open({ multiple: false, title: "Locate yoakeland binary" });
    if (typeof file === "string") binPath = file;
  }

  async function submitLocal(e: Event) {
    e.preventDefault();
    await connectLocalUnix({ binPath, socketPath });
    onDismiss();
  }

  async function submitRemote(e: Event) {
    e.preventDefault();
    await connectTcp(host, port, token, caPem);
    onDismiss();
  }
</script>

<Dialog.Root bind:open={app.showConnectModal}>
  <Dialog.Portal>
    <Dialog.Overlay class="connect-overlay" />
    <Dialog.Content class="connect-card">
      <Dialog.Close class="connect-close" title="Explore without connecting">
        <Icon name="xmark" size={14} />
      </Dialog.Close>
      <h1>Connect to yoakeland</h1>
    <p class="sub">Talk to a local project directly, or open a remote/shared server.</p>

    <Tabs.Root bind:value={tab} class="tabs-root">
      <Tabs.List class="connect-tabs">
        <Tabs.Trigger value="local" class="connect-tab-trigger">
          <Icon name="computer" size={14} /> Local project
        </Tabs.Trigger>
        <Tabs.Trigger value="remote" class="connect-tab-trigger">
          <Icon name="cloud" size={14} /> Remote server
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="local">
        <form onsubmit={submitLocal}>
          <p class="hint">
            Connects to a yoakeland server already running on this machine over a Unix socket — no
            token needed, the OS already restricts this to your user account. Only if nothing answers
            there do we launch one for you, as its own standalone process — closing this app won't
            stop it. Which project(s) to work on is picked afterward, from the sidebar.
          </p>
          <label>
            Socket path
            <input bind:value={socketPath} placeholder={FALLBACK_SOCKET_PATH} />
          </label>
          <details>
            <summary>Fallback launch settings</summary>
            <label>
              yoakeland binary
              <div class="row">
                <input bind:value={binPath} placeholder="yoakeland" />
                <button type="button" onclick={pickBinary}>Browse</button>
              </div>
            </label>
          </details>
          <button class="primary" type="submit" disabled={app.connectionStatus === "connecting"}>
            {app.connectionStatus === "connecting" ? "Connecting…" : "Connect"}
          </button>
        </form>
      </Tabs.Content>
      <Tabs.Content value="remote">
        <form onsubmit={submitRemote}>
          <p class="hint">
            Always TLS — trust the server's own CA below (its `ca.pem`), or leave it blank to
            trust the OS's certificate store instead, for a server given a real certificate.
          </p>
          <div class="row">
            <label class="grow">
              Host
              <input bind:value={host} placeholder="localhost" />
            </label>
            <label>
              Port
              <input type="number" bind:value={port} placeholder="7890" />
            </label>
          </div>
          <label>
            Auth token
            <input bind:value={token} placeholder="shared secret from -token" type="password" />
          </label>
          <label>
            Server CA certificate (optional)
            <div class="row">
              <textarea
                class="ca-input"
                bind:value={caPem}
                rows="3"
                placeholder="Paste ca.pem contents, or import the file…"
              ></textarea>
              <button class="ca-import" type="button" onclick={importCa} disabled={importingCa}>
                {importingCa ? "Importing…" : "Import…"}
              </button>
            </div>
          </label>
          {#if caImportError}
            <p class="error"><Icon name="alert-circle" size={14} /> {caImportError}</p>
          {/if}
          <button class="primary" type="submit" disabled={app.connectionStatus === "connecting"}>
            {app.connectionStatus === "connecting" ? "Connecting…" : "Connect"}
          </button>
        </form>
      </Tabs.Content>
    </Tabs.Root>

    {#if app.connectionStatus === "error" && app.connectionError}
      <p class="error"><Icon name="alert-circle" size={14} /> {app.connectionError}</p>
    {/if}

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
  :global(.connect-tabs) {
    display: flex;
    gap: var(--space-half);
    background: rgba(255, 255, 255, 0.04);
    padding: var(--space-half);
    border-radius: var(--radius-sm);
    margin-bottom: 1.29rem;
  }
  :global(.connect-tab-trigger) {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.43rem;
    padding: var(--space-1);
    border: none;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-body-size);
  }
  :global(.connect-tab-trigger[data-state="active"]) {
    background: var(--sidebar-active);
    color: var(--text);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
  }
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .row {
    display: flex;
    gap: var(--space-1);
  }
  details {
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    padding: 0.57rem 0.71rem;
  }
  details[open] {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
  }
  summary {
    cursor: pointer;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  details[open] summary {
    margin-bottom: 0.14rem;
  }
  .grow {
    flex: 1;
  }
  input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.57rem 0.71rem;
    font-size: var(--text-body-size);
    width: 100%;
  }
  input:focus {
    outline: 1px solid var(--accent);
  }
  .ca-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.57rem 0.71rem;
    font-size: var(--text-label-size);
    font-family: var(--code-font-family);
    width: 100%;
    resize: vertical;
  }
  .ca-input:focus {
    outline: 1px solid var(--accent);
  }
  .ca-import {
    align-self: flex-start;
    flex-shrink: 0;
  }
  button {
    cursor: pointer;
  }
  .row button {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0 0.86rem;
    white-space: nowrap;
  }
  .primary {
    margin-top: 0.43rem;
    background: var(--accent);
    color: #0d1020;
    font-weight: 600;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.71rem;
    font-size: 0.9rem;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0.86rem 0 0;
    padding: 0.57rem 0.71rem;
    background: var(--danger-dim);
    border-radius: var(--radius-sm);
    color: var(--danger);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .error :global(.icon) {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
</style>

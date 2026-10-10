<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // connectTcp/connectLocalUnix (ipc.ts) are additive: calling this a second
  // time adds another entry to app.servers, so no "first server" branching needed here.
  import { isDesktop, pickFiles } from "../platform";
  import { tick, untrack } from "svelte";
  import { Tabs } from "bits-ui";
  import {
    connectLocalUnix,
    connectTcp,
    installServer,
    caServerKey,
    importCaCertFile,
    FALLBACK_SOCKET_PATH,
    getDefaultSocketPath,
  } from "../ipc";
  import { decodePairingCode, HOSTED_APP_URL, parseScanned } from "../pairing";
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import QrScanner from "./QrScanner.svelte";
  import Button from "./ui/Button.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import TextField from "./ui/TextField.svelte";

  // showLocal off (Settings > Servers): the local server auto-connects at
  // startup, so adding one later is always a remote.
  let {
    onconnected,
    prefill,
    showLocal: showLocalProp = true,
  }: { onconnected?: () => void; prefill?: { host?: string; port?: number }; showLocal?: boolean } = $props();
  // In a browser, the page was most likely served by the server to connect to.
  const showLocal = $derived(isDesktop && showLocalProp);
  const pagePrefill =
    !isDesktop && location.protocol === "https:"
      ? { host: location.hostname, port: Number(location.port) || 443 }
      : undefined;

  let tab = $state<"local" | "remote">(untrack(() => (showLocal && !prefill?.host ? "local" : "remote")));

  // §2a: Unix domain socket, no token, OS already restricts who can connect.
  let binPath = $state("yoakeland");
  let socketPath = $state(FALLBACK_SOCKET_PATH);
  getDefaultSocketPath().then((p) => (socketPath = p));

  // Keyboard-first steps rather than one long form: address, then pairing
  // code, with manual token/CA entry as its own step (not an inline dropdown,
  // which would still need several Tabs to reach the revealed fields).
  let host = $state(untrack(() => prefill?.host ?? pagePrefill?.host ?? ""));
  let port = $state(untrack(() => prefill?.port ?? pagePrefill?.port ?? 7890));
  let token = $state("");
  // An address that is already known (this page's own server, or one being re-paired) skips its step.
  let step = $state<"address" | "code" | "manual" | "scan">(untrack(() => (prefill?.host ?? pagePrefill?.host ? "code" : "address")));
  let hostInputEl = $state<HTMLInputElement | null>(null);
  let codeInputEl = $state<HTMLInputElement | null>(null);
  let manualTokenEl = $state<HTMLInputElement | null>(null);

  function goToCode() {
    step = "code";
    void tick().then(() => codeInputEl?.focus());
  }
  function goToAddress() {
    step = "address";
    void tick().then(() => hostInputEl?.focus());
  }
  // The desktop shows the QR code (Pair a phone); scanning one is for the phone's browser.
  const canScan = !isDesktop && !!navigator.mediaDevices?.getUserMedia;
  // The hosted app can only reach a server by its WebRTC fingerprint, so a code without one is an old server.
  const TOO_OLD = "This server is too old for a phone to connect to: it sends no WebRTC fingerprint. Update the server and pair again.";
  const needsFingerprint = (fp?: string) => !fp && !isDesktop && location.origin === new URL(HOSTED_APP_URL).origin;
  let scanError = $state<string | null>(null);
  function onScan(text: string) {
    const scanned = parseScanned(text);
    if (!scanned) return fail("That QR code isn't from a yoakeland server.");
    if (needsFingerprint(scanned.rtcFp)) return fail(TOO_OLD);
    token = scanned.token;
    if (scanned.caPem) caPem = scanned.caPem;
    rtcFp = scanned.rtcFp ?? "";
    if (!scanned.host || !scanned.port) return goToAddress();
    host = scanned.host;
    port = scanned.port;
    step = "code";
    void attempt(() => connectTcp(host, port, token, caPem, rtcFp || undefined));
  }
  function fail(message: string) {
    scanError = message;
    step = host.trim() ? "code" : "address";
  }
  function goToManual() {
    step = "manual";
    void tick().then(() => manualTokenEl?.focus());
  }

  function onHostKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (host.trim()) goToCode();
    }
  }
  function onPortKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (host.trim()) goToCode();
    }
  }
  function onCodeKeydown(e: KeyboardEvent) {
    if (e.key === "Backspace" && !pairingCode) {
      e.preventDefault();
      goToAddress();
    }
  }
  function onManualTokenKeydown(e: KeyboardEvent) {
    if (e.key === "Backspace" && !token) {
      e.preventDefault();
      goToCode();
    }
  }

  /** Paste-only (not every keystroke), so typing a literal ':' in a hostname
   * or a raw IPv6 address never gets second-guessed. */
  function splitHostPort(text: string): { host: string; port: number } | null {
    const t = text.trim();
    const m = t.match(/^\[(.+)\]:(\d{1,5})$/) ?? t.match(/^([^:\s]+):(\d{1,5})$/);
    if (!m) return null;
    const port = Number(m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: m[1], port };
  }
  function onHostPortPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text");
    const parsed = text && splitHostPort(text);
    if (!parsed) return;
    e.preventDefault();
    host = parsed.host;
    port = parsed.port;
    goToCode();
  }

  // A pairing code bundles a token with its CA cert, or in a code made for the hosted web client
  // the server's address and DTLS fingerprint (WebRTC, rtc.ts); pasting one fills those fields in
  // one step. Purely a shortcut, no submit of its own.
  let pairingCode = $state("");
  let rtcFp = $state("");
  let pairingError = $state<string | null>(null);
  function applyPairingCode(value: string) {
    pairingCode = value;
    if (!value.trim()) {
      pairingError = null;
      return;
    }
    const decoded = decodePairingCode(value);
    if (!decoded) {
      pairingError = "Not a pairing code — use \"Enter manually instead\" below.";
      return;
    }
    if (needsFingerprint(decoded.rtcFp)) {
      pairingError = TOO_OLD;
      return;
    }
    pairingError = null;
    token = decoded.token;
    if (decoded.caPem) caPem = decoded.caPem;
    if (decoded.host && decoded.port) {
      host = decoded.host;
      port = decoded.port;
    }
    rtcFp = decoded.rtcFp ?? "";
  }

  // §2a: TLS is mandatory. Remembered per host:port so returning to a known
  // server doesn't ask again.
  let caPem = $state("");
  let importingCa = $state(false);
  let caImportError = $state<string | null>(null);
  $effect(() => {
    caPem = app.settings.trustedCaByHostPort[caServerKey(host, port)] ?? "";
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
    const [file] = await pickFiles({ title: "Locate yoakeland binary" });
    if (file) binPath = file;
  }

  // The global status says "connected" once any server is up, so a second server's progress
  // and failure are tracked here.
  let busy = $state(false);
  let submitError = $state<string | null>(null);
  async function attempt(connect: () => Promise<unknown>) {
    busy = true;
    submitError = null;
    try {
      await connect();
      onconnected?.();
    } catch (err) {
      submitError = String(err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }
  const noBinary = $derived(/failed to spawn/.test(submitError ?? ""));
  async function download() {
    await attempt(async () => {
      await installServer();
      binPath = "yoakeland";
      await connectLocalUnix({ binPath, socketPath });
    });
  }
  function submitLocal(e: Event) {
    e.preventDefault();
    return attempt(() => connectLocalUnix({ binPath, socketPath }));
  }
  function submitRemote(e: Event) {
    e.preventDefault();
    return attempt(() => connectTcp(host, port, token, caPem, rtcFp || undefined));
  }
</script>

{#snippet scanButton()}
  {#if canScan}
    <button type="button" class="menu-option" onclick={() => ((scanError = null), (step = "scan"))}>
      <span class="scan-label"><Icon name="scan" size={14} /> Scan a QR code</span>
      <Icon name="chevron-right" size={13} />
    </button>
  {/if}
{/snippet}

{#snippet remoteFormBody()}
  <form class="steps" onsubmit={submitRemote}>
    {#if step === "scan"}
      <p class="hint">Point the camera at the QR code in Pair a phone on your computer, or the one the server prints when it starts.</p>
      <QrScanner onscan={onScan} onerror={fail} />
      <Button type="button" variant="ghost" onclick={() => (step = host.trim() ? "code" : "address")}>Cancel</Button>
    {:else if step === "address"}
      <p class="hint">Where's the server? Paste "host:port" into either field to fill both at once.</p>
      <div class="row">
        <label class="grow">
          Host
          <TextField
            bind:el={hostInputEl}
            bind:value={host}
            onkeydown={onHostKeydown}
            onpaste={onHostPortPaste}
            placeholder="localhost"
          />
        </label>
        <label>
          Port
          <TextField
            type="number"
            bind:value={port}
            onkeydown={onPortKeydown}
            onpaste={onHostPortPaste}
            placeholder="7890"
          />
        </label>
      </div>
      <Button variant="primary" class="submit" disabled={!host.trim()} onclick={goToCode}>
        Next <Icon name="chevron-right" size={14} />
      </Button>
      {@render scanButton()}
    {:else if step === "code"}
      <p class="hint">
        Always TLS, against a CA only the server operator has — paste the pairing code they gave you
        (from their Settings › Access), it carries the token and CA in one piece.
      </p>
      <label>
        Pairing code
        <TextField
          bind:el={codeInputEl}
          value={pairingCode}
          onkeydown={onCodeKeydown}
          oninput={(e) => applyPairingCode((e.target as HTMLInputElement).value)}
          placeholder="Paste the code from Settings › Access"
        />
      </label>
      {#if pairingError}
        <p class="error"><Icon name="alert-circle" size={14} /> {pairingError}</p>
      {/if}
      {@render scanButton()}
      <button type="button" class="menu-option" onclick={goToManual}>
        <span>Enter manually instead</span>
        <Icon name="chevron-right" size={13} />
      </button>
      <div class="step-actions">
        <button type="button" class="back-step" onclick={goToAddress} {@attach tip("Back", "Backspace")}>
          <Icon name="chevron-left" size={13} />
        </button>
        <Button variant="primary" class="submit grow" type="submit" disabled={busy || !token}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
    {:else}
      <p class="hint">Only needed if you don't have a pairing code — a bare token, or one from an operator-supplied real certificate that has no CA to bundle.</p>
      <label>
        Auth token
        <TextField bind:el={manualTokenEl} bind:value={token} onkeydown={onManualTokenKeydown} placeholder="shared secret from -token" type="password" />
      </label>
      {#if isDesktop}
        <label>
          Server CA certificate
          <div class="row">
            <TextArea
              class="ca-input"
              bind:value={caPem}
              rows={3}
              placeholder="Paste ca.pem contents, or import the file… — leave blank only if the server has a real, publicly-trusted certificate"
            />
            <Button class="ca-import" onclick={importCa} disabled={importingCa}>
              {importingCa ? "Importing…" : "Import…"}
            </Button>
          </div>
        </label>
        {#if caImportError}
          <p class="error"><Icon name="alert-circle" size={14} /> {caImportError}</p>
        {/if}
      {:else}
        <p class="hint">Your browser checks the server's certificate itself. Trust the server's CA in your browser or OS once, or give the server a real certificate.</p>
      {/if}
      <div class="step-actions">
        <button type="button" class="back-step" onclick={goToCode} {@attach tip("Back", "Backspace")}>
          <Icon name="chevron-left" size={13} />
        </button>
        <Button variant="primary" class="submit grow" type="submit" disabled={busy || !token}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
    {/if}
  </form>
{/snippet}

{#if showLocal}
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
          Connects to a yoakeland server already running on this machine over a local socket (a named pipe on Windows) — no
          token needed, the OS already restricts this to your user account. Only if nothing answers
          there do we launch one for you, as its own standalone process — closing this app won't
          stop it. Which project(s) to work on is picked afterward, from the sidebar.
        </p>
        <label>
          Socket path
          <TextField bind:value={socketPath} placeholder={FALLBACK_SOCKET_PATH} />
        </label>
        <details>
          <summary>Fallback launch settings</summary>
          <label>
            yoakeland binary
            <div class="row">
              <TextField bind:value={binPath} placeholder="yoakeland" />
              <Button onclick={pickBinary}>Browse</Button>
            </div>
          </label>
        </details>
        <Button variant="primary" class="submit" type="submit" disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </Tabs.Content>
    <Tabs.Content value="remote">
      {@render remoteFormBody()}
    </Tabs.Content>
  </Tabs.Root>
{:else}
  {@render remoteFormBody()}
{/if}

{#if scanError}
  <p class="error"><Icon name="alert-circle" size={14} /> {scanError}</p>
{/if}
{#if submitError}
  <p class="error"><Icon name="alert-circle" size={14} /> {submitError}</p>
  {#if noBinary && isDesktop}<Button onclick={download} disabled={busy}>Download server</Button>{/if}
{/if}

<style>
  :global(.connect-tabs) {
    display: flex;
    gap: var(--space-half);
    background: rgba(255, 255, 255, 0.04);
    padding: var(--space-half);
    border-radius: var(--radius-lg);
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
  :global(.grow) {
    flex: 1;
  }
  .menu-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.43rem;
    padding: 0.5rem 0.64rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    text-align: left;
  }
  .menu-option:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .scan-label {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
  }
  .step-actions {
    display: flex;
    gap: var(--space-1);
  }
  .back-step {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.71rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .back-step:hover {
    color: var(--text);
  }
  /* First-run form: roomier than a settings row, so the controls here are taller. */
  .steps {
    --ctrl-h: 2.64rem;
  }
  :global(.submit) {
    margin-top: 0.43rem;
    font-size: 0.9rem;
  }
  :global(.ui-field.ca-input textarea) {
    font-family: var(--code-font-family);
    font-size: var(--text-label-size);
  }
  :global(.ca-import) {
    align-self: flex-start;
  }
  button {
    cursor: pointer;
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

  @media (max-width: 700px) {
    .row > label {
      min-width: 0;
    }
    .row > label:not(.grow) {
      flex: 0 0 6rem;
    }
  }
</style>

<script lang="ts">
  // Pair a phone: the QR code opens the hosted web client with a fresh per-device token, the
  // server's address and its WebRTC fingerprint in the URL fragment (pairing.ts), and the page
  // connects straight to this server (ipc.ts, rtc.ts); nothing to install. A server too old to
  // send a fingerprint falls back to its own page, which needs the phone to trust its CA first.
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { registerToken, setRemoteAccess } from "../ipc";
  import { pairInfo } from "../platform";
  import { pairingUrl } from "../pairing";
  import Button from "./ui/Button.svelte";
  import TextField from "./ui/TextField.svelte";
  import Icon from "./Icon.svelte";
  import QrCode from "./QrCode.svelte";

  let { open = $bindable(false), cid }: { open?: boolean; cid: string } = $props();

  const server = $derived(app.servers[cid]);
  // ":7890", "0.0.0.0:7890", "[::]:7890" or "" (the server's default).
  const port = $derived(Number((server?.remoteAddr ?? "").split(":").pop()) || 7890);

  let hosts = $state<string[]>([]);
  let host = $state("");
  let name = $state("");
  let phase = $state<"form" | "waiting" | "trust" | "scan">("form");
  let token = $state("");
  let hasCa = $state(false);
  let rtcFp = $state("");
  let error = $state("");
  let blocked = $state(false); // nothing a retry here would fix
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (!open) return;
    phase = "form";
    token = "";
    error = "";
    blocked = false;
    const mine = app.settings.profileName;
    name = mine ? `${mine}'s phone` : "Phone";
    pairInfo().then(
      (info) => {
        hosts = info.hosts;
        host = info.hosts[0] ?? "";
        blocked = !info.hosts.length;
        if (!info.hosts.length) error = "No network address found. Connect this computer to the same network as the phone.";
        // Points the server's own page at the built client (the fallback for a server with no
        // fingerprint); the listener keeps running.
        else if (info.webRoot) setRemoteAccess(cid, true, { webRoot: info.webRoot });
        else setRemoteAccess(cid, true);
      },
      (e) => ((error = String(e)), (blocked = true)),
    );
    return () => clearTimeout(timer);
  });

  // The server answers register_token with the token exactly once; take it so People doesn't also show it.
  $effect(() => {
    const t = server?.justRegisteredToken;
    if (phase !== "waiting" || !t || t.name !== name.trim()) return;
    clearTimeout(timer);
    token = t.token;
    rtcFp = t.rtcFp ?? "";
    // The hosted page pins the fingerprint instead of a CA, so only the fallback needs trusting.
    hasCa = !!t.caPem && !rtcFp;
    server.justRegisteredToken = null;
    seen = new Set(server.peers.map((p) => p.peerId));
    phase = hasCa ? "trust" : "scan";
  });

  // The phone's own name and picture arrive with its first peer_list; showing them confirms the
  // right device paired and that it kept its identity.
  let seen = new Set<string>();
  const joined = $derived(phase === "scan" ? server?.peers.find((p) => !seen.has(p.peerId) && p.deviceType === "web") : undefined);

  function create(e: Event) {
    e.preventDefault();
    const taken = new Set(server?.tokens.map((t) => t.name));
    let n = name.trim();
    for (let i = 2; taken.has(n); i++) n = `${name.trim()} ${i}`;
    name = n;
    phase = "waiting";
    registerToken(cid, n);
    timer = setTimeout(() => {
      phase = "form";
      error = "The server didn't answer. Is remote access on?";
    }, 6000);
  }

  const caUrl = $derived(`https://${host}:${port}/ca.crt`);
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content pair">
      <Dialog.Close class="dialog-close pair-close"><Icon name="xmark" size={14} /></Dialog.Close>
      <Dialog.Title class="pair-title"><span class="pair-badge"><Icon name="qrcode" size={16} /></span> Pair a phone</Dialog.Title>

      {#if phase === "form" || phase === "waiting"}
        <Dialog.Description class="pair-hint">
          The phone opens yoakeland in its browser and connects to this server directly. It gets its own token, named below, so revoke it from People if the phone is lost.
        </Dialog.Description>
        {#if error}<p class="pair-error">{error}</p>{/if}
        <form class="pair-form" onsubmit={create}>
          <label>Name <TextField bind:value={name} placeholder="Phone" /></label>
          {#if hosts.length > 1}
            <label>
              Address
              <select bind:value={host}>
                {#each hosts as h (h)}<option value={h}>{h}</option>{/each}
              </select>
            </label>
          {/if}
          <Button type="submit" variant="primary" loading={phase === "waiting"} disabled={blocked || !name.trim() || !host}>
            Show QR code
          </Button>
        </form>
      {:else if phase === "trust"}
        <Dialog.Description class="pair-hint">
          <strong>1. Trust this server.</strong> It signs its own certificate, so the phone needs it once. Scan, tap through the warning (this is only the public certificate) and install it.
        </Dialog.Description>
        <div class="qr"><QrCode text={caUrl} label="Certificate download link" /></div>
        <details>
          <summary>How to install it</summary>
          <p><strong>Android:</strong> Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate.</p>
          <p><strong>iPhone:</strong> allow the download in Safari, install the profile in Settings, then turn it on under Settings → General → About → Certificate Trust Settings.</p>
        </details>
        <div class="pair-actions">
          <Button type="button" variant="ghost" onclick={() => (phase = "scan")}>Already trusted</Button>
          <Button type="button" variant="primary" onclick={() => (phase = "scan")}>Installed, next</Button>
        </div>
      {:else}
        <Dialog.Description class="pair-hint">
          {#if hasCa}<strong>2. Sign in.</strong>{/if} Scan with the phone's camera. It opens yoakeland and connects as <strong>{name}</strong>. This code is shown once and works for anyone who scans it, so close this when you're done.
        </Dialog.Description>
        <div class="qr"><QrCode text={pairingUrl(host, port, token, rtcFp || undefined)} label="Pairing code" /></div>
        {#if joined}
          <p class="pair-joined">
            {#if joined.avatar}<img src={joined.avatar} alt="" />{:else}<Icon name="check" size={13} />{/if}
            <strong>{joined.name}</strong> connected
          </p>
        {:else}
          <p class="pair-url"><Icon name="device-mobile" size={13} /> {host}:{port}</p>
        {/if}
        <div class="pair-actions">
          <Button type="button" variant="primary" onclick={() => (open = false)}>Done</Button>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-content.pair) {
    width: min(23rem, 92vw);
    padding: var(--space-3, 1.5rem) var(--space-2);
    gap: 0.7rem;
    overflow-y: auto;
  }
  :global(.pair-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
  }
  :global(.pair-title) {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  :global(.pair-hint) {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.5;
  }
  .pair-error {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger, #e5484d);
  }
  .pair-form {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .pair-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  select {
    height: var(--ctrl-h, 2rem);
    background: var(--panel-bg);
    color: var(--text);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    padding: 0 0.5rem;
  }
  /* Scanners need dark on light with a quiet zone, whatever the theme. */
  :global(.pair-badge) {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--accent-dim);
    color: var(--accent);
  }
  .qr {
    align-self: center;
    width: min(16rem, 100%);
    padding: 0.4rem;
    background: #fff;
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--panel-border);
    line-height: 0;
  }
  .pair-url {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin: 0;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .pair-joined {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--accent);
  }
  .pair-joined img {
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    object-fit: cover;
  }
  details {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.5;
  }
  details p {
    margin: 0.35rem 0 0;
  }
  .pair-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>

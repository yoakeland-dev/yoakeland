<script lang="ts">
  // Pair a phone: the QR code opens the hosted web client with a fresh per-device token, the
  // server's address and its WebRTC fingerprint in the URL fragment (pairing.ts), and the page
  // connects straight to this server (ipc.ts, rtc.ts); nothing to install. A server too old to
  // send a fingerprint can't do that, so it is told to update instead.
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { answerPairing, registerToken, removeToken, setRemoteAccess } from "../ipc";
  import { pairInfo } from "../platform";
  import { pairingUrl } from "../pairing";
  import { isPhotoAvatar } from "../avatar";
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
  let phase = $state<"form" | "waiting" | "old" | "scan">("form");
  let token = $state("");
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
        if (!info.hosts.length) error = "No network address found. Put this computer on the same network as the phone.";
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
    server.justRegisteredToken = null;
    if (rtcFp) phase = "scan";
    else {
      // No fingerprint: this server predates WebRTC pairing. Don't leave the token behind.
      removeToken(cid, name.trim());
      phase = "old";
    }
  });

  // The phone connects under the token just made, so match on that: its own name and picture then
  // confirm the right device paired and kept its identity.
  const request = $derived(phase === "scan" ? server?.pairingRequests.find((r) => r.credential === name) : undefined);
  const joined = $derived(phase === "scan" ? server?.peers.find((p) => p.credential === name) : undefined);

  function create(e: Event) {
    e.preventDefault();
    const taken = new Set(server?.tokens.map((t) => t.name));
    let n = name.trim();
    for (let i = 2; taken.has(n); i++) n = `${name.trim()} ${i}`;
    name = n;
    phase = "waiting";
    registerToken(cid, n, undefined, true);
    timer = setTimeout(() => {
      phase = "form";
      error = "No answer from the server. Is remote access on?";
    }, 6000);
  }

</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content pair">
      <Dialog.Close class="dialog-close pair-close"><Icon name="xmark" size={14} /></Dialog.Close>
      <Dialog.Title class="pair-title"><span class="pair-badge"><Icon name="qrcode" size={16} /></span> Pair a phone</Dialog.Title>

      {#if phase === "form" || phase === "waiting"}
        <Dialog.Description class="pair-hint">
          The phone opens yoakeland in its browser and connects to this server directly. It gets its own token, named below. Revoke it under People if the phone is lost.
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
      {:else if phase === "old"}
        <Dialog.Description class="pair-hint">
          This server is too old to pair a phone. It doesn't report the fingerprint a phone needs to connect safely. Update it in Settings → General, then try again.
        </Dialog.Description>
        <div class="pair-actions">
          <Button type="button" variant="primary" onclick={() => (open = false)}>Close</Button>
        </div>
      {:else}
        <Dialog.Description class="pair-hint">
          Scan with the phone's camera. It opens yoakeland and connects as <strong>{name}</strong>. Only the first phone to scan it can use it, and it expires in 10 minutes. You'll be asked to allow it here.
        </Dialog.Description>
        <div class="qr"><QrCode text={pairingUrl([host, ...hosts.filter((h) => h !== host)], port, token, rtcFp || undefined)} label="Pairing code" /></div>
        {#if request}
          <div class="pair-request">
            <p><strong>{request.name || "A device"}</strong> scanned this{request.ip ? ` from ${request.ip}` : ""}. Let it in?</p>
            <div class="pair-actions">
              <Button type="button" variant="ghost" onclick={() => answerPairing(cid, request.credential, false)}>Decline</Button>
              <Button type="button" variant="primary" onclick={() => answerPairing(cid, request.credential, true)}>Allow</Button>
            </div>
          </div>
        {:else if joined}
          <p class="pair-joined">
            {#if isPhotoAvatar(joined.avatar ?? "")}<img src={joined.avatar} alt="" />{:else}<Icon name="check" size={13} />{/if}
            <strong>{joined.name}</strong> connected
          </p>
        {:else}
          <p class="pair-url"><Icon name="device-mobile" size={13} /> {[host, ...hosts.filter((h) => h !== host)].join(" · ")}:{port}</p>
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
  .pair-request {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: var(--text-label-size);
  }
  .pair-request p {
    margin: 0;
    text-align: center;
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
  .pair-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>

<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  // Pair a phone: the QR code opens the hosted web client with a fresh per-device token, the
  // server's address and its WebRTC fingerprint in the URL fragment (pairing.ts), and the page
  // connects straight to this server (ipc.ts, rtc.ts); nothing to install. A server too old to
  // send a fingerprint can't do that, so it is told to update instead.
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { answerPairing, getPairInfo, registerToken, removeToken, setRemoteAccess } from "../ipc";
  import { connectedHost, isDesktop, pairInfo } from "../platform";
  import { pairingUrl } from "../pairing";
  import { isPhotoAvatar } from "../avatar";
  import Button from "./ui/Button.svelte";
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
    phase = "waiting";
    copied = false;
    full = false;
    token = "";
    error = "";
    blocked = false;
    const mine = app.settings.profileName;
    name = mine ? `${mine}'s device` : "Device";
    // In a browser the server names its own addresses (the address this page connected to first); it
    // is already reachable, and only the desktop may change remote access.
    const seen = connectedHost(cid);
    const info = isDesktop
      ? pairInfo()
      : getPairInfo(cid).then((r) => ({ webRoot: "", hosts: [...new Set([...(seen && /^[\d.]+$|:/.test(seen) && !/^127\.|^0\.0\.0\.0$|^\[?::1?\]?$/.test(seen) ? [seen] : []), ...r.hosts])] }));
    info.then(
      (info) => {
        hosts = info.hosts;
        host = info.hosts[0] ?? "";
        blocked = !info.hosts.length;
        if (!info.hosts.length) {
          error = "No network address found. Put the server on the same network as the device.";
          phase = "form";
          return;
        }
        // Points the server's own page at the built client (the fallback for a server with no
        // fingerprint); the listener keeps running.
        if (isDesktop) {
          if (info.webRoot) setRemoteAccess(cid, true, { webRoot: info.webRoot });
          else setRemoteAccess(cid, true);
        }
        create();
      },
      (e) => ((error = String(e)), (blocked = true), (phase = "form")),
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
  const link = $derived(pairingUrl([host, ...hosts.filter((h) => h !== host)], port, token, rtcFp || undefined));
  let copied = $state(false);
  let full = $state(false);
  const joined = $derived(phase === "scan" ? server?.peers.find((p) => p.credential === name) : undefined);

  function create() {
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
    <SheetDialog class="dialog-content pair">
      <Dialog.Close class="dialog-close pair-close"><Icon name="xmark" size={14} /></Dialog.Close>
      <div class="pair-split" class:single={phase === "old"}>
        {#if phase !== "old"}
          <div class="pair-side">
            <div class="stage">
              <!-- Until the token exists the code is a blurred stand-in; it sharpens once the real one is ready. -->
              <div class="qr" class:dim={phase !== "scan" || !!joined}>
                <QrCode text={phase === "scan" ? link : "yoake"} label={phase === "scan" ? "Pairing code" : ""} />
              </div>
              <div class="over" class:off={phase === "scan" && !joined}>
                {#if joined}
                  <Icon name="check" size={34} />Connected
                {:else}
                  {#if phase === "waiting"}<span class="spin"></span>{/if}
                  {phase === "waiting" ? "Preparing your code" : "No code yet"}
                {/if}
              </div>
            </div>
            <p class="cap">{joined ? "Paired" : request ? "Scanned. Waiting for you" : phase === "scan" ? "Waiting for a scan" : "Pairing code"}</p>
          </div>
        {/if}
        <div class="pair-main">
          <Dialog.Title class="pair-title"><span class="pair-badge"><Icon name="device-mobile" size={16} /></span> Pair a device</Dialog.Title>

          {#if phase === "form" || phase === "waiting"}
            <Dialog.Description class="pair-hint">
              A phone or another computer opens yoakeland in its browser and connects to this server directly. Each device gets its own token. Revoke it under People if the device is lost.
            </Dialog.Description>
            {#if error}<p class="pair-error">{error}</p>{/if}
            {#if phase === "form"}
              <div class="pair-foot">
                <Button type="button" variant="ghost" onclick={() => (open = false)}>Close</Button>
                {#if !blocked}<Button type="button" variant="primary" onclick={create}>Try again</Button>{/if}
              </div>
            {/if}
          {:else if phase === "old"}
            <Dialog.Description class="pair-hint">
              This server is too old to pair a device. It doesn't report the fingerprint a device needs to connect safely. Update it in Settings → General, then try again.
            </Dialog.Description>
            <div class="pair-foot">
              <Button type="button" variant="primary" onclick={() => (open = false)}>Close</Button>
            </div>
          {:else}
            <Dialog.Description class="pair-hint">
              It connects as <strong>{name}</strong>. The link works for the first device that opens it and expires in 10 minutes.
            </Dialog.Description>
            <ol class="pair-steps">
              <li class:cur={!request && !joined} class:done={request || joined}><b>1</b> Scan the code with a phone's camera, or copy the link for a desktop browser.</li>
              <li class:cur={!!request && !joined} class:done={!!joined}><b>2</b> Allow the device here when it asks.</li>
              <li class:done={!!joined}><b>3</b> That's it.</li>
            </ol>
            {#if request}
              <div class="pair-request">
                <p><strong>{request.name || "A device"}</strong> scanned this{request.ip ? ` from ${request.ip}` : ""}. Let it in?</p>
                <label class="pair-full"><input type="checkbox" bind:checked={full} /> Give it full access</label>
                <div class="pair-actions">
                  <Button type="button" variant="ghost" onclick={() => answerPairing(cid, request.credential, false)}>Decline</Button>
                  <Button type="button" variant="primary" onclick={() => answerPairing(cid, request.credential, true, full)}>Allow</Button>
                </div>
              </div>
            {:else if joined}
              <p class="pair-joined">
                {#if isPhotoAvatar(joined.avatar ?? "")}<img src={joined.avatar} alt="" />{:else}<Icon name="check" size={13} />{/if}
                <span><strong>{joined.name}</strong> connected</span>
              </p>
            {/if}
            <div class="pair-foot">
              {#if hosts.length > 1}
                <select class="pair-host" bind:value={host} aria-label="Address">
                  {#each hosts as h (h)}<option value={h}>{h}:{port}</option>{/each}
                </select>
              {:else}
                <span class="pair-url"><Icon name="device-mobile" size={13} /> {host}:{port}</span>
              {/if}
              {#if !joined}
                <Button type="button" variant="ghost" onclick={() => { void navigator.clipboard?.writeText(link); copied = true; }}>
                  <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy link"}
                </Button>
              {/if}
              <Button type="button" variant="primary" onclick={() => (open = false)}>Done</Button>
            </div>
          {/if}
        </div>
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-content.pair) {
    width: min(23rem, 92vw);
    padding: 0;
    overflow-y: auto;
  }
  :global(.pair-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
    z-index: 2;
  }
  .pair-split {
    display: flex;
    flex-direction: column;
  }
  .pair-side {
    padding: var(--space-2) var(--space-2) 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .stage {
    position: relative;
    width: min(15rem, 100%);
  }
  /* Scanners need dark on light with a quiet zone, whatever the theme. */
  .qr {
    padding: 0.4rem;
    background: #fff;
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--panel-border);
    line-height: 0;
    transition: filter 0.6s ease;
  }
  .qr.dim {
    filter: blur(5px) brightness(0.4);
  }
  .over {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    color: #e7e8ee;
    font-size: var(--text-body-size);
    font-weight: 500;
    text-align: center;
    pointer-events: none;
    transition: opacity 0.4s ease;
  }
  .over.off {
    opacity: 0;
  }
  .over :global(svg) {
    color: var(--success);
  }
  .spin {
    width: 1.6rem;
    height: 1.6rem;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: pair-spin 0.9s linear infinite;
  }
  @keyframes pair-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .cap {
    margin: 0.7rem 0 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .pair-main {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-width: 0;
    padding: var(--space-2);
  }
  @media (min-width: 640px) {
    :global(.dialog-content.pair) {
      width: min(44rem, 92vw);
    }
    .pair-split {
      display: grid;
      grid-template-columns: 19rem minmax(0, 1fr);
      min-height: 25rem;
    }
    .pair-split.single {
      display: flex;
      min-height: 0;
    }
    .pair-side {
      justify-content: center;
      padding: var(--space-3);
      border-right: 1px solid var(--panel-border);
    }
    .stage {
      width: 100%;
    }
    .pair-main {
      padding: var(--space-3);
    }
  }
  :global(.pair-title) {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  :global(.pair-badge) {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--accent-dim);
    color: var(--accent);
  }
  :global(.pair-hint) {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.5;
  }
  :global(.pair-hint) strong {
    color: var(--text);
  }
  .pair-error {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger, #e5484d);
  }
  select {
    height: var(--ctrl-h, 2rem);
    background: var(--panel-bg);
    color: var(--text);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    padding: 0 0.5rem;
  }
  .pair-host {
    margin-right: auto;
    min-width: 0;
  }
  .pair-steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .pair-steps li {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
  }
  .pair-steps b {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    background: var(--wash-3);
    font-size: 0.79rem;
    font-weight: 600;
  }
  .pair-steps li.cur {
    color: var(--text);
  }
  .pair-steps li.cur b {
    background: var(--accent);
    color: var(--bg);
  }
  .pair-steps li.done b {
    background: color-mix(in srgb, var(--success) 25%, transparent);
    color: var(--success);
  }
  .pair-request {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.8rem;
    font-size: var(--text-label-size);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-radius: var(--radius-lg);
  }
  .pair-request p {
    margin: 0;
  }
  .pair-full {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-dim);
  }
  .pair-joined {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0.8rem;
    font-size: var(--text-label-size);
    border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
    background: color-mix(in srgb, var(--success) 8%, transparent);
    border-radius: var(--radius-lg);
    color: var(--success);
  }
  .pair-joined span {
    color: var(--text);
  }
  .pair-joined img {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .pair-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .pair-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: auto;
    padding-top: 0.9rem;
    border-top: 1px solid var(--panel-border);
  }
  .pair-url {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-right: auto;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>

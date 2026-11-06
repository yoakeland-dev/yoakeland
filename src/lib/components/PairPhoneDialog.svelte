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
  import { avatarSrc } from "../avatarCache.svelte";
  import { askConfirm } from "../confirm.svelte";
  import type { Tier } from "../types";
  import Segmented from "./ui/Segmented.svelte";
  import TextField from "./ui/TextField.svelte";
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
  let phase = $state<"who" | "form" | "waiting" | "old" | "scan">("form");
  // Who the device is for. A server without people has no such choice.
  let forWhom = $state<"me" | "other">("me");
  let otherName = $state("");
  let existing = $state(""); // an existing person's id: the computer running the server only
  let otherTier = $state<Tier>("limited");
  const canMe = $derived(!!server?.isFull);
  const canExisting = $derived(server?.connectionMode === "local");
  const others = $derived((server?.people?.users ?? []).filter((u) => u.id !== server?.user?.id));
  const tierOptions = $derived([
    { value: "limited", label: "Limited" },
    ...(server?.isFull ? [{ value: "trusted", label: "Trusted" }, { value: "full", label: "Full" }] : []),
  ]);
  const whoReady = $derived(forWhom === "me" || !!existing || !!otherName.trim());
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
    forWhom = server?.isFull ? "me" : "other";
    otherName = "";
    existing = "";
    otherTier = "limited";
    const mine = server?.me.name;
    name = mine ? `${mine}'s device` : "Device";
    // In a browser the server names its own addresses (the address this page connected to first); it
    // is already reachable, and only the desktop may change remote access.
    const seen = connectedHost(cid);
    // The component preview (dev only; stripped from a build) has no server to ask.
    const demo = import.meta.env.DEV ? (globalThis as { __pairDemo?: { hosts: string[] } }).__pairDemo : undefined;
    const info = demo
      ? Promise.resolve({ webRoot: "", hosts: demo.hosts })
      : isDesktop
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
        if (server?.user) phase = "who";
        else create();
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
  const addresses = $derived([host, ...hosts.filter((h) => h !== host)]);
  // The QR code opens the hosted app, which connects straight to the server over WebRTC and needs no
  // certificate to be trusted. The link for a computer opens the server's own page instead, so the
  // client that loads is always this server's own version (the browser asks once about its certificate).
  const link = $derived(pairingUrl(addresses, port, token, rtcFp || undefined));
  const ownLink = $derived(pairingUrl(addresses, port, token));
  const summary = $derived(forWhomLabel());
  function forWhomLabel(): string {
    if (!server?.user || forWhom === "me") return "you";
    if (existing) return others.find((u) => u.id === existing)?.name || "someone";
    return `${otherName.trim() || "someone"} (${otherTier})`;
  }
  /** Back to the first step, discarding the code just made: it was for someone else. */
  function change() {
    if (token) removeToken(cid, name.trim());
    token = "";
    rtcFp = "";
    phase = "who";
  }
  let copied = $state(false);
  let full = $state(false);
  const joined = $derived(phase === "scan" ? server?.peers.find((p) => p.credential === name) : undefined);

  async function chooseWho() {
    if (forWhom === "other" && !existing && otherTier === "full" && !(await askConfirm("Full access can do anything you can on this computer. Give it?"))) return;
    if (forWhom === "other") {
      const who = existing ? others.find((u) => u.id === existing)?.name : otherName.trim();
      name = `${who}'s device`;
    }
    create();
  }

  function create() {
    const taken = new Set(server?.tokens.map((t) => t.name));
    let n = name.trim();
    for (let i = 2; taken.has(n); i++) n = `${name.trim()} ${i}`;
    name = n;
    phase = "waiting";
    registerToken(cid, n, undefined, true, !server?.user ? undefined
      : forWhom === "me" ? { user: "me" }
      : existing ? { user: existing }
      : { user: "new", newUserName: otherName.trim(), tier: otherTier });
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
      <div class="pair-main">
        <Dialog.Title class="pair-title"><span class="pair-badge"><Icon name="device-mobile" size={16} /></span> Add a device</Dialog.Title>

        {#if phase === "who"}
          <Dialog.Description class="pair-hint">Who will use it? A device that is yours shares your chats; someone else gets their own.</Dialog.Description>
          {#if canMe}
            <Segmented options={[{ value: "me", label: "Me" }, { value: "other", label: "Someone else" }]} bind:value={forWhom as string} label="Who is this device for?" />
          {/if}
          {#if forWhom === "other"}
            {#if canExisting && others.length}
              <label class="pair-field">
                Person
                <select class="pair-select" bind:value={existing}>
                  <option value="">Someone new</option>
                  {#each others as u (u.id)}<option value={u.id}>{u.name || "Unnamed"}</option>{/each}
                </select>
              </label>
            {/if}
            {#if !existing}
              <label class="pair-field">Name <TextField type="text" placeholder="Their name" bind:value={otherName} /></label>
              {#if tierOptions.length > 1}
                <div class="pair-field">
                  What they can do
                  <Segmented options={tierOptions} bind:value={otherTier as string} label="Access" />
                </div>
                <p class="pair-hint">
                  {#if otherTier === "full"}Anything you can do on this computer. Most people should have less.
                  {:else if otherTier === "trusted"}Work in projects and help run the server, without access to the machine.
                  {:else}Work in the projects already on this server.{/if}
                </p>
              {/if}
            {/if}
          {/if}
          <div class="pair-foot">
            <Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
            <Button type="button" variant="primary" disabled={!whoReady} onclick={chooseWho}>Create code</Button>
          </div>
        {:else if phase === "waiting"}
          <div class="pair-wait"><span class="spin"></span> Making a code…</div>
        {:else if phase === "form"}
          {#if error}<p class="pair-error">{error}</p>{/if}
          <div class="pair-foot">
            <Button type="button" variant="ghost" onclick={() => (open = false)}>Close</Button>
            {#if !blocked}<Button type="button" variant="primary" onclick={create}>Try again</Button>{/if}
          </div>
        {:else if phase === "old"}
          <Dialog.Description class="pair-hint">
            This server is too old to pair a device. It doesn't report the fingerprint a device needs to connect safely. Update it in Settings → General, then try again.
          </Dialog.Description>
          <div class="pair-foot">
            <Button type="button" variant="primary" onclick={() => (open = false)}>Close</Button>
          </div>
        {:else}
          {#if server?.user}
            <p class="pair-for">For <strong>{summary}</strong>{#if !joined}<button type="button" class="pair-change" onclick={change}>Change</button>{/if}</p>
          {/if}

          {#if joined}
            <p class="pair-joined">
              {#if isPhotoAvatar(joined.avatar ?? "")}<img src={avatarSrc(joined.avatar)} alt="" />{:else}<Icon name="check" size={13} />{/if}
              <span><strong>{joined.name}</strong> is connected.</span>
            </p>
          {:else if !request}
            <div class="pair-share">
              <div class="qr"><QrCode text={link} label="Pairing code" /></div>
              <p class="pair-hint center">Scan with a phone. Works once, for 10 minutes.</p>
            </div>
            <div class="pair-computer">
              <div class="pair-labelrow">
                <span class="pair-label">On a computer</span>
                {#if hosts.length > 1}
                  <select class="pair-select small" bind:value={host} aria-label="Address">
                    {#each hosts as h (h)}<option value={h}>{h}:{port}</option>{/each}
                  </select>
                {/if}
              </div>
              <div class="pair-linkrow">
                <input class="pair-link" readonly value={ownLink} aria-label="Link for a computer" onfocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="ghost" onclick={() => { void navigator.clipboard?.writeText(ownLink); copied = true; }}>
                  <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p class="pair-hint">Opens this server's own page. The browser asks once about its certificate.</p>
            </div>
          {/if}

          {#if request && !joined}
            <div class="pair-request">
              <p>
                <strong>{request.name || "A device"}</strong> is asking to join{request.ip ? ` from ${request.ip}` : ""}.
                {#if request.userName}It joins as <strong>{request.userName}</strong>{request.tier ? ` with ${request.tier} access` : ""}.{/if}
              </p>
              {#if server?.isFull && request.tier !== "full"}<label class="pair-full"><input type="checkbox" bind:checked={full} /> Give it full access</label>{/if}
              <div class="pair-actions">
                <Button type="button" variant="ghost" onclick={() => answerPairing(cid, request.credential, false)}>Decline</Button>
                <Button type="button" variant="primary" onclick={() => answerPairing(cid, request.credential, true, full)}>Allow</Button>
              </div>
            </div>
          {:else if !joined}
            <p class="pair-status"><span class="dot"></span> Waiting for the device. You'll be asked to allow it here.</p>
          {/if}
          <div class="pair-foot">
            <Button type="button" variant="primary" onclick={() => (open = false)}>{joined ? "Done" : "Close"}</Button>
          </div>
        {/if}
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-content.pair) {
    width: min(26rem, 94vw);
    padding: 0;
    overflow-y: auto;
  }
  :global(.pair-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
    z-index: 2;
  }
  .pair-main {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
    padding: var(--space-3);
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
  :global(.pair-hint),
  .pair-hint {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.5;
  }
  .pair-hint.center {
    text-align: center;
  }
  .pair-field {
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .pair-error {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger, #e5484d);
  }
  .pair-select {
    height: var(--ctrl-h, 2rem);
    background: var(--panel-bg);
    color: var(--text);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    padding: 0 0.5rem;
    min-width: 0;
  }
  .pair-wait {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: var(--space-3) 0;
    color: var(--text-dim);
    font-size: var(--text-body-size);
  }
  .spin {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--panel-border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: pair-spin 0.9s linear infinite;
  }
  @keyframes pair-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .pair-for {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-body-size);
    color: var(--text-dim);
  }
  .pair-for strong {
    color: var(--text);
  }
  .pair-change {
    margin-left: auto;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: var(--text-label-size);
    color: var(--accent);
    cursor: pointer;
  }
  .pair-share {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
  }
  /* Scanners need dark on light with a quiet zone, whatever the theme. */
  .qr {
    width: min(10.5rem, 100%);
    padding: 0.35rem;
    background: #fff;
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--panel-border);
    line-height: 0;
  }
  .pair-computer {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--panel-border);
  }
  .pair-labelrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .pair-select.small {
    height: 1.6rem;
    font-size: var(--text-label-size);
    max-width: 10rem;
  }
  .pair-label {
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text);
  }
  .pair-linkrow {
    display: flex;
    gap: 0.4rem;
    min-width: 0;
  }
  .pair-link {
    flex: 1;
    min-width: 0;
    height: var(--ctrl-h, 2rem);
    padding: 0 0.6rem;
    background: var(--panel-bg);
    color: var(--text-dim);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: var(--text-label-size);
    text-overflow: ellipsis;
  }
  .pair-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--accent);
    animation: pair-pulse 1.6s ease-in-out infinite;
  }
  @keyframes pair-pulse {
    50% {
      opacity: 0.3;
    }
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
  .pair-actions,
  .pair-foot {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
  }
</style>

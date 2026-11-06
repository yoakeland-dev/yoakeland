<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  // Pair a phone: the QR code opens the hosted web client with a fresh per-device token, the
  // server's address and its WebRTC fingerprint in the URL fragment (pairing.ts), and the page
  // connects straight to this server (ipc.ts, rtc.ts); nothing to install. A server too old to
  // send a fingerprint can't do that, so it is told to update instead.
  //
  // One card that morphs: who the device is for, the code, the request to allow it, and the
  // connected state all live in the same dialog. `view` says which one is showing.
  import { tick, untrack } from "svelte";
  import { Dialog } from "bits-ui";
  import { app } from "../state.svelte";
  import { answerPairing, getPairInfo, registerToken, removeToken, setRemoteAccess } from "../ipc";
  import { connectedHost, isDesktop, pairInfo } from "../platform";
  import { pairingUrl } from "../pairing";
  import { deviceTypeLabel } from "../format";
  import { isPhotoAvatar } from "../avatar";
  import { avatarSrc } from "../avatarCache.svelte";
  import { askConfirm } from "../confirm.svelte";
  import { viewport } from "../viewport.svelte";
  import { wallpaperGL } from "../wallpaperGL";
  import type { Tier } from "../types";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Spinner from "./ui/Spinner.svelte";
  import Switch from "./ui/Switch.svelte";
  import Icon from "./Icon.svelte";
  import QrCode from "./QrCode.svelte";

  let { open = $bindable(false), cid, onOpenPeople }: { open?: boolean; cid: string; onOpenPeople?: () => void } = $props();

  type View = "who" | "scan" | "ask" | "done" | "problem";
  type Req = { credential: string; name?: string; deviceType?: string; ip?: string; userName?: string; tier?: Tier };

  const TIER: Record<Tier, string> = { limited: "Limited", trusted: "Trusted", full: "Full" };
  const TONE: Record<Tier, "neutral" | "accent" | "warning"> = { limited: "neutral", trusted: "accent", full: "warning" };
  const OLD_SERVER = "This server is too old to pair a device. It doesn't report the fingerprint a device needs to connect safely. Update it in Settings → General, then try again.";

  const server = $derived(app.servers[cid]);
  // ":7890", "0.0.0.0:7890", "[::]:7890" or "" (the server's default).
  const port = $derived(Number((server?.remoteAddr ?? "").split(":").pop()) || 7890);
  const phone = $derived(viewport.narrow);
  const canMe = $derived(!!server?.isFull);
  const canExisting = $derived(server?.connectionMode === "local");
  const others = $derived((server?.people?.users ?? []).filter((u) => u.id !== server?.user?.id));
  // A server without people has no who-question: the code is made straight away.
  const hasWho = $derived(!!server?.user);
  const mine = $derived(server?.me.name);

  let hosts = $state<string[]>([]);
  let host = $state("");
  let name = $state("");
  // "making" covers reading the addresses and waiting for the server's code; "form" and "old" are problems.
  let phase = $state<"who" | "making" | "scan" | "form" | "old">("who");
  // A new code made after Decline or Try again: the card stays on the scan step while it is made.
  let regen = $state(false);
  // "me", "limited", "trusted", "full", or "p:<id>" for a person already on this server.
  let choice = $state("me");
  let token = $state("");
  let rtcFp = $state("");
  let error = $state("");
  let blocked = $state(false); // nothing a retry here would fix
  let copied = $state(false);
  let full = $state(false);
  // The request being allowed: kept here, so the card stays while Allow is in flight.
  let asking = $state<Req | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let allowTimer: ReturnType<typeof setTimeout> | undefined;

  const credentialTier = $derived<Tier | undefined>(choice === "me" || choice.startsWith("p:") ? undefined : (choice as Tier));

  // The phone connects under the token just made, so match on that: its own name and picture then
  // confirm the right device paired and kept its identity.
  const request = $derived(phase === "scan" ? server?.pairingRequests.find((r) => r.credential === name) : undefined);
  const ask = $derived<Req | undefined>(asking ?? request);
  const joined = $derived(phase === "scan" ? server?.peers.find((p) => p.credential === name) : undefined);
  const view = $derived<View>(
    phase === "old" || phase === "form"
      ? "problem"
      : joined
        ? "done"
        : ask
          ? "ask"
          : phase === "scan" || (phase === "making" && (regen || !hasWho))
            ? "scan"
            : "who",
  );
  const wide = $derived(view === "who" || view === "scan");
  const askTier = $derived<Tier>(full ? "full" : (ask?.tier ?? "limited"));
  const initial = $derived((ask?.name ?? "").trim().charAt(0).toUpperCase());
  const doneTier = $derived<Tier | undefined>(asking ? (full ? "full" : asking.tier) : undefined);
  const forLabel = $derived(
    choice === "me" || !hasWho
      ? "you"
      : choice.startsWith("p:")
        ? others.find((u) => u.id === choice.slice(2))?.name || "someone"
        : `someone new, ${TIER[choice as Tier]} access`,
  );
  const addresses = $derived([host, ...hosts.filter((h) => h !== host)]);
  // The QR code opens the hosted app, which connects straight to the server over WebRTC and needs no
  // certificate to be trusted. The link for a computer opens the server's own page instead, so the
  // client that loads is always this server's own version (the browser asks once about its certificate).
  const link = $derived(pairingUrl(addresses, port, token, rtcFp || undefined));
  const ownLink = $derived(pairingUrl(addresses, port, token));

  // Measured height for the card morph: the flow for who and scan, the card otherwise.
  let flowEl = $state<HTMLElement>();
  let cardEl = $state<HTMLElement>();
  let height = $state<number>();
  $effect(() => {
    void [flowEl, cardEl, view, error, joined, ask, token, copied, full, choice, phase, canMe, others.length, hosts.length, app.settings.wallpaper, phone];
    void tick().then(() => {
      if (phone) {
        height = undefined;
        return;
      }
      height = (view === "who" || view === "scan" ? flowEl : cardEl)?.offsetHeight;
    });
  });

  // The server answers register_token with the token exactly once; take it so People doesn't also show it.
  $effect(() => {
    const t = server?.justRegisteredToken;
    if (phase !== "making" || !t || t.name !== name.trim()) return;
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

  // A joined device means the request was allowed; the allow timer has nothing left to guard.
  $effect(() => {
    if (joined) clearTimeout(allowTimer);
  });

  $effect(() => {
    if (!open) return;
    untrack(start);
    return () => clearTimeout(timer);
  });

  $effect(() => () => {
    clearTimeout(timer);
    clearTimeout(allowTimer);
  });

  function start() {
    phase = "making";
    regen = false;
    copied = false;
    full = false;
    asking = null;
    token = "";
    rtcFp = "";
    error = "";
    blocked = false;
    choice = canMe ? "me" : "limited";
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
        if (hasWho) phase = "who";
        else create();
      },
      (e) => ((error = String(e)), (blocked = true), (phase = "form")),
    );
  }

  /** The name a device's code is made under: the person's own device, or the person it is for. */
  function credentialName(): string {
    if (!hasWho || choice === "me") return mine ? `${mine}'s device` : "Device";
    if (choice.startsWith("p:")) return `${others.find((u) => u.id === choice.slice(2))?.name || "Unnamed"}'s device`;
    return "New device";
  }

  function whoArg(): { user: string; tier?: Tier } | undefined {
    if (!hasWho) return undefined;
    if (choice === "me") return { user: "me" };
    if (choice.startsWith("p:")) return { user: choice.slice(2) };
    return { user: "new", tier: credentialTier };
  }

  function create() {
    name = credentialName();
    const taken = new Set(server?.tokens.map((t) => t.name));
    let n = name.trim();
    for (let i = 2; taken.has(n); i++) n = `${name.trim()} ${i}`;
    name = n;
    error = "";
    phase = "making";
    registerToken(cid, n, undefined, true, whoArg());
    clearTimeout(timer);
    timer = setTimeout(() => {
      phase = "form";
      error = "No answer from the server. Is remote access on?";
    }, 6000);
  }

  async function createCode() {
    if (choice === "full" && !(await askConfirm("Full access can do anything you can on this computer. Give it?"))) return;
    create();
  }

  /** Back to the who step, discarding the code just made: it was for someone else. */
  function change() {
    if (token) removeToken(cid, name.trim());
    token = "";
    rtcFp = "";
    copied = false;
    regen = false;
    error = "";
    phase = "who";
  }

  function retry() {
    token = "";
    rtcFp = "";
    regen = true;
    create();
  }

  function allow() {
    if (!ask) return;
    // Answering drops the request, and with it `ask`: keep a copy first.
    const req = ask;
    asking = req;
    answerPairing(cid, req.credential, true, full);
    clearTimeout(allowTimer);
    allowTimer = setTimeout(() => {
      asking = null;
      error = "The device didn't finish connecting";
    }, 8000);
  }

  /** The server deleted that code, so a fresh one is made and the card returns to the scan step. */
  function decline() {
    if (!ask) return;
    answerPairing(cid, ask.credential, false);
    asking = null;
    full = false;
    token = "";
    rtcFp = "";
    regen = true;
    create();
  }

  function copyLink() {
    void navigator.clipboard?.writeText(ownLink);
    copied = true;
  }

  function openPeople() {
    onOpenPeople?.();
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <SheetDialog class="dialog-content pair">
      <div class="dlg" data-view={view} style:width={phone ? undefined : wide ? "44rem" : "26rem"} style:height={phone || height === undefined ? undefined : `${height}px`}>
        <Dialog.Close class="dialog-close pair-close" aria-label="Close"><Icon name="xmark" size={14} /></Dialog.Close>

        <div class="side">
          <div class="qr" class:off={!(view === "scan" && token)}>
            <QrCode text={token ? link : "yoake"} label="Pairing code" />
          </div>
          <div class="where">
            {#if hosts.length > 1}
              <select class="addr" bind:value={host} aria-label="Address">
                {#each hosts as h (h)}<option value={h}>{h}:{port}</option>{/each}
              </select>
            {:else}
              {host}:{port}
            {/if}
          </div>
        </div>

        <div class="main">
          <div class="flow" bind:this={flowEl} inert={!wide || undefined}>
            <div class="head">
              <Dialog.Title class="pair-title"><span class="pair-badge"><Icon name="device-mobile" size={16} /></span> Add a device</Dialog.Title>
            </div>
            <div class="track">
              <div class="rail" class:solo={!hasWho} style="--i: {view === 'scan' && hasWho ? 1 : 0}">
                {#if hasWho}
                  <section class="pane" class:active={view === "who"} inert={view !== "who" || undefined}>
                    <div class="mbody">
                      {#if canMe}
                        <div class="opts">
                          <label class="opt">
                            <input type="radio" name="pair-who" value="me" bind:group={choice} />
                            <span class="l"><b>Me</b><span>Shares your chats. You choose its access when it joins</span></span>
                          </label>
                        </div>
                      {/if}
                      <p class="gl">Someone else, under the name their device sends</p>
                      <div class="opts">
                        <label class="opt">
                          <input type="radio" name="pair-who" value="limited" bind:group={choice} />
                          <span class="l"><b>Limited</b><span>Works in projects already on this server</span></span>
                        </label>
                        {#if canMe}
                          <label class="opt">
                            <input type="radio" name="pair-who" value="trusted" bind:group={choice} />
                            <span class="l"><b>Trusted</b><span>Also helps run the server, without machine access</span></span>
                          </label>
                          <label class="opt">
                            <input type="radio" name="pair-who" value="full" bind:group={choice} />
                            <span class="l"><b>Full</b><span>Anything you can do on this computer</span></span>
                          </label>
                        {/if}
                      </div>
                      {#if canExisting && others.length}
                        <h4 class="gl">Someone already on this server</h4>
                        <div class="opts some">
                          {#each others as u (u.id)}
                            <label class="opt">
                              <input type="radio" name="pair-who" value={`p:${u.id}`} bind:group={choice} />
                              <span class="l"><b>{u.name || "Unnamed"}</b></span>
                            </label>
                          {/each}
                        </div>
                      {/if}
                    </div>
                    <div class="mfoot">
                      <span class="say" class:err={!!error}>{error}</span>
                      <Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
                      <Button type="button" variant="primary" loading={phase === "making"} onclick={createCode}>Create code</Button>
                    </div>
                  </section>
                {/if}

                <section class="pane" class:active={view === "scan"} inert={view !== "scan" || undefined}>
                  <div class="mbody">
                    {#if hasWho}
                      <p class="for">For <strong>{forLabel}</strong><button type="button" class="change" onclick={change}>Change</button></p>
                    {/if}
                    <div class="box">
                      <div class="prow top">
                        <span class="ico"><Icon name="device-mobile" size={14} /></span>
                        <div class="l">
                          <b>On a phone</b>
                          <span>Point the camera at the code. It works once, for 10 minutes.</span>
                        </div>
                      </div>
                      <div class="prow top">
                        <span class="ico"><Icon name="device-desktop" size={14} /></span>
                        <div class="l">
                          <b>On a computer</b>
                          <span>Opens this server's own page. The browser asks once about its certificate.</span>
                          {#if token}
                            <div class="linkrow">
                              <input class="pair-link" readonly value={ownLink} aria-label="Link for a computer" onfocus={(e) => e.currentTarget.select()} />
                              <Button type="button" onclick={copyLink}>
                                <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
                              </Button>
                            </div>
                          {:else}
                            <div class="wait"><Spinner size="s" /> Making a code…</div>
                          {/if}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="mfoot">
                    <span class="say" class:err={!!error}>{error || (token ? "Waiting for the device" : "")}</span>
                    <Button type="button" variant="ghost" onclick={() => (open = false)}>Close</Button>
                  </div>
                </section>
              </div>
            </div>
          </div>

          {#if view === "ask" && ask}
            <div class="card ask" bind:this={cardEl}>
              <div class="id">
                <span class="av">
                  {#if initial}{initial}{:else}<Icon name="device-mobile" size={17} />{/if}
                </span>
                <div>
                  <h3>{ask.name || "A device"} wants to join</h3>
                  <p>{deviceTypeLabel(ask.deviceType)}{ask.ip ? ` from ${ask.ip}` : ""}</p>
                </div>
              </div>
              <div class="box">
                <div class="prow">
                  <div class="l"><b>Joins as</b></div>
                  <div class="c">
                    <span class="joins">{ask.userName || "New person"}</span>
                    <Badge tone={TONE[askTier]}>{TIER[askTier]}</Badge>
                  </div>
                </div>
                {#if canMe && ask.tier !== "full"}
                  <div class="prow">
                    <div class="l"><b>Give full access</b><span>Anything you can do on this computer</span></div>
                    <div class="c"><Switch bind:checked={full} label="Give full access" /></div>
                  </div>
                {/if}
              </div>
              <div class="acts">
                <span class="say">Only allow a device you recognize</span>
                <Button type="button" variant="ghost" disabled={!!asking} onclick={decline}>Decline</Button>
                <Button type="button" variant="primary" loading={!!asking} onclick={allow}>Allow</Button>
              </div>
            </div>
          {:else if view === "done" && joined}
            <div class="card done" bind:this={cardEl}>
              <div class="link">
                {#if app.settings.wallpaper}
                  <canvas use:wallpaperGL={{ src: app.settings.wallpaper, style: app.settings.wallpaperStyle, fade: false }}></canvas>
                  <span class="scrim"></span>
                {/if}
                <span class="linkin">
                  <span class="node">
                    {#if joined.avatar && isPhotoAvatar(joined.avatar)}<img src={avatarSrc(joined.avatar)} alt="" />
                    {:else if joined.avatar}{joined.avatar}
                    {:else}{(joined.name || "?").charAt(0).toUpperCase()}{/if}
                    <i class="on-dot"></i>
                  </span>
                  <span class="wire">{#each [0, 1, 2, 3, 4] as n (n)}<i style="--n: {n}"></i>{/each}</span>
                  <img class="appicon" src="logo.png" alt="" />
                </span>
              </div>
              <div class="done-text">
                <h3>{joined.name} is connected</h3>
                <p>{deviceTypeLabel(joined.deviceType)}{doneTier ? ` with ${TIER[doneTier]} access` : ""}</p>
              </div>
              <div class="acts">
                {#if onOpenPeople}<Button type="button" variant="ghost" onclick={openPeople}>Open in People</Button>{/if}
                <Button type="button" variant="primary" onclick={() => (open = false)}>Done</Button>
              </div>
            </div>
          {:else if view === "problem"}
            <div class="card problem" bind:this={cardEl}>
              <Dialog.Description class="pair-hint">{phase === "old" ? OLD_SERVER : error}</Dialog.Description>
              <div class="acts">
                <Button type="button" variant="ghost" onclick={() => (open = false)}>Close</Button>
                {#if !blocked}<Button type="button" variant="primary" onclick={retry}>Try again</Button>{/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-content.pair) {
    width: auto;
    max-width: none;
    max-height: none;
    padding: 0;
    overflow: hidden;
    display: block;
  }
  :global(.pair-title) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  :global(.pair-badge) {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 28%;
    background: var(--accent-dim);
    color: var(--accent);
  }
  :global(.pair-hint) {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.5;
  }
  :global(.pair-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
    z-index: 2;
    transition: opacity calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .dlg[data-view="ask"] :global(.pair-close),
  .dlg[data-view="done"] :global(.pair-close) {
    opacity: 0;
    pointer-events: none;
  }

  /* Add a device: one card that morphs. Who and scan share a 44rem card, ask, done and problem a 26rem one. */
  .dlg {
    --move: calc(0.44s * var(--anim-speed, 1)) var(--ui-ease);
    position: relative;
    width: 44rem;
    max-width: 94vw;
    overflow: hidden;
    transition:
      width var(--move),
      height var(--move);
  }
  .side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 15rem;
    display: grid;
    align-content: center;
    gap: 1.25rem;
    padding: 1.25rem;
    background: var(--wash-1);
    border-right: 1px solid var(--panel-border);
    transition:
      transform calc(0.38s * var(--anim-speed, 1)) var(--ui-ease),
      opacity calc(0.3s * var(--anim-speed, 1)) ease;
  }
  .dlg[data-view="ask"] .side,
  .dlg[data-view="done"] .side,
  .dlg[data-view="problem"] .side {
    transform: translateX(-100%);
    opacity: 0;
  }
  /* Scanners need dark on light with a quiet zone, whatever the theme. */
  .qr {
    width: 100%;
    padding: 0.35rem;
    background: #fff;
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--panel-border);
    line-height: 0;
    transition:
      opacity calc(0.36s * var(--anim-speed, 1)) ease,
      filter calc(0.36s * var(--anim-speed, 1)) ease;
  }
  .qr.off {
    opacity: 0.35;
    filter: blur(4px);
  }
  .qr :global(svg) {
    width: 100%;
    height: auto;
    display: block;
  }
  .where {
    text-align: center;
    font-family: var(--code-font-family);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .addr {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: pointer;
  }
  .main {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 15rem;
    right: 0;
    background: var(--panel-bg);
    overflow: hidden;
    transition: left var(--move);
  }
  .dlg[data-view="ask"] .main,
  .dlg[data-view="done"] .main,
  .dlg[data-view="problem"] .main {
    left: 0;
  }
  /* Each layer keeps its own width, so the text doesn't reflow while the card resizes. */
  .flow {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(44rem - 15rem);
    display: flex;
    flex-direction: column;
    transition: opacity calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .dlg[data-view="ask"] .flow,
  .dlg[data-view="done"] .flow,
  .dlg[data-view="problem"] .flow {
    opacity: 0;
    pointer-events: none;
  }
  .head {
    flex: none;
    padding: 1.5rem 1.5rem 0.75rem;
  }
  .track {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .rail {
    display: flex;
    width: 200%;
    height: 100%;
    transform: translateX(calc(var(--i) * -50%));
    transition: transform var(--move);
  }
  .rail.solo {
    width: 100%;
    transform: none;
  }
  .pane {
    width: 50%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .rail.solo .pane {
    width: 100%;
  }
  .mbody {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 1.5rem 1rem;
  }
  .mfoot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 1.5rem 1.5rem;
  }
  .say {
    margin-right: auto;
    min-width: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .say.err {
    color: var(--danger, #e5484d);
  }
  .gl {
    margin: 0.25rem 0 -0.25rem;
    font-size: var(--text-label-size);
    font-weight: 400;
    color: var(--text-dim);
  }
  .opts {
    flex: none;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .opts.some {
    max-height: 8rem;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    transition: background 0.12s;
  }
  .opt + .opt {
    border-top: 1px solid var(--panel-border);
  }
  .opt:hover {
    background: var(--sidebar-hover);
  }
  .opt:has(input:checked) {
    background: var(--sidebar-active);
  }
  .opt .l {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .opt b {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .opt .l span {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  /* ui/Radio.svelte: selected, the well fills with the accent and keeps a hole. */
  .opt input {
    appearance: none;
    position: relative;
    flex: none;
    width: 1.29rem;
    height: 1.29rem;
    margin: 0;
    border-radius: 50%;
    background: var(--well);
    border: 1px solid var(--panel-border);
    cursor: inherit;
    transition:
      background calc(0.18s * var(--anim-speed, 1)) ease,
      border-color calc(0.18s * var(--anim-speed, 1)) ease;
  }
  .opt input::before {
    content: "";
    position: absolute;
    inset: 0;
    margin: auto;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--bead);
    transform: scale(0);
    transition: transform calc(0.2s * var(--anim-speed, 1)) var(--ui-ease);
  }
  .opt input:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .opt input:checked::before {
    transform: none;
  }
  .opt input:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .box {
    flex: none;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 1.14rem;
    padding: 0.75rem 1rem;
  }
  .prow + .prow {
    border-top: 1px solid var(--panel-border);
  }
  .prow.top {
    align-items: flex-start;
  }
  .prow .l {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .prow .l b {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .prow .l span {
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .prow .c {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .ico {
    flex: none;
    width: 1.86rem;
    height: 1.86rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--wash-2);
    color: var(--text-dim);
  }
  .for {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-body-size);
    color: var(--text-dim);
  }
  .for strong {
    color: var(--text);
    font-weight: 500;
  }
  .change {
    margin-left: auto;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: var(--text-label-size);
    color: var(--accent);
    cursor: pointer;
  }
  .linkrow {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
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
    font-family: var(--code-font-family);
    font-size: var(--text-label-size);
    text-overflow: ellipsis;
  }
  .wait {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }

  /* The cards: rendered with {#if}, so the entrance plays again each time one shows. */
  .card {
    position: absolute;
    top: 0;
    left: 0;
    width: 26rem;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    animation: card-in calc(0.24s * var(--anim-speed, 1)) var(--ui-ease) calc(0.08s * var(--anim-speed, 1)) backwards;
  }
  .id {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .av {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.14rem;
    height: 2.14rem;
    border-radius: 28%;
    background: var(--wash-3);
    color: var(--text-dim);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .card h3 {
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  .id p,
  .done-text p {
    margin: 0.125rem 0 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .joins {
    font-size: var(--text-body-size);
    color: var(--text-dim);
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .acts .say {
    margin-right: auto;
  }

  /* Connected: the device reaches the server. The dots light once, then the person's online dot
     appears. Base styles are the end state, so reduced motion still reads. */
  .card.done {
    padding: 0;
    gap: 0;
  }
  .link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0.5rem 0.5rem 0;
    padding: 2rem 1.25rem;
    background: var(--wash-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  /* The user's wallpaper through their shader (wallpaperGL.ts), darkened so the nodes read. */
  .link canvas,
  .link .scrim {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .link .scrim {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }
  .linkin {
    position: relative;
    display: flex;
    align-items: center;
  }
  .node {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 28%;
    background: var(--panel-bg);
    color: var(--text-dim);
    font-size: 1.1rem;
    font-weight: 600;
  }
  .node img {
    width: 100%;
    height: 100%;
    border-radius: 28%;
    object-fit: cover;
  }
  .wire {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0.75rem;
  }
  /* Small squares like the shader's pixels and the rounded avatars. They light once from the person to the server. */
  .wire i {
    display: block;
    width: 0.25rem;
    height: 0.25rem;
    border-radius: 1px;
    background: var(--text);
    animation: hop calc(0.2s * var(--anim-speed, 1)) ease calc((0.3s + var(--n) * 70ms) * var(--anim-speed, 1)) backwards;
  }
  .on-dot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--success);
    border: 2px solid var(--panel-bg);
    animation: appear calc(0.2s * var(--anim-speed, 1)) ease calc(0.68s * var(--anim-speed, 1)) backwards;
  }
  .appicon {
    position: relative;
    flex: none;
    display: block;
    width: 3rem;
    height: 3rem;
  }
  .done-text {
    padding: 1rem 1.25rem 0.25rem;
    text-align: center;
  }
  .card.done .acts {
    padding: 0.75rem 1.25rem 1.25rem;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes hop {
    from {
      opacity: 0.15;
    }
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }

  /* A phone: the dialog is a bottom sheet, so no absolute layout and no fixed heights. Only the
     active step shows, and the side panel with the code shows only while scanning. */
  @media (max-width: 700px) {
    :global(.dialog-content.pair) {
      width: 100%;
      max-height: 90dvh;
      overflow-y: auto;
    }
    .dlg {
      width: auto;
      max-width: none;
      overflow: visible;
    }
    .main,
    .flow,
    .card {
      position: static;
      left: auto;
      right: auto;
      width: auto;
      transform: none;
    }
    .dlg[data-view="ask"] .flow,
    .dlg[data-view="done"] .flow,
    .dlg[data-view="problem"] .flow {
      display: none;
    }
    .track {
      overflow: visible;
    }
    .rail {
      display: block;
      width: auto;
      height: auto;
      transform: none;
      transition: none;
    }
    .pane {
      display: none;
      width: auto;
    }
    .pane.active {
      display: flex;
    }
    .side {
      display: none;
      position: static;
      width: auto;
      transform: none;
    }
    .dlg[data-view="scan"] .side {
      display: grid;
      justify-items: center;
      padding: 1.25rem 1.25rem 0;
      background: none;
      border-right: 0;
    }
    .dlg[data-view="scan"] .side .qr {
      width: 12rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dlg,
    .side,
    .main,
    .flow,
    .rail,
    .qr,
    .card,
    .opt input,
    .opt input::before,
    .wire i,
    .on-dot {
      transition: none !important;
      animation: none !important;
    }
  }
</style>

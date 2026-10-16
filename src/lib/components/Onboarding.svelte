<script lang="ts">
  // First run, in place of the whole app: welcome, server, provider, project, other servers, then a
  // recap of what is and isn't set up. Every step but the server is skippable; the recap shows what
  // was skipped. Desktop and browser share it, the server step is what differs.
  import { tick } from "svelte";
  import { fade } from "svelte/transition";
  import { app, CHAT_PROJECT, type ConnectionId } from "../state.svelte";
  import { isDesktop, pickFiles } from "../platform";
  import {
    cancelOpenRouterSignIn,
    connectLocalUnix,
    detectCli,
    installServer,
    getDefaultSocketPath,
    pickProjectFolder,
    registerProvider,
    selectProject,
    setDefaultProvider,
    setProvider,
    setPeerAvatar,
    setPeerName,
    signInOpenRouter,
  } from "../ipc";
  import { basename } from "../format";
  import { isPhotoAvatar, photoAvatarDataUrl } from "../avatar";
  import { CLI_AGENTS } from "../modelVendor";
  import { BRANDS, providerBrand } from "../usage";
  import type { CliKind } from "../types";
  import ConnectForm from "./ConnectForm.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import Button from "./ui/Button.svelte";
  import Segmented from "./ui/Segmented.svelte";
  import Spinner from "./ui/Spinner.svelte";
  import TextField from "./ui/TextField.svelte";

  const STEPS = ["welcome", "server", "provider", "project", "remotes", "done"] as const;
  type Step = (typeof STEPS)[number];
  const AVATARS = ["🐣", "🦊", "🐙", "🐢", "🐝", "🐺"];

  let step = $state<Step>("welcome");
  const at = $derived(STEPS.indexOf(step));

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);
  const connected = $derived(server?.connectionStatus === "connected");

  // A step that works on the server can't stand without one: a dropped connection sends us back.
  $effect(() => {
    if ((step === "provider" || step === "project") && !connected) go("server");
  });

  let headingEl = $state<HTMLElement | null>(null);
  let nameEl = $state<HTMLInputElement | null>(null);
  async function go(to: Step) {
    step = to;
    await tick();
    (to === "welcome" ? nameEl : headingEl)?.focus();
  }

  function finish() {
    if (cid && server && !server.currentProjectPath && server.recentProjects[0]) selectProject(cid, server.recentProjects[0]);
    // The composer only adopts a provider once one has been confirmed, so a first chat would
    // open on an empty picker.
    const first = server?.providers.find((p) => p.name === server.defaultProvider.providerName) ?? server?.providers[0];
    if (cid && server && first && !server.lastUsedProvider && server.currentSessionId) setProvider(cid, server.currentSessionId, first.name);
    app.settings.onboarded = true;
    app.applySettings();
  }

  // ---- Welcome ----
  let name = $state(app.settings.profileName);
  // A phone paired from a desktop arrives with the name that was typed there; offer it as the
  // starting point rather than an empty box. Once, so clearing the field sticks.
  let seededName = false;
  $effect(() => {
    if (seededName || name) return;
    const given = Object.values(app.servers)
      .filter((s) => s.connectionMode !== "local")
      .map((s) => s.peers.find((p) => p.peerId === s.selfPeerId))
      // Only a name that came from pairing: not the shared token's, nor a generated placeholder.
      .find((p) => p?.credential && p.credential !== "default" && p.name === p.credential)?.name;
    if (given) ((name = given), (seededName = true));
  });
  function saveProfile() {
    app.settings.profileName = name.trim();
    app.applySettings();
    // Servers connected before this step only know the identity the app started with.
    for (const [id, s] of Object.entries(app.servers)) {
      if (s.connectionStatus !== "connected") continue;
      setPeerName(id, app.settings.profileName || "anonymous");
      setPeerAvatar(id, app.settings.profileAvatar);
    }
  }

  let photoInput = $state<HTMLInputElement | null>(null);
  let photoError = $state("");
  async function onPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    photoError = "";
    try {
      app.settings.profileAvatar = await photoAvatarDataUrl(file);
    } catch {
      photoError = "Couldn't read that image.";
    }
  }

  // ---- Server ----
  let remote = $state(!isDesktop);
  let binPath = $state("yoakeland");
  const status = $derived(app.connectionStatus);
  const noBinary = $derived(/failed to spawn/.test(app.connectionError ?? ""));

  async function tryLocal() {
    try {
      await connectLocalUnix({ binPath, socketPath: await getDefaultSocketPath() });
    } catch {
      // The reason is app.connectionError, shown below.
    }
  }
  let downloading = $state(false);
  async function download() {
    downloading = true;
    try {
      await installServer();
      binPath = "yoakeland"; // the bare name resolves to the downloaded copy
      await tryLocal();
    } catch (err) {
      app.setPendingConnect("error", "local", String(err));
    } finally {
      downloading = false;
    }
  }
  async function locateBinary() {
    const [file] = await pickFiles({ title: "Locate yoakeland binary" });
    if (!file) return;
    binPath = file;
    await tryLocal();
  }

  // ---- Provider ----
  const agents = $derived(
    (Object.entries(CLI_AGENTS) as [CliKind, (typeof CLI_AGENTS)[CliKind]][])
      .map(([kind, meta]) => ({ kind, ...meta, existing: server?.providers.find((p) => p.kind === kind), found: !!server?.cliAvailability[kind] }))
      .filter((a) => a.found || a.existing),
  );
  const detected = $derived(Object.keys(server?.cliAvailability ?? {}).length > 0);
  const keys = $derived((server?.providers ?? []).filter((p) => p.kind === "api_key" && p.authMethod !== "oauth"));
  const orAccount = $derived(server?.providers.find((p) => p.httpProvider === "openrouter" && p.authMethod === "oauth"));
  const hasProvider = $derived((server?.providers.length ?? 0) > 0);

  // Registering is a round trip; the row shows a spinner until the provider list catches up.
  let pending = $state<Record<string, boolean>>({});
  function addPending(key: string) {
    pending[key] = true;
    setTimeout(() => delete pending[key], 8000);
  }
  // The first provider becomes what new chats start on.
  function register(data: Record<string, unknown>) {
    if (!cid || !server) return;
    if (!server.defaultProvider.providerName) setDefaultProvider(cid, String(data.name));
    registerProvider(cid, data);
  }
  function useAgent(kind: CliKind) {
    addPending(kind);
    register({ name: CLI_AGENTS[kind].defaultName, kind, authMethod: "manual" });
  }

  let orStatus = $state<"idle" | "waiting" | "finishing">("idle");
  let orError = $state("");
  $effect(() => {
    if (orAccount && orStatus !== "idle") orStatus = "idle";
  });
  async function signInOR() {
    if (!cid) return;
    orError = "";
    orStatus = "waiting";
    try {
      await signInOpenRouter(cid, "openrouter-oauth");
      orStatus = "finishing";
      setTimeout(() => {
        if (orStatus !== "finishing") return;
        orStatus = "idle";
        orError = "Sign-in failed. The server log has the reason.";
      }, 20_000);
    } catch (e) {
      if (orStatus === "waiting") orError = e instanceof Error ? e.message : String(e);
      orStatus = "idle";
    }
  }
  function cancelOR() {
    orStatus = "idle";
    void cancelOpenRouterSignIn();
  }

  let keyOpen = $state(false);
  let keyKind = $state("anthropic");
  let apiKey = $state("");
  let baseUrl = $state("");
  const KEY_KINDS = [
    { value: "anthropic", label: "Anthropic" },
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
  ];
  function addKey(e: Event) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    const taken = new Set(server?.providers.map((p) => p.name));
    let n = 1;
    let name = keyKind;
    while (taken.has(name)) name = `${keyKind}-${++n}`;
    addPending("key");
    register({ name, kind: "api_key", httpProvider: keyKind, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined, authMethod: "manual" });
    apiKey = baseUrl = "";
    keyOpen = false;
  }
  // The key row's spinner ends once a key shows up.
  $effect(() => {
    if (keys.length) delete pending.key;
  });

  // ---- Project ----
  let chatOnly = $state(false);
  // A remote connection can only use projects already open on the server (the server enforces it).
  const canAdd = $derived(server?.connectionMode === "local");
  const projects = $derived(server?.recentProjects.slice(0, 4) ?? []);
  const hasProject = $derived(chatOnly || (server?.recentProjects.length ?? 0) > 0);
  function chooseProject(path: string) {
    if (!cid) return;
    chatOnly = false;
    selectProject(cid, path);
  }
  async function browse() {
    if (!cid) return;
    const picked = await pickProjectFolder(cid);
    if (picked) chatOnly = false;
  }
  function chatInstead() {
    if (!cid) return;
    chatOnly = true;
    selectProject(cid, CHAT_PROJECT);
  }

  // ---- Other servers ----
  let adding = $state(false);
  const servers = $derived(Object.entries(app.servers));
  const address = (id: ConnectionId) => {
    const p = app.servers[id].connectParams;
    return p.mode === "local" ? "this computer" : `${p.host}:${p.port}`;
  };

  // ---- Recap ----
  const recap = $derived([
    {
      icon: "server",
      title: "Server",
      ok: connected,
      text: connected ? (server?.label ?? "Connected") : "Not connected",
      fix: "server" as Step,
    },
    {
      icon: "brain",
      title: "Provider",
      ok: hasProvider,
      text: hasProvider ? (server?.providers.map((p) => p.name).join(", ") ?? "") : "None yet. Add one in Settings.",
      fix: "provider" as Step,
    },
    {
      icon: "folder-open",
      title: "Project",
      ok: hasProject,
      text: chatOnly && !server?.recentProjects.length ? "Chat only" : server?.recentProjects[0] ? basename(server.currentProjectPath ?? server.recentProjects[0]) : "None yet. Add one from the sidebar.",
      fix: "project" as Step,
    },
  ]);

  const TEXT: Record<Step, { title: string; sub: string }> = {
    welcome: { title: "Welcome to yoakeland", sub: "Chat with coding agents that work inside your projects. About a minute of setup." },
    server: {
      title: "Connect a server",
      sub: isDesktop ? "Yoakeland runs as its own process. It looks for one on this computer." : "Connect to the yoakeland server this page belongs to.",
    },
    provider: { title: "Add a provider", sub: "Pick at least one: a coding agent already signed in on the server, or an API key." },
    project: { title: "Open a project", sub: "A folder on the server for the agent to read and edit. Add more any time." },
    remotes: { title: "Other servers", sub: "Optional. Connect more machines and switch between them from the sidebar." },
    done: { title: "All set", sub: "Here's where things stand." },
  };
  const next = $derived(STEPS[Math.min(at + 1, STEPS.length - 1)]);
  // The hint says a CLI signed in to "shows up here": keep asking while this step is open.
  $effect(() => {
    if (step !== "provider" || !connected || !cid) return;
    const id = cid;
    detectCli(id);
    const timer = setInterval(() => detectCli(id), 5000);
    return () => clearInterval(timer);
  });
  const needed = $derived(step === "provider" ? hasProvider : step === "project" ? hasProject : true);
</script>

{#snippet row(icon: string, brand: ReturnType<typeof providerBrand>, title: string, meta: string, warn = false)}
  <span class="mark" style:--tint={brand ? BRANDS[brand].color : "var(--accent)"}>
    {#if brand}<LobeIcon name={BRANDS[brand].icon} size={18} />{:else}<Icon name={icon as any} size={16} />{/if}
  </span>
  <span class="text">
    <span class="title">{title}</span>
    <span class="meta" class:warn>{meta}</span>
  </span>
{/snippet}

<div class="onb">
  <div class="stage" class:wide={step === "provider"}>
    <div class="dots" role="img" aria-label="Step {at + 1} of {STEPS.length}">
      {#each STEPS as s, i (s)}
        <span class="dot" class:now={i === at} class:past={i < at}></span>
      {/each}
    </div>

    {#key step}
      <section class="step" in:fade={{ duration: 180 }}>
        {#if step === "welcome"}
          <span class="hero"><img src="logo.png" alt="" /></span>
        {/if}
        <h1 bind:this={headingEl} tabindex="-1" class:big={step === "welcome"}>{TEXT[step].title}</h1>
        <p class="sub">{TEXT[step].sub}</p>

        {#if step === "welcome"}
          <form class="body" onsubmit={(e) => (e.preventDefault(), saveProfile(), go("server"))}>
            <label>
              What should we call you?
              <TextField bind:el={nameEl} bind:value={name} placeholder="Your name" maxlength={40} autocomplete="off" />
            </label>
            <div class="avatar-block">
              <span class="field-label">Pick an avatar, or use your own photo</span>
              <div class="avatars" role="radiogroup" aria-label="Avatar">
                {#each AVATARS as a (a)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={app.settings.profileAvatar === a}
                    class="avatar"
                    class:on={app.settings.profileAvatar === a}
                    onclick={() => (app.settings.profileAvatar = a)}>{a}</button
                  >
                {/each}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPhotoAvatar(app.settings.profileAvatar)}
                  aria-label="Upload a photo"
                  class="avatar upload"
                  class:on={isPhotoAvatar(app.settings.profileAvatar)}
                  onclick={() => photoInput?.click()}
                >
                  {#if isPhotoAvatar(app.settings.profileAvatar)}
                    <img src={app.settings.profileAvatar} alt="" />
                  {:else}
                    <Icon name="media-image" size={17} />
                  {/if}
                </button>
              </div>
              <input bind:this={photoInput} type="file" accept="image/*" hidden onchange={onPhoto} />
              <p class="hint">{photoError || "Other people on your servers see this."}</p>
            </div>
          </form>
        {:else if step === "server"}
          <div class="body">
            {#if connected && server}
              <div class="row ok">
                <span class="mark bare"><ServerAvatar name={server.label} seed={server.serverId} size={34} /></span>
                <span class="text">
                  <span class="title">{server.label}</span>
                  <span class="meta">{address(server.connectionId)}{server.serverStatus?.version ? ` · v${server.serverStatus.version}` : ""}</span>
                </span>
                <span class="state good"><Icon name="circle-check" size={18} /></span>
              </div>
            {:else if remote}
              <ConnectForm showLocal={false} onconnected={() => (remote = !isDesktop)} />
              {#if isDesktop}
                <Button variant="ghost" onclick={() => ((remote = false), tryLocal())}>Use this computer instead</Button>
              {/if}
            {:else}
              <div class="row">
                {@render row("computer", null, "This computer", status === "connecting" ? "Looking for a server…" : "No server answered")}
                <span class="state">
                  {#if status === "connecting"}<Spinner />{:else}<Icon name="alert-circle" size={18} />{/if}
                </span>
              </div>
              {#if status !== "connecting"}
                {#if app.connectionError}
                  <p class="error"><Icon name="alert-circle" size={14} /> {noBinary ? "The yoakeland server isn't installed or isn't on your PATH." : app.connectionError}</p>
                {/if}
                <div class="actions">
                  <Button onclick={tryLocal}><Icon name="refresh" size={14} /> Try again</Button>
                  {#if noBinary}
                    <Button variant="primary" onclick={download} disabled={downloading}>{downloading ? "Downloading…" : "Download server"}</Button>
                    <Button onclick={locateBinary}>Locate yoakeland…</Button>
                  {/if}
                  <Button variant="ghost" onclick={() => (remote = true)}>Use a remote server</Button>
                </div>
              {/if}
            {/if}
          </div>
        {:else if step === "provider"}
          <div class="body">
            <div class="list grid">
              {#each agents as a (a.kind)}
                {@const brand = providerBrand({ name: a.defaultName, kind: a.kind })}
                <div class="row card">
                  {@render row("brain", brand, a.title, a.existing ? "Ready" : `Runs the server's ${a.cli} CLI`)}
                  {#if a.existing}
                    <span class="state good"><Icon name="circle-check" size={18} /></span>
                  {:else}
                    <Button size="sm" loading={pending[a.kind]} onclick={() => useAgent(a.kind)}>Use</Button>
                  {/if}
                </div>
              {/each}
              {#if isDesktop || orAccount}
                <div class="row card">
                  {@render row("brain", "openrouter", "OpenRouter", orError || (orAccount ? "Signed in" : orStatus === "waiting" ? "Finish in your browser…" : orStatus === "finishing" ? "Finishing…" : "Sign in with your account"), !!orError)}
                  {#if orAccount}
                    <span class="state good"><Icon name="circle-check" size={18} /></span>
                  {:else if orStatus === "idle"}
                    <Button size="sm" onclick={signInOR}>Sign in</Button>
                  {:else}
                    <Button size="sm" variant="ghost" onclick={cancelOR}>Cancel</Button>
                  {/if}
                </div>
              {/if}
              {#each keys as k (k.name)}
                <div class="row card">
                  {@render row("key", providerBrand(k), k.name, "API key")}
                  <span class="state good"><Icon name="circle-check" size={18} /></span>
                </div>
              {/each}
              <div class="row card">
                {@render row("key", null, "API key", "Anthropic, OpenAI or OpenRouter")}
                {#if pending.key}
                  <Spinner />
                {:else}
                  <Button size="sm" variant={keyOpen ? "ghost" : "default"} onclick={() => (keyOpen = !keyOpen)}>{keyOpen ? "Close" : "Add"}</Button>
                {/if}
              </div>
            </div>
            {#if keyOpen}
              <form class="keyform" onsubmit={addKey}>
                <Segmented options={KEY_KINDS} bind:value={keyKind} label="Provider" />
                <TextField type="password" bind:value={apiKey} placeholder={keyKind === "anthropic" ? "sk-ant-…" : "sk-…"} autocomplete="off" aria-label="API key" />
                {#if keyKind === "openai"}
                  <TextField bind:value={baseUrl} placeholder="Base URL (optional), e.g. http://localhost:11434/v1" aria-label="Base URL" />
                {/if}
                <Button variant="primary" type="submit" disabled={!apiKey.trim()}>Add key</Button>
              </form>
            {/if}
            {#if !detected}
              <p class="hint"><Spinner size="s" /> Looking for coding agents on the server…</p>
            {:else if !agents.length}
              <p class="hint">No coding agents found on the server. Sign in to one in a terminal there and it shows up here.</p>
            {/if}
          </div>
        {:else if step === "project"}
          <div class="body">
            {#if projects.length}
              <div class="list">
                {#each projects as p (p)}
                  {@const on = !chatOnly && server?.currentProjectPath === p}
                  <button class="row pick" class:on onclick={() => chooseProject(p)}>
                    {@render row("folder-open", null, basename(p), p)}
                    <span class="state" class:good={on}>{#if on}<Icon name="circle-check" size={18} />{/if}</span>
                  </button>
                {/each}
              </div>
            {/if}
            <div class="actions">
              {#if canAdd}
                <Button variant={projects.length ? "default" : "primary"} onclick={browse}><Icon name="folder-plus" size={14} /> Choose a folder…</Button>
              {/if}
              <Button variant="ghost" onclick={chatInstead}>{chatOnly ? "Chatting without a project" : "Just chat for now"}</Button>
            </div>
            {#if !canAdd}
              <p class="hint">This server only opens projects from its own machine. Open one there and it shows up here.</p>
            {/if}
          </div>
        {:else if step === "remotes"}
          <div class="body">
            <div class="list">
              {#each servers as [id, s] (id)}
                <div class="row">
                  <span class="mark bare"><ServerAvatar name={s.label} seed={s.serverId} size={34} /></span>
                  <span class="text">
                    <span class="title">{s.label}</span>
                    <span class="meta">{address(id)}</span>
                  </span>
                  <span class="state" class:good={s.connectionStatus === "connected"}>
                    <Icon name={s.connectionStatus === "connected" ? "circle-check" : "alert-circle"} size={18} />
                  </span>
                </div>
              {/each}
            </div>
            {#if adding}
              <ConnectForm showLocal={false} onconnected={() => (adding = false)} />
              <Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
            {:else}
              <div class="actions">
                <Button onclick={() => (adding = true)}><Icon name="plus" size={14} /> Add a remote server</Button>
              </div>
            {/if}
            {#if isDesktop && server?.connectionMode === "local" && !adding}
              <p class="hint">To reach this computer from other devices, turn on remote access in Settings › Access.</p>
            {/if}
          </div>
        {:else}
          <div class="body">
            <div class="list">
              {#each recap as r (r.title)}
                <div class="row">
                  {@render row(r.icon, null, r.title, r.text, !r.ok)}
                  {#if r.ok}
                    <span class="state good"><Icon name="circle-check" size={18} /></span>
                  {:else}
                    <Button size="sm" onclick={() => go(r.fix)}>Fix</Button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/key}

    <footer>
      {#if step !== "welcome"}
        <Button variant="ghost" icon aria-label="Back" onclick={() => go(STEPS[at - 1])}><Icon name="chevron-left" size={15} /></Button>
      {/if}
      <span class="spacer"></span>
      {#if step !== "done"}
        <Button variant="ghost" onclick={finish}>Skip setup</Button>
      {/if}
      {#if step === "welcome"}
        <Button variant="primary" onclick={() => (saveProfile(), go("server"))}>Get started <Icon name="chevron-right" size={14} /></Button>
      {:else if step === "done"}
        <Button variant="primary" onclick={finish}>Start coding</Button>
      {:else if step === "server"}
        <Button variant="primary" disabled={!connected} onclick={() => go(next)}>Continue <Icon name="chevron-right" size={14} /></Button>
      {:else}
        <Button variant={needed ? "primary" : "default"} onclick={() => go(next)}>{needed ? "Continue" : "Skip for now"} <Icon name="chevron-right" size={14} /></Button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .onb {
    flex: 1;
    display: flex;
    min-width: 0;
    margin: var(--chat-margin);
    overflow-y: auto;
    scrollbar-gutter: stable;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-xl);
  }
  :global(:root[data-main="flat"]) .onb {
    border-radius: 0;
    border-width: 0;
  }
  .stage {
    --ctrl-h: 2.64rem;
    width: min(30rem, 100%);
    margin: auto;
    padding: var(--space-4) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .stage.wide {
    width: min(42rem, 100%);
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 0.43rem;
  }
  .dot {
    width: 0.43rem;
    height: 0.43rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--text) 18%, transparent);
    transition:
      width calc(0.25s * var(--anim-speed, 1)) var(--ui-ease),
      background calc(0.25s * var(--anim-speed, 1)) ease;
  }
  .dot.past {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .dot.now {
    width: 1.43rem;
    background: var(--accent);
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .hero {
    align-self: center;
    display: grid;
    place-items: center;
    width: 5.6rem;
    height: 5.6rem;
    margin-bottom: var(--space-1);
    border-radius: 50%;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    animation: rise calc(0.5s * var(--anim-speed, 1)) var(--ui-ease) both;
  }
  .hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  h1 {
    margin: 0;
    text-align: center;
    font-size: 1.3rem;
    font-weight: var(--text-title-weight);
    color: var(--text);
    outline: none;
  }
  h1.big {
    font-family: var(--logo-font-family);
    font-weight: 400;
    font-size: 1.6rem;
  }
  .sub {
    margin: 0 auto var(--space-2);
    max-width: 24rem;
    text-align: center;
    color: var(--text-dim);
    font-size: var(--text-body-size);
    line-height: 1.5;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .avatar-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .field-label {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .avatars {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-1);
  }
  .avatar.upload {
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    color: var(--text-dim);
    border: 1px dashed var(--field-border-hover);
  }
  .avatar.upload.on {
    border: 1px solid var(--accent);
  }
  .avatar.upload img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar {
    width: 2.6rem;
    height: 2.6rem;
    border: 1px solid transparent;
    border-radius: 50%;
    background: var(--well);
    font-size: 1.25rem;
    cursor: pointer;
    transition:
      background calc(0.15s * var(--anim-speed, 1)) ease,
      border-color calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .avatar:hover {
    background: var(--sidebar-active);
  }
  .avatar.on {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .avatar:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
  }
  .list.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  }
  .row.card {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    row-gap: var(--space-1);
    min-height: 0;
    padding: 0.86rem;
  }
  .row.card .text {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .row.card > :global(:last-child) {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 3.4rem;
    padding: 0.57rem 0.86rem 0.57rem 0.71rem;
    background: var(--field-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .row .mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.14rem;
    height: 2.14rem;
    border-radius: 50%;
    color: var(--tint, var(--accent));
    background: color-mix(in srgb, var(--tint, var(--accent)) 14%, transparent);
  }
  .row .mark.bare {
    width: auto;
    height: auto;
    border-radius: 0;
    background: none;
  }
  .row .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .title {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .meta.warn {
    color: var(--warning);
  }
  .state {
    display: flex;
    flex-shrink: 0;
    color: var(--text-dim);
  }
  .state.good {
    color: var(--success);
  }
  .pick {
    cursor: pointer;
  }
  .pick:hover {
    background: var(--field-bg-focus);
  }
  .pick.on {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .keyform {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-half);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-1);
    margin-top: var(--space-half);
  }
  .hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.43rem;
    margin: var(--space-half) 0 0;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .error {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0;
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
  footer {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .spacer {
    flex: 1;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.96);
    }
  }
</style>

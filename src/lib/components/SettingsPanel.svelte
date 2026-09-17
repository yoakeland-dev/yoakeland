<script lang="ts">
  // Deliberately basic — visuals get hand-tuned later. Appearance, Profile
  // and Connections are fully functional (client-only, no protocol needed).
  // Network and Server are UI shells: both need yoakeland changes that don't
  // exist yet (a peer/connection registry, and runtime-settable remote-access
  // config) — see the checklist. Their controls are inert on purpose rather
  // than pretending to work.
  import { Dialog, Tabs, Switch, Checkbox } from "bits-ui";
  import { app } from "../state.svelte";
  import { basename } from "../format";
  import {
    browseAndAddProject,
    setPeerName,
    setPeerAvatar,
    disconnectPeer,
    setRemoteAccess,
    setAutoGenerateTitle,
    setRemotePassword,
    setServerIdentity,
    registerProvider,
    removeProvider,
    registerToken,
    removeToken,
  } from "../ipc";
  import { extractAccentFromImage, hexToHue, hslToHex, deriveTheme } from "../theme";
  import { isPhotoAvatar, photoAvatarDataUrl } from "../avatar";
  import type { ProviderInfo } from "../types";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import Dropdown from "./Dropdown.svelte";

  const QUICK_AVATARS = ["🐣", "🦊", "🐙", "🐢", "🐝", "🐺"];

  // ---- Providers tab (credentials only — model selection lives in
  // ModelPicker.svelte, sourced from list_models) ----
  // OpenRouter is registered as a plain API key here, same as Anthropic/
  // OpenAI — no OAuth sign-in flow. OAuth added a second, asymmetric path for
  // one vendor only, for no real benefit over pasting a key like every other
  // provider; the server-side openrouter_oauth_* handlers can stay (SPEC.md
  // §3.1) for now, this is just the client no longer offering it.
  let providerName = $state("");
  let httpProvider = $state<"anthropic" | "openai" | "openrouter">("anthropic");
  let apiKey = $state("");
  let baseUrl = $state("");

  function resetProviderForm() {
    providerName = "";
    apiKey = "";
    baseUrl = "";
  }

  function submitProvider(e: Event) {
    e.preventDefault();
    if (!providerName.trim()) return;
    registerProvider({
      name: providerName,
      kind: "api_key",
      httpProvider,
      apiKey,
      baseUrl: baseUrl || undefined,
      authMethod: "manual",
    });
    resetProviderForm();
  }

  // Subscription CLIs (Claude/Codex) are a one-per-machine login, not a named
  // credential you'd ever want two of — so unlike api_key/OpenRouter, these
  // get a fixed name and a plain on/off switch instead of a registration
  // form. (The wire protocol still requires a `name` on register_provider —
  // a server-side change to make these truly nameless/singleton is a
  // separate, backend-side improvement, not something this client can fix.)
  const CLI_PROVIDER_NAME: Record<"cli_claude" | "cli_codex", string> = {
    cli_claude: "claude-subscription",
    cli_codex: "codex-subscription",
  };
  const claudeProvider = $derived(app.providers.find((p) => p.kind === "cli_claude"));
  const codexProvider = $derived(app.providers.find((p) => p.kind === "cli_codex"));

  function toggleCli(kind: "cli_claude" | "cli_codex", existing: ProviderInfo | undefined, enabled: boolean) {
    if (enabled) {
      registerProvider({ name: CLI_PROVIDER_NAME[kind], kind, authMethod: "manual" });
    } else if (existing) {
      removeProvider(existing.name);
    }
  }

  let remotePasswordInput = $state("");
  let serverIdentityInput = $state("");
  $effect(() => {
    if (app.serverIdentity !== null) serverIdentityInput = app.serverIdentity;
  });

  const isLocalConnection = $derived(app.connectionStatus === "connected" && app.connectionMode === "local");

  function onProfileNameChange() {
    apply();
    if (app.connectionStatus === "connected") setPeerName(app.settings.profileName || "anonymous");
  }

  function pushAvatar() {
    apply();
    if (app.connectionStatus === "connected") setPeerAvatar(app.settings.profileAvatar);
  }

  function setEmojiAvatar(emoji: string) {
    app.settings.profileAvatar = emoji;
    pushAvatar();
  }

  let avatarInput: HTMLInputElement;
  let uploadingAvatar = $state(false);

  async function onAvatarFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploadingAvatar = true;
    try {
      app.settings.profileAvatar = await photoAvatarDataUrl(file);
      pushAvatar();
    } finally {
      uploadingAvatar = false;
      (e.target as HTMLInputElement).value = "";
    }
  }

  function onDisconnectPeer(peerId: string, name: string) {
    if (confirm(`Disconnect "${name}"? Any peer can disconnect any other — there's no extra permission check.`)) {
      disconnectPeer(peerId);
    }
  }

  function onRemoveProvider(name: string) {
    if (confirm(`Remove provider "${name}"? This can't be undone.`)) {
      removeProvider(name);
    }
  }

  function onRemoteAccessToggle(checked: boolean) {
    setRemoteAccess(checked);
  }

  function onAutoGenerateTitleToggle(checked: boolean) {
    setAutoGenerateTitle(checked);
  }

  function submitRemotePassword(e: Event) {
    e.preventDefault();
    if (!remotePasswordInput) return;
    setRemotePassword(remotePasswordInput);
    remotePasswordInput = "";
  }

  function submitServerIdentity(e: Event) {
    e.preventDefault();
    if (!serverIdentityInput.trim()) return;
    setServerIdentity(serverIdentityInput.trim());
  }

  let tokenNameInput = $state("");
  let tokenEmailInput = $state("");

  function submitToken(e: Event) {
    e.preventDefault();
    if (!tokenNameInput.trim()) return;
    registerToken(tokenNameInput.trim(), tokenEmailInput.trim() || undefined);
    tokenNameInput = "";
    tokenEmailInput = "";
  }

  function onRemoveToken(name: string) {
    if (confirm(`Revoke "${name}"'s access? They'll be logged out on their next reconnect.`)) {
      removeToken(name);
    }
  }

  const deviceIcon: Record<string, "laptop" | "cloud" | "server"> = {
    desktop: "laptop",
    web: "cloud",
    server: "server",
  };

  let wallpaperInput: HTMLInputElement;
  let extracting = $state(false);

  function setAccent(color: string) {
    app.settings.accent = color;
    apply();
  }

  // ---- Custom hue slider: replaces the OS color picker so choosing an
  // accent stays in-panel and looks the same across platforms. Fixed
  // saturation/lightness (see hslToHex) — only hue is adjustable. Tracked
  // as its own state (not purely derived from the accent hex) because
  // hue -> hex -> hue round-trips through 8-bit rounding: re-deriving the
  // hue from the just-set accent on every drag step snapped the thumb to a
  // slightly different angle than the one actually dragged to, reading as
  // "picks the wrong color" and "jumps". Still re-synced from the accent
  // whenever it changes from outside this slider (e.g. a wallpaper-derived
  // accent, which doesn't go through here at all).
  let hue = $state(hexToHue(app.settings.accent));
  let hueSyncedAccent = app.settings.accent;

  $effect(() => {
    if (app.settings.accent !== hueSyncedAccent) {
      hue = hexToHue(app.settings.accent);
      hueSyncedAccent = app.settings.accent;
    }
  });

  function onHueInput(value: number) {
    hue = value;
    const hex = hslToHex(value, 70, 65);
    hueSyncedAccent = hex;
    app.settings.accentFromWallpaper = false;
    setAccent(hex);
  }

  // Mode cards preview the *actual* derived surfaces for the current accent
  // — not a fixed gray — so recoloring the accent (hue slider or wallpaper)
  // visibly recolors these too instead of leaving them looking unrelated.
  const darkPreview = $derived(deriveTheme(app.settings.accent, "dark"));
  const lightPreview = $derived(deriveTheme(app.settings.accent, "light"));

  function skeletonBg(modeId: string): string {
    if (modeId === "dark") return darkPreview.bg;
    if (modeId === "light") return lightPreview.bg;
    return `linear-gradient(115deg, ${darkPreview.bg} 50%, ${lightPreview.bg} 50%)`;
  }

  function skeletonLine(modeId: string): string {
    if (modeId === "dark") return darkPreview.sidebarFgDim;
    if (modeId === "light") return lightPreview.sidebarFgDim;
    // Split diagonal needs one line color that reads on both halves — the
    // mode-specific ones above are each tuned for just one side.
    return "rgba(128, 128, 128, 0.7)";
  }

  function apply() {
    app.applySettings();
  }

  const WALLPAPER_MAX_DIM = 1920;

  async function onWallpaperFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, WALLPAPER_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    app.settings.wallpaper = canvas.toDataURL("image/jpeg", 0.85);
    apply();
    void syncAccentToWallpaper();
  }

  function clearWallpaper() {
    app.settings.wallpaper = "";
    app.settings.accentFromWallpaper = false;
    apply();
    if (wallpaperInput) wallpaperInput.value = "";
  }

  /** Re-derives the accent from the current wallpaper. A switch rather than a
   * one-shot button: turning it on keeps the two in step, so swapping the
   * wallpaper later recolors the UI without a second trip to Settings. */
  async function syncAccentToWallpaper() {
    if (!app.settings.accentFromWallpaper || !app.settings.wallpaper) return;
    extracting = true;
    try {
      setAccent(await extractAccentFromImage(app.settings.wallpaper));
    } finally {
      extracting = false;
    }
  }

  function onAccentFromWallpaperToggle(checked: boolean) {
    app.settings.accentFromWallpaper = checked;
    apply();
    void syncAccentToWallpaper();
  }

  // ---- Search: grays out (rather than hides) non-matching tabs, and dims
  // non-matching settings rows within the open tab — so a search never
  // yanks the page out from under you, it just points at what matched.
  let settingsSearch = $state("");
  let tabHasMatch = $state<Record<string, boolean>>({});

  function searchable(node: HTMLElement, params: { tab: string; query: string }) {
    function update({ tab, query }: { tab: string; query: string }) {
      const q = query.trim().toLowerCase();
      const rows = node.querySelectorAll<HTMLElement>(
        ".field, .cli-card, .warning-card, .provider-form, .paths > li, .peers > li, .provider-list > li",
      );
      let any = !q;
      rows.forEach((row) => {
        const matches = !q || (row.textContent ?? "").toLowerCase().includes(q);
        row.classList.toggle("search-dim", !matches);
        if (matches) any = true;
      });
      tabHasMatch = { ...tabHasMatch, [tab]: any };
    }
    update(params);
    return { update };
  }

</script>

<Dialog.Root bind:open={app.showSettings}>
  <Dialog.Portal>
    <Dialog.Overlay class="settings-overlay" />
    <Dialog.Content class="content">
      <div class="head">
        <Dialog.Title>Settings</Dialog.Title>
        <Dialog.Close class="settings-close"><Icon name="xmark" size={14} /></Dialog.Close>
      </div>

      <Tabs.Root bind:value={app.settingsTab} orientation="vertical" class="settings-tabs">
        <Tabs.List class="tabs-list">
          <div class="settings-search">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search settings…" bind:value={settingsSearch} />
            {#if settingsSearch}
              <button
                class="search-clear"
                onclick={() => (settingsSearch = "")}
                title="Clear search"
                aria-label="Clear search"
              >
                <Icon name="xmark" size={12} />
              </button>
            {/if}
          </div>

          <div class="tabs-group-label">You</div>
          <Tabs.Trigger value="profile" class="settings-tab-trigger {settingsSearch && tabHasMatch.profile === false ? 'tab-dim' : ''}">
            <Icon name="user" size={14} /> Profile
          </Tabs.Trigger>
          <Tabs.Trigger value="appearance" class="settings-tab-trigger {settingsSearch && tabHasMatch.appearance === false ? 'tab-dim' : ''}">
            <Icon name="palette" size={14} /> Appearance
          </Tabs.Trigger>

          <div class="tabs-group-label">Data</div>
          <Tabs.Trigger value="providers" class="settings-tab-trigger {settingsSearch && tabHasMatch.providers === false ? 'tab-dim' : ''}">
            <Icon name="server" size={14} /> Providers
          </Tabs.Trigger>
          <Tabs.Trigger value="connections" class="settings-tab-trigger {settingsSearch && tabHasMatch.connections === false ? 'tab-dim' : ''}">
            <Icon name="folder" size={14} /> Connections
          </Tabs.Trigger>

          <div class="tabs-group-label warn">Network &amp; security</div>
          <Tabs.Trigger
            value="network"
            class="settings-tab-trigger settings-tab-trigger-guarded {settingsSearch && tabHasMatch.network === false ? 'tab-dim' : ''}"
          >
            <Icon name="network" size={14} /> Network
          </Tabs.Trigger>
          <Tabs.Trigger
            value="server"
            class="settings-tab-trigger settings-tab-trigger-guarded {settingsSearch && tabHasMatch.server === false ? 'tab-dim' : ''}"
          >
            <Icon name="server" size={14} /> Server
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="appearance" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "appearance", query: settingsSearch }}>
          <section class="settings-section">
            <h3 class="section-heading">Look</h3>

            <div class="field">
              <span class="label">Mode</span>
              <div class="mode-cards">
                {#each [{ id: "system", label: "System", icon: "contrast-2" }, { id: "dark", label: "Dark", icon: "half-moon" }, { id: "light", label: "Light", icon: "sun-light" }] as mode (mode.id)}
                  <button
                    type="button"
                    class="mode-card"
                    class:active={app.settings.theme === mode.id}
                    onclick={() => ((app.settings.theme = mode.id as typeof app.settings.theme), apply())}
                  >
                    <div class="mode-skeleton" style="background: {skeletonBg(mode.id)}">
                      <span class="sk-bar" style="background: {skeletonLine(mode.id)}"></span>
                      <div class="sk-body">
                        <span class="sk-side" style="background: {skeletonLine(mode.id)}"></span>
                        <div class="sk-lines">
                          <span class="sk-line" style="background: {skeletonLine(mode.id)}"></span>
                          <span class="sk-line short" style="background: {skeletonLine(mode.id)}"></span>
                          <div class="sk-toggles">
                            <span class="sk-toggle on" style="background: {app.settings.accent}"></span>
                            <span class="sk-toggle off" style="background: {skeletonLine(mode.id)}"></span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <span class="mode-card-label"><Icon name={mode.icon as any} size={12} /> {mode.label}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="field">
              <span class="label">Accent</span>
              <div class="accent-row">
                <button
                  type="button"
                  class="swatch wallpaper-swatch"
                  class:active={app.settings.accentFromWallpaper}
                  disabled={!app.settings.wallpaper}
                  title={app.settings.wallpaper ? "Use the wallpaper's color" : "Set a wallpaper below to use this"}
                  onclick={() => onAccentFromWallpaperToggle(true)}
                >
                  {#if app.settings.wallpaper}
                    <img src={app.settings.wallpaper} alt="" />
                  {:else}
                    <Icon name="media-image" size={12} />
                  {/if}
                </button>
                <input
                  type="range"
                  class="hue-slider"
                  min="0"
                  max="360"
                  step="1"
                  value={hue}
                  style="--thumb-color: {app.settings.accent}"
                  oninput={(e) => onHueInput(Number(e.currentTarget.value))}
                />
              </div>
              {#if extracting}<p class="hint">Reading colors from the wallpaper…</p>{/if}
            </div>

            <div class="field">
              <div class="setting-row">
                <div class="setting-text">
                  <span class="label">New-chat wallpaper</span>
                  <p class="hint">Shown behind an empty thread's composer.</p>
                </div>
                <div class="wallpaper-setting-controls">
                  <div class="wallpaper-thumb">
                    {#if app.settings.wallpaper}
                      <img src={app.settings.wallpaper} alt="" />
                    {:else}
                      <Icon name="media-image" size={14} />
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="icon-btn"
                    onclick={() => wallpaperInput?.click()}
                    title={app.settings.wallpaper ? "Change image" : "Choose image"}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  {#if app.settings.wallpaper}
                    <button type="button" class="icon-btn" onclick={clearWallpaper} title="Remove image">
                      <Icon name="trash" size={13} />
                    </button>
                  {/if}
                </div>
              </div>
              <input bind:this={wallpaperInput} type="file" accept="image/*" hidden onchange={onWallpaperFile} />
              {#if app.settings.wallpaper}
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="label">Wallpaper shader</span>
                    <p class="hint">How the image is rendered behind the composer.</p>
                  </div>
                  <Dropdown
                    items={[
                      { value: "dither", label: "Dithered" },
                      { value: "scanlines", label: "Scanlines" },
                      { value: "ascii", label: "ASCII art" },
                      { value: "dotmatrix", label: "Dot matrix" },
                      { value: "gameboy", label: "GameBoy" }
                    ]}
                    bind:value={
                      () => app.settings.wallpaperStyle,
                      (v) => (
                        (app.settings.wallpaperStyle = v as "dither" | "scanlines" | "ascii" | "dotmatrix" | "gameboy"),
                        apply()
                      )
                    }
                    contentClass="above-modal"
                  />
                </div>
              {/if}
            </div>

            <div class="field">
              <div class="setting-row">
                <div class="setting-text">
                  <span class="label">Surfaces</span>
                  <p class="hint">
                    Frosted glass blurs everything that floats over the UI —
                    the composer, popup panels and dialogs, the idle pills and
                    the window chrome. The panels behind them stay solid.
                  </p>
                </div>
                <Dropdown
                  items={[
                    { value: "opaque", label: "Opaque" },
                    { value: "frosted", label: "Frosted glass" }
                  ]}
                  bind:value={
                    () => app.settings.surface,
                    (v) => (
                      (app.settings.surface = v as "opaque" | "frosted"),
                      apply()
                    )
                  }
                  contentClass="above-modal"
                />
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h3 class="section-heading">Typography</h3>
            <div class="field row">
              <label>
                UI font size
                <input type="number" min="11" max="20" bind:value={app.settings.uiFontSize} onchange={apply} />
              </label>
              <label>
                Code font size
                <input type="number" min="10" max="18" bind:value={app.settings.codeFontSize} onchange={apply} />
              </label>
            </div>
            <div class="field row">
              <label>
                UI font family
                <input type="text" bind:value={app.settings.uiFontFamily} onchange={apply} />
              </label>
              <label>
                Code font family
                <input type="text" bind:value={app.settings.codeFontFamily} onchange={apply} />
              </label>
            </div>
            <div class="field row-inline">
              <label class="checkbox">
                <Checkbox.Root
                  class="checkbox-box"
                  checked={app.settings.codeWrapLines}
                  onCheckedChange={(checked) => {
                    app.settings.codeWrapLines = checked;
                    apply();
                  }}
                >
                  {#snippet children({ checked })}
                    {#if checked}<Icon name="check" size={11} />{/if}
                  {/snippet}
                </Checkbox.Root>
                Wrap long lines in code blocks
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h3 class="section-heading">Behavior</h3>
            <div class="field">
              <span class="label">Animation speed ({app.settings.animationSpeed.toFixed(1)}×)</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                bind:value={app.settings.animationSpeed}
                oninput={apply}
              />
            </div>
            <div class="field">
              <span class="label">Auto-archive threads after (days)</span>
              <input type="number" min="1" max="365" bind:value={app.settings.autoArchiveDays} onchange={apply} />
            </div>
          </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="profile" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "profile", query: settingsSearch }}>
          <div class="field">
            <span class="label">Profile picture</span>
            <div class="avatar-row">
              <button
                type="button"
                class="avatar-preview"
                onclick={() => avatarInput?.click()}
                title="Choose a picture"
                disabled={uploadingAvatar}
              >
                {#if isPhotoAvatar(app.settings.profileAvatar)}
                  <img src={app.settings.profileAvatar} alt="" />
                {:else}
                  <span class="emoji">{app.settings.profileAvatar || "🐣"}</span>
                {/if}
                <span class="avatar-edit"><Icon name="media-image" size={13} /></span>
              </button>
              <div class="avatar-side">
                <div class="avatar-actions">
                  <button type="button" class="primary-ish" onclick={() => avatarInput?.click()} disabled={uploadingAvatar}>
                    <Icon name="media-image" size={13} />
                    {uploadingAvatar ? "Reading…" : isPhotoAvatar(app.settings.profileAvatar) ? "Replace picture" : "Choose picture"}
                  </button>
                  {#if isPhotoAvatar(app.settings.profileAvatar)}
                    <button type="button" onclick={() => setEmojiAvatar(QUICK_AVATARS[0])}>Remove</button>
                  {/if}
                </div>
                <p class="hint">
                  Stored on this device and sent to the server when you connect, so other devices see it in the peer
                  list. Cropped square and downscaled to 96×96 before it leaves here.
                </p>
                <div class="quick-avatars">
                  {#each QUICK_AVATARS as emoji (emoji)}
                    <button
                      type="button"
                      class="quick-avatar"
                      class:active={app.settings.profileAvatar === emoji}
                      title="Use {emoji} instead of a picture"
                      onclick={() => setEmojiAvatar(emoji)}
                    >
                      {emoji}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
            <input bind:this={avatarInput} type="file" accept="image/*" hidden onchange={onAvatarFile} />
          </div>
          <div class="field">
            <span class="label">Display name</span>
            <input
              type="text"
              placeholder="anonymous"
              bind:value={app.settings.profileName}
              onchange={onProfileNameChange}
            />
          </div>
          <p class="hint">
            Sent to other connected peers as your name/picture (§2a `auth`, `set_peer_name`/`set_peer_avatar`) — the
            same values shown in the sidebar and in your own row under Network.
          </p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="providers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "providers", query: settingsSearch }}>
          <p class="hint">Registered once, available to every project and session on this server (§6c).</p>

          <div class="cli-cards">
            <div class="cli-card">
              <LobeIcon name="claude" size={20} />
              <div class="cli-card-text">
                <span class="cli-card-title">Claude subscription</span>
                <span class="hint" class:warn={!app.cliAvailability.claude}>
                  {#if !app.cliAvailability.claude}
                    <Icon name="warning" size={11} /> `claude` CLI not found on the server's PATH.
                  {:else}
                    Uses your own Claude subscription — yoakeland never sees a credential.
                  {/if}
                </span>
              </div>
              <label class="switch-row" title={!claudeProvider && !app.cliAvailability.claude ? "Install and sign in to the `claude` CLI first" : ""}>
                <Switch.Root
                  class="switch-root"
                  checked={!!claudeProvider}
                  disabled={!claudeProvider && !app.cliAvailability.claude}
                  onCheckedChange={(checked) => toggleCli("cli_claude", claudeProvider, checked)}
                >
                  <Switch.Thumb class="switch-thumb" />
                </Switch.Root>
              </label>
            </div>
            <div class="cli-card">
              <LobeIcon name="openai" size={20} />
              <div class="cli-card-text">
                <span class="cli-card-title">Codex subscription</span>
                <span class="hint" class:warn={!app.cliAvailability.codex}>
                  {#if !app.cliAvailability.codex}
                    <Icon name="warning" size={11} /> `codex` CLI not found on the server's PATH.
                  {:else}
                    Uses your own ChatGPT subscription — yoakeland never sees a credential.
                  {/if}
                </span>
              </div>
              <label class="switch-row" title={!codexProvider && !app.cliAvailability.codex ? "Install and sign in to the `codex` CLI first" : ""}>
                <Switch.Root
                  class="switch-root"
                  checked={!!codexProvider}
                  disabled={!codexProvider && !app.cliAvailability.codex}
                  onCheckedChange={(checked) => toggleCli("cli_codex", codexProvider, checked)}
                >
                  <Switch.Thumb class="switch-thumb" />
                </Switch.Root>
              </label>
            </div>
          </div>

          {#if app.providers.some((p) => p.kind === "api_key")}
            <ul class="provider-list">
              {#each app.providers.filter((p) => p.kind === "api_key") as p (p.name)}
                <li>
                  <span class="pname">{p.name}</span>
                  <span class="pkind">{p.httpProvider}</span>
                  <button class="remove" onclick={() => onRemoveProvider(p.name)} title="Remove">
                    <Icon name="xmark" size={12} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <form class="provider-form" onsubmit={submitProvider}>
            <label>
              Name
              <input bind:value={providerName} placeholder="my-anthropic" />
            </label>
            <label>
              Provider
              <select bind:value={httpProvider}>
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
                <option value="openrouter">openrouter</option>
              </select>
            </label>
            <label>
              API key
              <input bind:value={apiKey} type="password" placeholder="sk-..." />
            </label>
            <label>
              Base URL (optional)
              <input bind:value={baseUrl} placeholder="http://localhost:11434/v1" />
            </label>
            <button class="primary-ish" type="submit" disabled={!providerName.trim() || !apiKey.trim()}>
              Register
            </button>
          </form>
          </div>
        </Tabs.Content>

        <Tabs.Content value="connections" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "connections", query: settingsSearch }}>
          <p class="hint">
            Saved project paths, offered from the sidebar's project dropdown — no native file dialog for everyday
            switching. "Browse…" is the one place that still opens one, for adding a folder that isn't saved yet.
          </p>
          <ul class="paths">
            {#each app.recentProjects as path (path)}
              <li>
                <Icon name="folder" size={13} />
                <span class="path-name" title={path}>{basename(path)}</span>
                <span class="path-full" title={path}>{path}</span>
                <button type="button" class="remove" onclick={() => app.forgetProject(path)} title="Remove">
                  <Icon name="xmark" size={11} />
                </button>
              </li>
            {:else}
              <li class="empty">No saved paths yet.</li>
            {/each}
          </ul>
          <button type="button" class="browse" onclick={() => browseAndAddProject()}>
            <Icon name="plus" size={13} /> Browse…
          </button>
          </div>
        </Tabs.Content>

        <Tabs.Content value="network" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "network", query: settingsSearch }}>
          {#if app.connectionStatus !== "connected"}
            <p class="pending"><Icon name="warning" size={13} /> Not connected — connect to see the peer list.</p>
          {:else}
            <p class="hint">
              Every connection currently open on this server (unix and TCP alike) — pushed live, updates instantly.
            </p>
            <ul class="peers">
              {#each app.peers as peer (peer.peerId)}
                <li>
                  {#if peer.avatar}
                    <img class="peer-avatar" src={peer.avatar} alt="" />
                  {:else}
                    <span class="peer-avatar placeholder"><Icon name={deviceIcon[peer.deviceType] ?? "laptop"} size={13} /></span>
                  {/if}
                  <div class="peer-info">
                    <span class="peer-name">{peer.name}</span>
                    <span class="peer-meta">
                      <Icon name={deviceIcon[peer.deviceType] ?? "laptop"} size={11} />
                      {peer.deviceType}{peer.ip ? ` · ${peer.ip}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="remove"
                    onclick={() => onDisconnectPeer(peer.peerId, peer.name)}
                    title="Disconnect peer"
                  >
                    <Icon name="user-x" size={13} />
                  </button>
                </li>
              {:else}
                <li class="empty">No peers connected.</li>
              {/each}
            </ul>
          {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="server" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "server", query: settingsSearch }}>
          {#if app.connectionStatus !== "connected"}
            <p class="pending"><Icon name="warning" size={13} /> Not connected.</p>
          {:else if !isLocalConnection}
            <p class="pending">
              <Icon name="warning" size={13} /> Remote-access and password controls are local-socket-only — the
              server rejects them over TCP (§3.1). Connect locally to change them.
            </p>
          {/if}
          <div class="warning-card">
            <p class="section-heading warning-heading">
              <Icon name="warning" size={12} /> Network exposure
            </p>
            <div class="field row-inline">
              <label class="checkbox" class:disabled={!isLocalConnection}>
                <Checkbox.Root
                  class="checkbox-box"
                  checked={app.remoteAccessEnabled ?? false}
                  disabled={!isLocalConnection}
                  onCheckedChange={onRemoteAccessToggle}
                >
                  {#snippet children({ checked })}
                    {#if checked}<Icon name="check" size={11} />{/if}
                  {/snippet}
                </Checkbox.Root>
                Enable remote (TCP) access
              </label>
            </div>
            <form class="field" onsubmit={submitRemotePassword}>
              <span class="label">Remote access password</span>
              <div class="row-with-button">
                <input
                  type="password"
                  placeholder="new shared secret"
                  bind:value={remotePasswordInput}
                  disabled={!isLocalConnection}
                />
                <button type="submit" disabled={!isLocalConnection || !remotePasswordInput}>Set</button>
              </div>
            </form>
          </div>
          <div class="field row-inline">
            <label class="checkbox">
              <Checkbox.Root
                class="checkbox-box"
                checked={app.autoGenerateTitleEnabled ?? true}
                onCheckedChange={onAutoGenerateTitleToggle}
              >
                {#snippet children({ checked })}
                  {#if checked}<Icon name="check" size={11} />{/if}
                {/snippet}
              </Checkbox.Root>
              Auto-generate chat titles
            </label>
          </div>
          <form class="field" onsubmit={submitServerIdentity}>
            <span class="label">Server identity</span>
            <div class="row-with-button">
              <input type="text" placeholder="this server's display name" bind:value={serverIdentityInput} />
              <button type="submit" disabled={!serverIdentityInput.trim()}>Set</button>
            </div>
          </form>

          <section class="settings-section">
            <h3 class="section-heading">People with access</h3>
            <p class="hint">
              Per-person tokens for remote access, instead of sharing one password. Each name is fixed once
              registered — revoke and re-register to rename. Chat and git commits from a token-backed connection are
              attributed to that name.
            </p>

            {#if app.justRegisteredToken}
              <div class="warning-card">
                <p class="section-heading warning-heading"><Icon name="warning" size={12} /> Copy this now</p>
                <p class="hint">
                  Token for <strong>{app.justRegisteredToken.name}</strong> — shown only this once, there's no way to
                  retrieve it again.
                </p>
                <div class="row-with-button">
                  <input type="text" readonly value={app.justRegisteredToken.token} onclick={(e) => (e.target as HTMLInputElement).select()} />
                  <button
                    type="button"
                    onclick={() => {
                      void navigator.clipboard?.writeText(app.justRegisteredToken!.token);
                      app.justRegisteredToken = null;
                    }}
                  >
                    Copy &amp; dismiss
                  </button>
                </div>
              </div>
            {/if}

            <ul class="peers">
              {#each app.tokens as token (token.name)}
                <li>
                  <span class="peer-avatar placeholder"><Icon name="user" size={13} /></span>
                  <div class="peer-info">
                    <span class="peer-name">{token.name}</span>
                    <span class="peer-meta">{token.email ?? "no email set"}</span>
                  </div>
                  <button
                    type="button"
                    class="remove"
                    onclick={() => onRemoveToken(token.name)}
                    disabled={!isLocalConnection}
                    title="Revoke access"
                  >
                    <Icon name="user-x" size={13} />
                  </button>
                </li>
              {:else}
                <li class="empty">No tokens registered.</li>
              {/each}
            </ul>

            <form class="field row-inline" onsubmit={submitToken}>
              <input type="text" placeholder="name" bind:value={tokenNameInput} disabled={!isLocalConnection} />
              <input
                type="email"
                placeholder="email (optional, for git commits)"
                bind:value={tokenEmailInput}
                disabled={!isLocalConnection}
              />
              <button type="submit" disabled={!isLocalConnection || !tokenNameInput.trim()}>Register</button>
            </form>
          </section>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims, deliberately without blurring: what's behind a modal stays legible as
     the app you came from, and the dialog card above it is the one thing that
     frosts (see --float-blur below) — the two layers blurring as well as dimming
     just muddies the whole screen and stops the card reading as a pane of glass
     over it. */
  :global(.settings-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.5);
    z-index: var(--z-overlay-backdrop);
    animation: settingsFade calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(48.57rem, 92vw);
    height: min(40rem, 85vh);
    display: flex;
    flex-direction: column;
    /* A dialog card is a floating surface like any other — see the --float-*
       tokens in app.css. Opaque mode leaves it exactly as the plain panel it
       used to be; frosted makes the dialog translucent over the dimmed app
       behind it. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
    animation: settingsIn calc(0.18s * var(--anim-speed, 1)) ease;
  }
  /* Dropdown.svelte's popover is portalled to <body>, but its own z-index
     (--z-dropdown) sits below this modal's (--z-overlay-content) — bump it
     above so it isn't rendered behind the settings panel. */
  :global(.above-modal) {
    z-index: var(--z-context-menu);
  }
  @keyframes settingsFade {
    from { opacity: 0; }
  }
  @keyframes settingsIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.86rem;
    flex-shrink: 0;
  }
  .head :global(h2) {
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  :global(.settings-close) {
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
  :global(.settings-tabs) {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: 1rem;
    min-height: 0;
  }
  :global(.tabs-list) {
    flex-shrink: 0;
    width: 11rem;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
    padding-right: 0.71rem;
    border-right: 1px solid var(--panel-border);
  }
  .settings-search {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin-bottom: 0.71rem;
    padding: 0 0.57rem;
    height: var(--ctrl-h);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .settings-search:focus-within {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
  }
  .settings-search input[type="text"] {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 0.78rem;
    padding: 0;
    width: auto;
  }
  .settings-search .search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.14rem;
    border-radius: var(--radius-sm);
  }
  .settings-search .search-clear:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  :global(.settings-tab-trigger) {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.64rem;
    padding: 0.5rem 0.64rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.8rem;
    text-align: left;
    transition: background calc(0.1s * var(--anim-speed, 1)) ease, opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.settings-tab-trigger:hover) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  :global(.settings-tab-trigger[data-state="active"]) {
    background: var(--sidebar-active);
    color: var(--text);
    font-weight: 500;
  }
  :global(.settings-tab-trigger.tab-dim) {
    opacity: 0.35;
  }
  .tabs-group-label {
    margin: 0.71rem 0 0.21rem 0.64rem;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    opacity: 0.7;
  }
  .tabs-group-label:first-of-type {
    margin-top: 0;
  }
  .tabs-group-label.warn {
    color: var(--warning);
    opacity: 0.8;
  }
  :global(.settings-tab-trigger-guarded[data-state="active"]) {
    background: var(--danger-dim);
    color: var(--warning);
  }
  :global(.tab-panel) {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
    padding-right: var(--space-half);
  }
  :global(.tab-panel[hidden]) {
    display: none;
  }
  .tab-body {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
    padding-bottom: 1.14rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .settings-section:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
  .mode-cards {
    display: flex;
    gap: 0.57rem;
  }
  .mode-card {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    background: none;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    padding: 0.43rem;
    cursor: pointer;
  }
  .mode-card.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--panel-border));
    background: var(--accent-dim);
  }
  .mode-card-label {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .mode-card.active .mode-card-label {
    color: var(--text);
  }
  /* Each skeleton is colored with the *actual* derived theme for the current
     accent (see skeletonStyle() — set inline, per mode, not here) rather
     than a fixed gray, so the preview stays in step with whatever accent is
     picked instead of looking unrelated to it. Still shows Light's own
     palette while you're sitting in Dark mode, letting the three be compared
     side by side. */
  .mode-skeleton {
    width: 100%;
    height: 5.7rem;
    border-radius: calc(var(--radius-sm) - 2px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    padding: 0.36rem;
  }
  .sk-bar {
    display: block;
    height: 0.43rem;
    border-radius: 999px;
  }
  .sk-body {
    flex: 1;
    display: flex;
    gap: 0.21rem;
    min-height: 0;
  }
  .sk-side {
    width: 1rem;
    border-radius: 2px;
    opacity: 0.7;
  }
  .sk-lines {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.36rem;
  }
  .sk-line {
    display: block;
    height: 0.21rem;
    border-radius: 999px;
  }
  .sk-line.short {
    width: 60%;
  }
  .sk-toggles {
    display: flex;
    gap: 0.29rem;
    margin-top: 0.21rem;
  }
  .sk-toggle {
    width: 1rem;
    height: 0.5rem;
    border-radius: 999px;
  }
  .sk-toggle.off {
    opacity: 0.6;
  }
  .wallpaper-swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.06);
  }
  .wallpaper-swatch img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .wallpaper-swatch:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Track carries the actual rainbow (accurate hue → position mapping, since
     stops sit at exact 60° increments); the thumb matches the track's
     height exactly (box-sizing: border-box) so it fills the groove with no
     gap, and is colored to the live accent. */
  .hue-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 1.43rem;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      hsl(0 70% 65%),
      hsl(60 70% 65%),
      hsl(120 70% 65%),
      hsl(180 70% 65%),
      hsl(240 70% 65%),
      hsl(300 70% 65%),
      hsl(360 70% 65%)
    );
  }
  .hue-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    box-sizing: border-box;
    width: 1.43rem;
    height: 1.43rem;
    border-radius: 50%;
    background: var(--thumb-color);
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }
  .hue-slider::-moz-range-thumb {
    box-sizing: border-box;
    width: 1.43rem;
    height: 1.43rem;
    border-radius: 50%;
    background: var(--thumb-color);
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }
  .hue-slider::-moz-range-track {
    height: 1.43rem;
    border-radius: 999px;
    background: transparent;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .setting-text {
    display: flex;
    flex-direction: column;
    gap: 0.21rem;
    min-width: 0;
  }
  .wallpaper-setting-controls {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.36rem;
  }
  .wallpaper-thumb {
    width: 2.86rem;
    height: 1.86rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    overflow: hidden;
  }
  .wallpaper-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .icon-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.86rem;
    height: 1.86rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--sidebar-hover);
  }
  :global(.search-dim) {
    opacity: 0.3;
    filter: saturate(0.6);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .field.row {
    flex-direction: row;
    gap: 0.71rem;
  }
  .field.row label {
    flex: 1;
  }
  .field.row-inline {
    flex-direction: row;
  }
  .label {
    font-size: var(--text-label-size);
    font-weight: var(--text-label-weight);
    color: var(--text-dim);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    font-size: var(--text-label-size);
    font-weight: var(--text-label-weight);
    color: var(--text-dim);
  }
  .section-heading {
    margin: 0;
    font-size: var(--text-heading-size);
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .checkbox {
    flex-direction: row;
    align-items: center;
    gap: var(--space-1);
  }
  .checkbox.disabled {
    opacity: 0.5;
  }
  input[type="text"],
  input[type="number"],
  input[type="password"],
  select {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.43rem 0.57rem;
    font-size: var(--text-body-size);
    width: 100%;
  }
  .accent-row {
    display: flex;
    align-items: center;
    gap: 0.71rem;
  }
  .swatch {
    width: 1.71rem;
    height: 1.71rem;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch.active {
    border-color: var(--text);
  }
  input[type="range"] {
    width: 100%;
  }
  .hint {
    margin: 0;
    font-size: 0.74rem;
    color: var(--text-dim);
  }
  .warning-card {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
    background: color-mix(in srgb, var(--warning) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 30%, var(--panel-border));
    border-radius: var(--radius-sm);
    padding: 0.86rem;
  }
  .warning-heading {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    color: var(--warning);
  }
  .pending {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin: 0;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .avatar-row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .avatar-preview {
    position: relative;
    flex-shrink: 0;
    width: 5.14rem;
    height: 5.14rem;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    cursor: pointer;
    padding: 0;
  }
  .avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-preview .emoji {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    line-height: 1;
  }
  .avatar-preview .avatar-edit {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.21rem 0;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .avatar-preview:hover .avatar-edit {
    opacity: 1;
  }
  .avatar-preview:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .avatar-side {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .avatar-actions {
    display: flex;
    gap: 0.43rem;
    flex-wrap: wrap;
  }
  .avatar-actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.43rem 0.79rem;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .avatar-actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .avatar-actions .primary-ish {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--panel-border));
  }
  .switch-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 0.8rem;
    color: var(--text);
    cursor: pointer;
  }
  :global(.switch-root) {
    position: relative;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    width: 2rem;
    height: 1.14rem;
    padding: 0.14rem;
    background: var(--sidebar-hover);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.switch-root[data-state="checked"]) {
    background: var(--accent);
    border-color: var(--accent);
  }
  :global(.switch-root[data-disabled]) {
    opacity: 0.5;
    cursor: default;
  }
  :global(.switch-thumb) {
    width: 0.86rem;
    height: 0.86rem;
    border-radius: 50%;
    background: var(--text);
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.switch-thumb[data-state="checked"]) {
    transform: translateX(0.86rem);
  }
  :global(.checkbox-box) {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: calc(var(--radius-sm) - 3px);
    color: var(--bg);
    cursor: pointer;
  }
  :global(.checkbox-box[data-state="checked"]) {
    background: var(--accent);
    border-color: var(--accent);
  }
  :global(.checkbox-box[data-disabled]) {
    opacity: 0.5;
    cursor: default;
  }
  .quick-avatars {
    display: flex;
    flex-wrap: wrap;
    gap: 0.43rem;
  }
  .quick-avatar {
    width: 2.14rem;
    height: 2.14rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: 50%;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .quick-avatar.active {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .paths li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.43rem 0.57rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
  }
  .paths li:hover {
    background: var(--sidebar-hover);
  }
  .paths li.empty {
    color: var(--text-dim);
  }
  .path-name {
    font-weight: 500;
  }
  .path-full {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: var(--text-heading-size);
  }
  .remove {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: var(--space-half);
    border-radius: var(--radius-sm);
  }
  .remove:hover {
    color: var(--danger);
  }
  .peers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .peers li {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    padding: 0.5rem 0.57rem;
    border-radius: var(--radius-sm);
  }
  .peers li:hover {
    background: var(--sidebar-hover);
  }
  .peers li.empty {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .peer-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .peer-avatar.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-dim);
  }
  .peer-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .peer-name {
    font-size: 0.83rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peer-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-half);
    font-size: 0.7rem;
    color: var(--text-dim);
  }
  .row-with-button {
    display: flex;
    gap: var(--space-1);
  }
  .row-with-button input {
    flex: 1;
  }
  .row-with-button button {
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0 1rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .row-with-button button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .cli-cards {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
  }
  .cli-card {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    padding: 0.71rem 0.86rem;
  }
  .cli-card-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.21rem;
  }
  .cli-card-title {
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .cli-card .switch-row {
    flex-shrink: 0;
  }
  .provider-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-half);
  }
  .provider-list li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    padding: 0.43rem 0.71rem;
    font-size: 0.8rem;
  }
  .pname {
    font-weight: 600;
  }
  .pkind {
    flex: 1;
    color: var(--text-dim);
    font-size: var(--text-heading-size);
  }
  .provider-form {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
  }
  .hint.warn {
    color: var(--danger);
  }
  .browse {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.86rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
</style>

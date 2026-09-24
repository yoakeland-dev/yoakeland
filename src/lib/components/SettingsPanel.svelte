<script lang="ts">
  // Two groups of pages: app-wide ones (Profile, Appearance, Terminal,
  // Servers — stored on this device) and server-scoped ones (General,
  // Providers, Projects, Access — stored on whichever server the page header
  // points at). Every scalar setting is one .setting-row: label + hint on
  // the left, its control on the right; toggles are always a Switch.
  import { Dialog, Tabs, Switch } from "bits-ui";
  import { untrack, type ComponentProps } from "svelte";
  import { app, forgetKnownServer, type ConnectionId } from "../state.svelte";
  import { basename } from "../format";
  import {
    browseAndAddProject,
    connectServerRow,
    disconnect,
    serverRows,
    type ServerRow,
    setPeerName,
    setPeerAvatar,
    disconnectPeer,
    removeServer,
    setRemoteAccess,
    setAutoGenerateTitle,
    setRemotePassword,
    setServerIdentity,
    registerProvider,
    removeProvider,
    registerToken,
    removeToken,
    removeProject,
  } from "../ipc";
  import { extractAccentFromImage, hexToHue, hslToHex, deriveTheme, TERMINAL_THEME_PRESETS } from "../theme";
  import { encodePairingCode } from "../pairing";
  import { isPhotoAvatar, photoAvatarDataUrl } from "../avatar";
  import type { CliKind, ProviderInfo } from "../types";
  import { CLI_AGENTS } from "../modelVendor";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import Dropdown from "./Dropdown.svelte";
  import SearchInput from "./SearchInput.svelte";
  import ConnectForm from "./ConnectForm.svelte";
  import Markdown from "./Markdown.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  const QUICK_AVATARS = ["🐣", "🦊", "🐙", "🐢", "🐝", "🐺"];

  // Everything server-scoped (providers, peers, tokens, remote-access state,
  // recent projects, ...) now lives on a connection's own ServerState — see
  // the multi-server-connections plan. Defaults to whichever connection the
  // rest of the app is focused on, but the picker below (Phase 4 — shown
  // only once there's more than one to pick from) can point these tabs at a
  // different one without changing what the main window is showing.
  let selectedConnectionId = $state<ConnectionId | null>(null);
  let cid = $derived(selectedConnectionId ?? app.activeConnectionId);
  let server = $derived(cid ? app.servers[cid] : null);
  const serverItems = $derived(Object.entries(app.servers).map(([id, s]) => ({ value: id, label: s.label })));

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
    if (!cid || !providerName.trim()) return;
    registerProvider(cid, {
      name: providerName,
      kind: "api_key",
      httpProvider,
      apiKey,
      baseUrl: baseUrl || undefined,
      authMethod: "manual",
    });
    resetProviderForm();
  }

  // Subscription CLIs are a one-per-machine login, not a named credential
  // you'd ever want two of — so unlike api_key/OpenRouter, these get a fixed
  // name and a plain on/off switch instead of a registration form. (The
  // wire protocol still requires a `name` on register_provider.)
  const cliRows = $derived(
    (Object.entries(CLI_AGENTS) as [CliKind, (typeof CLI_AGENTS)[CliKind]][]).map(([kind, meta]) => ({
      kind,
      ...meta,
      existing: server?.providers.find((p) => p.kind === kind),
      available: !!server?.cliAvailability[kind],
    })),
  );

  function toggleCli(kind: CliKind, existing: ProviderInfo | undefined, enabled: boolean) {
    if (!cid) return;
    if (enabled) {
      registerProvider(cid, { name: CLI_AGENTS[kind].defaultName, kind, authMethod: "manual" });
    } else if (existing) {
      removeProvider(cid, existing.name);
    }
  }

  let remotePasswordInput = $state("");
  let serverIdentityInput = $state("");
  $effect(() => {
    if (server?.serverIdentity != null) serverIdentityInput = server.serverIdentity;
  });

  const connected = $derived(server?.connectionStatus === "connected");
  const isLocalConnection = $derived(connected && server?.connectionMode === "local");

  function onProfileNameChange() {
    apply();
    if (cid) setPeerName(cid, app.settings.profileName || "anonymous");
  }

  function pushAvatar() {
    apply();
    if (cid) setPeerAvatar(cid, app.settings.profileAvatar);
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

  function onRemoveServer(id: ConnectionId, label: string) {
    if (!confirm(`Remove "${label}"? Disconnects it and stops offering it for reconnect.`)) return;
    if (selectedConnectionId === id) selectedConnectionId = null;
    void removeServer(id);
  }

  // ---- Servers tab ----
  // serverRows() reads remembered servers from localStorage (not reactive),
  // so forgetting one bumps this to re-derive.
  let serversVersion = $state(0);
  const serverList = $derived.by(() => {
    void serversVersion;
    return serverRows();
  });
  // Non-null while the add form is open — {} for a blank one, or a
  // remembered remote's address (app.openAddServer, e.g. from the palette).
  let addPrefill = $state<{ host?: string; port?: number } | null>(null);
  $effect(() => {
    const req = app.addServerRequest;
    if (!req) return;
    addPrefill = req;
    app.addServerRequest = null;
  });

  function onRemoveRow(r: ServerRow) {
    if (r.connectionId) onRemoveServer(r.connectionId, r.label);
    else if (r.known && confirm(`Forget "${r.label}"? It stops being offered for reconnect.`)) forgetKnownServer(r.known.serverId);
    serversVersion++;
  }

  function onDisconnectPeer(peerId: string, name: string) {
    if (cid && confirm(`Disconnect "${name}"? Any peer can disconnect any other — there's no extra permission check.`)) {
      disconnectPeer(cid, peerId);
    }
  }

  function onRemoveProvider(name: string) {
    if (cid && confirm(`Remove provider "${name}"? This can't be undone.`)) {
      removeProvider(cid, name);
    }
  }

  function onRemoteAccessToggle(checked: boolean) {
    if (cid) setRemoteAccess(cid, checked);
  }

  function onAutoGenerateTitleToggle(checked: boolean) {
    if (cid) setAutoGenerateTitle(cid, checked);
  }

  function submitRemotePassword(e: Event) {
    e.preventDefault();
    if (!cid || !remotePasswordInput) return;
    setRemotePassword(cid, remotePasswordInput);
    remotePasswordInput = "";
  }

  function submitServerIdentity(e: Event) {
    e.preventDefault();
    if (!cid || !serverIdentityInput.trim()) return;
    setServerIdentity(cid, serverIdentityInput.trim());
  }

  let tokenNameInput = $state("");
  let tokenEmailInput = $state("");

  function submitToken(e: Event) {
    e.preventDefault();
    if (!cid || !tokenNameInput.trim()) return;
    registerToken(cid, tokenNameInput.trim(), tokenEmailInput.trim() || undefined);
    tokenNameInput = "";
    tokenEmailInput = "";
  }

  function onRemoveToken(name: string) {
    if (cid && confirm(`Revoke "${name}"'s access? They'll be logged out on their next reconnect.`)) {
      removeToken(cid, name);
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

  // Interface scale: uiFontSize is the root font size every rem hangs off,
  // shown as a percentage of the 14px default. Applied on release, not per
  // step — rescaling the whole UI under the pointer mid-drag moves the
  // slider away from it.
  const BASE_UI_FONT_SIZE = 14;
  let scalePct = $state(Math.round((app.settings.uiFontSize / BASE_UI_FONT_SIZE) * 100));
  function applyScale() {
    app.settings.uiFontSize = (BASE_UI_FONT_SIZE * scalePct) / 100;
    apply();
  }

  const CODE_PREVIEW = [
    "```ts",
    "// Greets everyone connected to this server",
    "export async function greet(peers: Peer[], prefix = \"hi\"): Promise<number> {",
    "  for (const p of peers) console.log(`${prefix}, ${p.name}!`);",
    "  return peers.length * 42;",
    "}",
    "```",
  ].join("\n");

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

  // ---- Search: dims non-matching tabs, rows and section headings (rather
  // than hiding them, so the page doesn't reflow under you), and jumps to the
  // first tab with a match when the open one has none. Every tab's content
  // stays mounted (bits-ui only toggles `hidden`), so all of them are indexed.
  const TAB_ORDER = ["profile", "appearance", "terminal", "servers", "general", "providers", "projects", "access"];
  const TAB_LABELS: Record<string, string> = {
    profile: "profile you name avatar picture",
    appearance: "appearance look theme fonts",
    terminal: "terminal shell colors",
    servers: "servers connections remote",
    general: "general server name titles",
    providers: "providers models api keys subscriptions",
    projects: "projects folders paths",
    access: "access network remote password tokens peers people",
  };
  let settingsSearch = $state("");
  let tabHasMatch = $state<Record<string, boolean>>({});
  let firstMatchByTab: Record<string, HTMLElement | null> = {};

  function searchable(node: HTMLElement, params: { tab: string; query: string }) {
    function update({ tab, query }: { tab: string; query: string }) {
      const q = query.trim().toLowerCase();
      // Searching a tab's own name lights up the whole tab.
      const wholeTab = !!q && TAB_LABELS[tab].includes(q);
      const rows = node.querySelectorAll<HTMLElement>(
        ".field, .setting-row, .cli-card, .provider-form, .list > li",
      );
      let first: HTMLElement | null = null;
      rows.forEach((row) => {
        const matches = !q || wholeTab || (row.textContent ?? "").toLowerCase().includes(q);
        row.classList.toggle("search-dim", !matches);
        if (matches && q && !first) first = row;
      });
      node.querySelectorAll<HTMLElement>(".settings-section").forEach((section) => {
        const heading = section.querySelector<HTMLElement>(".section-heading");
        const lit =
          !q ||
          wholeTab ||
          !!section.querySelector(
            ".field:not(.search-dim), .setting-row:not(.search-dim), .cli-card:not(.search-dim), .provider-form:not(.search-dim), li:not(.search-dim)",
          );
        heading?.classList.toggle("search-dim", !lit);
      });
      firstMatchByTab[tab] = first;
      // A per-key write, never a read-then-assign: this runs inside the
      // action's own update effect, and reading tabHasMatch here would make
      // that effect depend on what it writes (an infinite update loop).
      tabHasMatch[tab] = !q || wholeTab || !!first;
    }
    update(params);
    return { update };
  }

  const noMatches = $derived(!!settingsSearch.trim() && TAB_ORDER.every((t) => tabHasMatch[t] === false));

  // Re-runs when the matches change (i.e. per query), not when the user
  // clicks a tab — so manually opening a non-matching tab doesn't bounce.
  $effect(() => {
    if (!settingsSearch.trim()) return;
    const matches = Object.fromEntries(TAB_ORDER.map((t) => [t, tabHasMatch[t]]));
    untrack(() => {
      if (matches[app.settingsTab] === false) {
        const next = TAB_ORDER.find((t) => matches[t]);
        if (next) app.settingsTab = next;
      }
      firstMatchByTab[app.settingsTab]?.scrollIntoView({ block: "nearest" });
    });
  });

</script>

{#snippet pageHead(title: string, scoped: boolean)}
  <header class="page-head">
    <h2>{title}</h2>
    {#if scoped && serverItems.length > 1}
      <Dropdown
        items={serverItems}
        bind:value={() => cid ?? undefined, (v) => (selectedConnectionId = v ?? null)}
        triggerTitle="Which server these settings apply to"
        contentClass="above-modal"
      />
    {:else if scoped && server}
      <span class="scope">
        <ServerAvatar name={server.label} seed={server.serverId} size={16} />
        {server.label}
      </span>
    {/if}
  </header>
  {#if scoped && !connected}
    <p class="notice">
      <Icon name="warning" size={13} />
      {server ? `${server.label} isn't connected — reconnect it` : "No server connected — connect one"} under Servers to change these.
    </p>
  {/if}
{/snippet}

{#snippet rowText(label: string, hint?: string)}
  <div class="setting-text">
    <span class="row-label">{label}</span>
    {#if hint}<p class="hint">{hint}</p>{/if}
  </div>
{/snippet}

{#snippet toggle(checked: boolean, onChange: (v: boolean) => void, disabled = false)}
  <Switch.Root class="switch-root" {checked} {disabled} onCheckedChange={onChange}>
    <Switch.Thumb class="switch-thumb" />
  </Switch.Root>
{/snippet}

<!-- A handful of mutually exclusive options, all visible at once — a
     dropdown only earns its extra click once the list is too long to show. -->
{#snippet segmented(options: { value: string; label: string }[], value: string, pick: (v: string) => void)}
  <div class="segmented" role="radiogroup">
    {#each options as o (o.value)}
      <button type="button" role="radio" aria-checked={o.value === value} class:active={o.value === value} onclick={() => pick(o.value)}>
        {o.label}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet presetPicker(get: () => string, set: (v: string) => void)}
  <Dropdown items={TERMINAL_THEME_PRESETS.map((p) => ({ value: p.id, label: p.name }))} bind:value={get, set} contentClass="above-modal">
    {#snippet item({ value, label, selected })}
      {@const preset = TERMINAL_THEME_PRESETS.find((p) => p.id === value)}
      <span class="term-theme-swatch" style="background: {preset?.colors.background}">
        <span style="background: {preset?.colors.red}"></span>
        <span style="background: {preset?.colors.green}"></span>
        <span style="background: {preset?.colors.blue}"></span>
      </span>
      <span class="dropdown-item-label">{label}</span>
      {#if selected}<Icon name="check" size={11} />{/if}
    {/snippet}
  </Dropdown>
{/snippet}

{#snippet tab(value: string, label: string, icon: ComponentProps<typeof Icon>["name"])}
  <Tabs.Trigger value={value} class="settings-tab-trigger {settingsSearch && tabHasMatch[value] === false ? 'tab-dim' : ''}">
    <Icon name={icon} size={14} /> {label}
  </Tabs.Trigger>
{/snippet}

<Dialog.Root bind:open={app.showSettings}>
  <Dialog.Portal>
    <Dialog.Overlay class="settings-overlay" />
    <Dialog.Content class="settings-content">
      <Dialog.Close class="settings-close" aria-label="Close settings"><Icon name="xmark" size={14} /></Dialog.Close>

      <Tabs.Root bind:value={app.settingsTab} orientation="vertical" class="settings-tabs">
        <Tabs.List class="tabs-list">
          <Dialog.Title class="settings-title">Settings</Dialog.Title>
          <div class="settings-search"><SearchInput bind:value={settingsSearch} placeholder="Search settings…" /></div>
          {#if noMatches}<div class="no-matches">No settings match “{settingsSearch.trim()}”</div>{/if}

          <div class="tabs-group-label">App</div>
          {@render tab("profile", "Profile", "user")}
          {@render tab("appearance", "Appearance", "palette")}
          {@render tab("terminal", "Terminal", "terminal-2")}
          {@render tab("servers", "Servers", "server")}

          <div class="tabs-group-label" title="These apply to one server — pick which at the top of each page">
            {server ? server.label : "Server"}
          </div>
          {@render tab("general", "General", "settings")}
          {@render tab("providers", "Providers", "brain")}
          {@render tab("projects", "Projects", "folder")}
          {@render tab("access", "Access", "network")}
        </Tabs.List>

        <Tabs.Content value="profile" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "profile", query: settingsSearch }}>
            {@render pageHead("Profile", false)}
            <section class="settings-section">
              <div class="field">
                <span class="row-label">Picture</span>
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
                    <div class="btn-row">
                      <button type="button" class="btn" onclick={() => avatarInput?.click()} disabled={uploadingAvatar}>
                        <Icon name="media-image" size={13} />
                        {uploadingAvatar ? "Reading…" : isPhotoAvatar(app.settings.profileAvatar) ? "Replace picture" : "Choose picture"}
                      </button>
                      {#if isPhotoAvatar(app.settings.profileAvatar)}
                        <button type="button" class="btn ghost" onclick={() => setEmojiAvatar(QUICK_AVATARS[0])}>Remove</button>
                      {/if}
                    </div>
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
                    <p class="hint">Cropped square and scaled to 96×96 before it leaves this device.</p>
                  </div>
                </div>
                <input bind:this={avatarInput} type="file" accept="image/*" hidden onchange={onAvatarFile} />
              </div>
              <div class="setting-row">
                {@render rowText("Display name", "How you appear to other people on the servers you connect to.")}
                <input
                  type="text"
                  class="ctrl-wide"
                  placeholder="anonymous"
                  bind:value={app.settings.profileName}
                  onchange={onProfileNameChange}
                />
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="appearance" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "appearance", query: settingsSearch }}>
            {@render pageHead("Appearance", false)}
            <section class="settings-section">
              <h3 class="section-heading">Theme</h3>
              <div class="field">
                <span class="row-label">Mode</span>
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
                <span class="row-label">Accent</span>
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

              <div class="setting-row">
                {@render rowText("New-chat wallpaper", "Shown behind an empty thread's composer.")}
                <div class="btn-row">
                  <div class="wallpaper-thumb">
                    {#if app.settings.wallpaper}
                      <img src={app.settings.wallpaper} alt="" />
                    {:else}
                      <Icon name="media-image" size={14} />
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="btn icon"
                    onclick={() => wallpaperInput?.click()}
                    title={app.settings.wallpaper ? "Change image" : "Choose image"}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  {#if app.settings.wallpaper}
                    <button type="button" class="btn icon danger" onclick={clearWallpaper} title="Remove image">
                      <Icon name="trash" size={13} />
                    </button>
                  {/if}
                </div>
              </div>
              <input bind:this={wallpaperInput} type="file" accept="image/*" hidden onchange={onWallpaperFile} />
              {#if app.settings.wallpaper}
                <div class="setting-row">
                  {@render rowText("Wallpaper shader", "How the image is rendered behind the composer.")}
                  <Dropdown
                    items={[
                      { value: "dither", label: "Dithered" },
                      { value: "scanlines", label: "Scanlines" },
                      { value: "ascii", label: "ASCII art" },
                      { value: "dotmatrix", label: "Dot matrix" },
                      { value: "gameboy", label: "GameBoy" },
                    ]}
                    bind:value={
                      () => app.settings.wallpaperStyle,
                      (v) => ((app.settings.wallpaperStyle = v as "dither" | "scanlines" | "ascii" | "dotmatrix" | "gameboy"), apply())
                    }
                    contentClass="above-modal"
                  />
                </div>
              {/if}

              <div class="setting-row">
                {@render rowText("Main area", "Floating insets the chat area as a rounded card; flat fills the window edge to edge.")}
                {@render segmented(
                  [
                    { value: "floating", label: "Floating" },
                    { value: "flat", label: "Flat" },
                  ],
                  app.settings.mainArea,
                  (v) => ((app.settings.mainArea = v as "floating" | "flat"), apply()),
                )}
              </div>

              <div class="setting-row">
                {@render rowText("Surfaces", "Frosted glass blurs whatever floats over the UI — the composer, popups and dialogs.")}
                {@render segmented(
                  [
                    { value: "opaque", label: "Opaque" },
                    { value: "frosted", label: "Frosted" },
                  ],
                  app.settings.surface,
                  (v) => ((app.settings.surface = v as "opaque" | "frosted"), apply()),
                )}
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">Typography</h3>
              <div class="setting-row">
                {@render rowText("Interface font")}
                <input type="text" class="ctrl-wide" bind:value={app.settings.uiFontFamily} onchange={apply} />
              </div>
              <div class="setting-row">
                {@render rowText("Interface scale", "Scales text and spacing across the whole app.")}
                <div class="slider">
                  <input type="range" min="80" max="140" step="5" bind:value={scalePct} onchange={applyScale} />
                  <span class="slider-value">{scalePct}%</span>
                </div>
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">Code blocks</h3>
              <div class="code-preview"><Markdown text={CODE_PREVIEW} /></div>
              <div class="setting-row">
                {@render rowText("Font")}
                <input type="text" class="ctrl-wide" bind:value={app.settings.codeFontFamily} onchange={apply} />
              </div>
              <div class="setting-row">
                {@render rowText("Font size")}
                <div class="with-unit">
                  <input type="number" class="ctrl-num" min="10" max="18" step="0.5" bind:value={app.settings.codeFontSize} onchange={apply} />
                  <span>px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Wrap long lines", "Off scrolls them sideways instead.")}
                {@render toggle(app.settings.codeWrapLines, (v) => ((app.settings.codeWrapLines = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText("Use app theme colors", "Colors syntax from your accent and mode instead of a preset.")}
                {@render toggle(app.settings.codeUseAppTheme, (v) => ((app.settings.codeUseAppTheme = v), apply()))}
              </div>
              <div class="setting-row" class:disabled-row={app.settings.codeUseAppTheme}>
                {@render rowText("Preset", "Same palettes as the terminal.")}
                {@render presetPicker(() => app.settings.codeColorTheme, (v) => ((app.settings.codeColorTheme = v), apply()))}
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">Behavior</h3>
              <div class="setting-row">
                {@render rowText("Animation speed", "0 turns animations off.")}
                <div class="slider">
                  <input type="range" min="0" max="2" step="0.1" bind:value={app.settings.animationSpeed} oninput={apply} />
                  <span class="slider-value">{app.settings.animationSpeed.toFixed(1)}×</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Auto-archive threads", "Idle threads move to the archive after this many days.")}
                <div class="with-unit">
                  <input type="number" class="ctrl-num" min="1" max="365" bind:value={app.settings.autoArchiveDays} onchange={apply} />
                  <span>days</span>
                </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="terminal" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "terminal", query: settingsSearch }}>
            {@render pageHead("Terminal", false)}
            <section class="settings-section">
              <h3 class="section-heading">Colors</h3>
              <div class="setting-row">
                {@render rowText("Use app theme colors", "Colors the terminal from your accent and mode instead of a preset.")}
                {@render toggle(app.settings.terminalUseAppTheme, (v) => ((app.settings.terminalUseAppTheme = v), apply()))}
              </div>
              <div class="setting-row" class:disabled-row={app.settings.terminalUseAppTheme}>
                {@render rowText("Preset", "Used when app theme colors are off.")}
                {@render presetPicker(() => app.settings.terminalColorTheme, (v) => ((app.settings.terminalColorTheme = v), apply()))}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Layout</h3>
              <div class="setting-row">
                {@render rowText("Horizontal padding")}
                <div class="slider">
                  <input type="range" min="0" max="40" step="1" bind:value={app.settings.terminalMarginX} oninput={apply} />
                  <span class="slider-value">{app.settings.terminalMarginX}px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Vertical padding")}
                <div class="slider">
                  <input type="range" min="0" max="40" step="1" bind:value={app.settings.terminalMarginY} oninput={apply} />
                  <span class="slider-value">{app.settings.terminalMarginY}px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Smooth scrolling", "Eases scroll-wheel movement instead of jumping a line at a time.")}
                {@render toggle(app.settings.terminalSmoothScroll, (v) => ((app.settings.terminalSmoothScroll = v), apply()))}
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="servers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "servers", query: settingsSearch }}>
            {@render pageHead("Servers", false)}
            <section class="settings-section">
              <p class="hint">Every server this app has connected to. The pages under the server's name apply to one of these at a time.</p>
              <ul class="list">
                {#each serverList as r (r.key)}
                  <li>
                    <ServerAvatar name={r.label} seed={r.seed} size={22} />
                    <div class="list-text">
                      <span class="list-title">
                        {r.label}
                        <span class="status-dot {r.status}" title={r.status}></span>
                      </span>
                      <span class="list-meta" title={r.address}>{r.address}</span>
                    </div>
                    {#if r.connectionId && (r.status === "connected" || r.status === "connecting")}
                      <button type="button" class="btn small" onclick={() => disconnect(r.connectionId!)}>Disconnect</button>
                    {:else}
                      <button type="button" class="btn small" onclick={() => connectServerRow(r)}>
                        {r.connectionId ? "Reconnect" : "Connect"}
                      </button>
                    {/if}
                    <button type="button" class="btn icon ghost danger" onclick={() => onRemoveRow(r)} title={r.connectionId ? "Remove" : "Forget"}>
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                {:else}
                  <li class="empty">No servers yet.</li>
                {/each}
              </ul>
              {#if addPrefill}
                {#key addPrefill}
                  <div class="inset-card">
                    <div class="inset-head">
                      <span class="row-label">Add a remote server</span>
                      <button type="button" class="btn icon ghost" onclick={() => (addPrefill = null)} title="Cancel">
                        <Icon name="xmark" size={13} />
                      </button>
                    </div>
                    <ConnectForm prefill={addPrefill} showLocal={false} onconnected={() => (addPrefill = null)} />
                  </div>
                {/key}
              {:else}
                <button type="button" class="btn align-start" onclick={() => (addPrefill = {})}>
                  <Icon name="plus" size={13} /> Add server
                </button>
              {/if}
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="general" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "general", query: settingsSearch }}>
            {@render pageHead("General", true)}
            <section class="settings-section">
              <form class="setting-row" onsubmit={submitServerIdentity}>
                {@render rowText("Server name", "What everyone connected to this server sees it called.")}
                <div class="btn-row">
                  <input type="text" class="ctrl-wide" placeholder="this server's name" bind:value={serverIdentityInput} disabled={!connected} />
                  <button type="submit" class="btn" disabled={!connected || !serverIdentityInput.trim() || serverIdentityInput.trim() === server?.serverIdentity}>
                    Save
                  </button>
                </div>
              </form>
              <div class="setting-row">
                {@render rowText("Auto-generate chat titles", "Names new threads from their first message.")}
                {@render toggle(server?.autoGenerateTitleEnabled ?? true, onAutoGenerateTitleToggle, !connected)}
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="providers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "providers", query: settingsSearch }}>
            {@render pageHead("Providers", true)}
            <section class="settings-section">
              <h3 class="section-heading">Coding agents</h3>
              <p class="hint">Runs an agent CLI already signed in on the server, with its own tools — yoakeland never sees the credential. Sign in once in a terminal on the server first.</p>
              <div class="cli-cards">
                {#each cliRows as c (c.kind)}
                  <div class="cli-card">
                    <div class="cli-card-top">
                      <LobeIcon name={c.icon} size={22} />
                      {@render toggle(!!c.existing, (v) => toggleCli(c.kind, c.existing, v), !c.existing && !c.available)}
                    </div>
                    <div class="list-text">
                      <span class="list-title">{c.title}</span>
                      {#if connected && !c.available}
                        <span class="list-meta warn" title={`${c.cli} isn't on the server's PATH`}><Icon name="warning" size={11} /> Not installed</span>
                      {:else}
                        <span class="list-meta" title={`Runs the server's own ${c.cli} CLI`}>{c.cli}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">API keys</h3>
              {#if server?.providers.some((p) => p.kind === "api_key")}
                <ul class="list">
                  {#each (server?.providers ?? []).filter((p) => p.kind === "api_key") as p (p.name)}
                    <li>
                      <Icon name="brain" size={14} />
                      <div class="list-text">
                        <span class="list-title">{p.name}</span>
                        <span class="list-meta">{p.httpProvider}</span>
                      </div>
                      <button type="button" class="btn icon ghost danger" onclick={() => onRemoveProvider(p.name)} title="Remove">
                        <Icon name="trash" size={13} />
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
              <form class="inset-card provider-form" onsubmit={submitProvider}>
                <span class="row-label">Add an API key</span>
                <div class="form-grid">
                  <label>
                    Name
                    <input type="text" bind:value={providerName} placeholder="my-anthropic" />
                  </label>
                  <label>
                    Provider
                    <Dropdown
                      items={[
                        { value: "anthropic", label: "Anthropic" },
                        { value: "openai", label: "OpenAI-compatible" },
                        { value: "openrouter", label: "OpenRouter" },
                      ]}
                      bind:value={() => httpProvider, (v) => (httpProvider = v as typeof httpProvider)}
                      contentClass="above-modal"
                    />
                  </label>
                  <label>
                    API key
                    <input bind:value={apiKey} type="password" placeholder="sk-…" />
                  </label>
                  <label>
                    <span>Base URL <span class="optional">(optional)</span></span>
                    <input type="text" bind:value={baseUrl} placeholder="http://localhost:11434/v1" />
                  </label>
                </div>
                <button class="btn primary align-end" type="submit" disabled={!connected || !providerName.trim() || !apiKey.trim()}>
                  Add key
                </button>
              </form>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="projects" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "projects", query: settingsSearch }}>
            {@render pageHead("Projects", true)}
            <section class="settings-section">
              <p class="hint">Folders on this server offered in the sidebar's project picker.</p>
              <ul class="list">
                {#each (server?.recentProjects ?? []) as path (path)}
                  <li>
                    <Icon name="folder" size={14} />
                    <div class="list-text">
                      <span class="list-title">{basename(path)}</span>
                      <span class="list-meta" title={path}>{path}</span>
                    </div>
                    <button
                      type="button"
                      class="btn icon ghost danger"
                      onclick={() => {
                        server?.forgetProject(path);
                        if (cid) removeProject(cid, path);
                      }}
                      title="Remove from list"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                {:else}
                  <li class="empty">No projects yet.</li>
                {/each}
              </ul>
              <button type="button" class="btn align-start" disabled={!connected} onclick={() => cid && browseAndAddProject(cid)}>
                <Icon name="folder-plus" size={13} /> Add project…
              </button>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="access" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "access", query: settingsSearch }}>
            {@render pageHead("Access", true)}
            {#if server?.connectionStatus === "connected" && !isLocalConnection}
              <p class="notice">
                <Icon name="warning" size={13} /> The server only accepts access changes over its local socket — connect from the server's machine to change them.
              </p>
            {/if}

            <section class="settings-section">
              <h3 class="section-heading">Remote access</h3>
              <div class="warning-card">
                <div class="setting-row">
                  {@render rowText("Allow remote (TCP) connections", "Exposes this server to the network. Anyone with a token or the password can connect.")}
                  {@render toggle(server?.remoteAccessEnabled ?? false, onRemoteAccessToggle, !isLocalConnection)}
                </div>
                <form class="setting-row" onsubmit={submitRemotePassword}>
                  {@render rowText("Shared password", "One secret for everyone. Prefer per-person tokens below.")}
                  <div class="btn-row">
                    <input
                      type="password"
                      class="ctrl-wide"
                      placeholder="new password"
                      bind:value={remotePasswordInput}
                      disabled={!isLocalConnection}
                    />
                    <button type="submit" class="btn" disabled={!isLocalConnection || !remotePasswordInput}>Set</button>
                  </div>
                </form>
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">People with access</h3>
              <p class="hint">
                Per-person tokens. Names are fixed once registered — revoke and re-register to rename. Chats and git
                commits over a token are attributed to its name.
              </p>

              {#if server?.justRegisteredToken}
                <div class="warning-card">
                  <p class="warning-heading"><Icon name="warning" size={12} /> Copy this now</p>
                  <p class="hint">
                    Pairing code for <strong>{server.justRegisteredToken.name}</strong> — shown only this once. They paste
                    it into Add server; it carries the token{server.justRegisteredToken.caPem
                      ? " and this server's certificate"
                      : ""}.
                  </p>
                  <div class="btn-row">
                    <input
                      type="text"
                      readonly
                      value={encodePairingCode(server.justRegisteredToken.token, server.justRegisteredToken.caPem)}
                      onclick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      class="btn primary"
                      onclick={() => {
                        const t = server?.justRegisteredToken;
                        if (t) void navigator.clipboard?.writeText(encodePairingCode(t.token, t.caPem));
                        if (server) server.justRegisteredToken = null;
                      }}
                    >
                      <Icon name="copy" size={13} /> Copy &amp; dismiss
                    </button>
                  </div>
                </div>
              {/if}

              <ul class="list">
                {#each (server?.tokens ?? []) as token (token.name)}
                  <li>
                    <span class="avatar-dot"><Icon name="user" size={13} /></span>
                    <div class="list-text">
                      <span class="list-title">{token.name}</span>
                      <span class="list-meta">{token.email ?? "no email"}</span>
                    </div>
                    <button
                      type="button"
                      class="btn icon ghost danger"
                      onclick={() => onRemoveToken(token.name)}
                      disabled={!isLocalConnection}
                      title="Revoke access"
                    >
                      <Icon name="user-x" size={13} />
                    </button>
                  </li>
                {:else}
                  <li class="empty">No one yet.</li>
                {/each}
              </ul>

              <form class="btn-row" onsubmit={submitToken}>
                <input type="text" placeholder="name" bind:value={tokenNameInput} disabled={!isLocalConnection} />
                <input
                  type="email"
                  placeholder="email (optional, for git commits)"
                  bind:value={tokenEmailInput}
                  disabled={!isLocalConnection}
                />
                <button type="submit" class="btn" disabled={!isLocalConnection || !tokenNameInput.trim()}>
                  <Icon name="plus" size={13} /> Add
                </button>
              </form>
            </section>

            {#if server?.connectionStatus === "connected"}
              <section class="settings-section">
                <h3 class="section-heading">Connected now</h3>
                <ul class="list">
                  {#each (server?.peers ?? []).filter((p) => p.peerId !== server?.selfPeerId) as peer (peer.peerId)}
                    <li>
                      {#if peer.avatar}
                        <img class="avatar-dot" src={peer.avatar} alt="" />
                      {:else}
                        <span class="avatar-dot"><Icon name={deviceIcon[peer.deviceType] ?? "laptop"} size={13} /></span>
                      {/if}
                      <div class="list-text">
                        <span class="list-title">{peer.name}</span>
                        <span class="list-meta">
                          <Icon name={deviceIcon[peer.deviceType] ?? "laptop"} size={11} />
                          {peer.deviceType}{peer.ip ? ` · ${peer.ip}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="btn icon ghost danger"
                        onclick={() => onDisconnectPeer(peer.peerId, peer.name)}
                        title="Disconnect"
                      >
                        <Icon name="unlink" size={13} />
                      </button>
                    </li>
                  {:else}
                    <li class="empty">No one else is connected.</li>
                  {/each}
                </ul>
              </section>
            {/if}
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
    animation: scrimIn var(--dialog-enter-duration) ease-out;
  }
  :global(.settings-overlay[data-state="closed"]) {
    animation: scrimOut var(--dialog-exit-duration) ease-in;
  }
  /* Dropdown.svelte's popover is portalled to <body>, but its own z-index
     (--z-dropdown) sits below this modal's (--z-overlay-content) — bump it
     above so it isn't rendered behind the settings panel. */
  :global(.above-modal) {
    z-index: var(--z-context-menu);
  }
  :global(.settings-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(56rem, 94vw);
    height: min(44rem, 88vh);
    display: flex;
    /* A dialog card is a floating surface like any other — see the --float-*
       tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-sm);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
    overflow: hidden;
    animation: dialogIn var(--dialog-enter-duration) ease-out;
  }
  :global(.settings-content[data-state="closed"]) {
    animation: dialogOut var(--dialog-exit-duration) ease-in;
  }
  :global(.settings-close) {
    position: absolute;
    top: 0.86rem;
    right: 0.86rem;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.86rem;
    height: 1.86rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  :global(.settings-close:hover) {
    background: var(--sidebar-hover);
    color: var(--text);
  }

  /* ---- Layout: full-height nav rail on the left, one scrolling page on
     the right with its own title. ---- */
  :global(.settings-tabs) {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  :global(.tabs-list) {
    flex-shrink: 0;
    width: 13rem;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
    padding: 1.14rem 0.71rem;
    overflow-y: auto;
    background: rgba(255, 255, 255, 0.02);
    border-right: 1px solid var(--panel-border);
  }
  :global(.settings-title) {
    margin: 0 0 0.86rem 0.57rem;
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  .settings-search {
    display: flex;
    margin-bottom: 0.57rem;
  }
  .no-matches {
    margin: 0 0 0.57rem 0.57rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  /* Same small-caps label as the palette's group headings. */
  .tabs-group-label {
    margin: 0.86rem 0 0.29rem 0.57rem;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.settings-tab-trigger) {
    display: flex;
    align-items: center;
    gap: 0.64rem;
    padding: 0.46rem 0.57rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-body-size);
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
  }
  :global(.settings-tab-trigger[data-state="active"] .icon) {
    color: var(--accent);
  }
  :global(.settings-tab-trigger.tab-dim) {
    opacity: 0.35;
  }
  :global(.tab-panel) {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 1.14rem 1.71rem 1.71rem;
  }
  :global(.tab-panel[hidden]) {
    display: none;
  }
  .tab-body {
    --ctrl-h: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.14rem;
  }
  .page-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 1.86rem;
    padding-right: 2.29rem; /* clear of the close button */
  }
  .page-head h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  .scope {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0;
    padding: 0.57rem 0.71rem;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .notice :global(.icon) {
    flex-shrink: 0;
    margin-top: 0.07rem;
    color: var(--warning);
  }

  /* ---- Sections and rows ---- */
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
    padding-top: 1.14rem;
    border-top: 1px solid var(--panel-border);
  }
  .page-head + .settings-section,
  .notice + .settings-section {
    padding-top: 0;
    border-top: none;
  }
  .section-heading {
    margin: 0;
    font-size: var(--text-body-size);
    font-weight: 600;
    color: var(--text);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.14rem;
    min-height: 2rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  /* The control side never shrinks — the text side wraps instead. */
  .setting-row > :last-child {
    flex-shrink: 0;
  }
  .setting-text {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    min-width: 0;
    flex: 1;
  }
  .row-label {
    font-size: var(--text-body-size);
    color: var(--text);
  }
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .optional {
    font-weight: 400;
    opacity: 0.7;
  }

  /* ---- Controls: one height (--ctrl-h, shared with Dropdown) for every
     input, select and button. ---- */
  input[type="text"],
  input[type="number"],
  input[type="password"],
  input[type="email"] {
    box-sizing: border-box;
    height: var(--ctrl-h);
    width: 100%;
    min-width: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0 0.64rem;
    font-size: var(--text-body-size);
    font-family: inherit;
  }
  input:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 60%, var(--panel-border));
  }
  input:disabled {
    opacity: 0.5;
  }
  .ctrl-wide {
    width: 15rem !important;
  }
  .ctrl-num {
    width: 4.57rem !important;
  }
  .with-unit {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    width: 15rem;
  }
  .slider input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .slider-value {
    width: 2.57rem;
    text-align: right;
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  /* Dropdown triggers are ghost-styled in toolbars; in a form they get the
     same box as the inputs around them. */
  .tab-body :global(.dropdown-trigger) {
    min-width: 9rem;
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .form-grid :global(.dropdown-trigger) {
    width: 100%;
  }
  .segmented {
    display: inline-flex;
    gap: 2px;
    height: var(--ctrl-h);
    padding: 2px;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
  }
  .segmented button {
    padding: 0 0.78rem;
    background: none;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .segmented button:hover {
    color: var(--text);
  }
  .segmented button.active {
    background: var(--sidebar-active);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .btn-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  .btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.43rem;
    box-sizing: border-box;
    height: var(--ctrl-h);
    padding: 0 0.86rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    font-size: var(--text-label-size);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: var(--sidebar-hover);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #0d1020;
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, #fff);
  }
  .btn.ghost {
    background: none;
    border-color: transparent;
    color: var(--text-dim);
  }
  .btn.ghost:hover:not(:disabled) {
    color: var(--text);
  }
  .btn.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .btn.icon {
    width: var(--ctrl-h);
    padding: 0;
  }
  .btn.small {
    --ctrl-h: 1.71rem;
    padding: 0 0.64rem;
  }
  .align-start {
    align-self: flex-start;
  }
  .align-end {
    align-self: flex-end;
  }

  /* ---- Lists: one row recipe for servers, projects, keys, people. ---- */
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    min-height: 2.29rem;
    padding: 0.43rem 0.5rem 0.43rem 0.71rem;
    color: var(--text-dim);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .list li + li {
    border-top: 1px solid var(--panel-border);
  }
  .list li:hover {
    background: rgba(255, 255, 255, 0.025);
  }
  .list li.empty {
    padding: 0.86rem;
    justify-content: center;
    font-size: var(--text-label-size);
  }
  .list-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .list-title {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-body-size);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-half);
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-meta.warn {
    color: var(--warning);
  }
  .avatar-dot {
    width: 1.86rem;
    height: 1.86rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.08);
  }
  .inset-card {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
    padding: 0.86rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
  }
  .inset-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -0.29rem -0.29rem 0 0;
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.71rem;
  }
  .form-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    font-size: var(--text-label-size);
    font-weight: var(--text-label-weight);
    color: var(--text-dim);
  }
  .cli-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.43rem;
  }
  .cli-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cli-card {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
    padding: 0.71rem 0.86rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .warning-card {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
    padding: 0.86rem;
    background: color-mix(in srgb, var(--warning) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 28%, var(--panel-border));
    border-radius: var(--radius-sm);
  }
  .warning-heading {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    margin: 0;
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--warning);
  }
  .code-preview {
    font-size: var(--text-body-size);
  }
  .code-preview :global(.code-block) {
    margin: 0;
  }
  .avatar-side {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
    min-width: 0;
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
  /* "Use app theme colors" ON makes the preset dropdown below it moot —
     dimmed and inert rather than removed, so the row stays put and the
     picked preset doesn't disappear from view (it's still there for when
     the switch goes back off). */
  .disabled-row {
    opacity: 0.45;
    pointer-events: none;
  }
  /* The color-theme dropdown's per-item preview (Terminal section) — three
     small dots (red/green/blue, the ANSI slots most recognizable at a
     glance) over the preset's own background, not a full swatch, so it
     reads at list-item size without needing its own legend. */
  .term-theme-swatch {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.14rem;
    width: 1.57rem;
    height: 1.14rem;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  .term-theme-swatch span {
    width: 0.29rem;
    height: 0.29rem;
    border-radius: 50%;
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
  :global(.search-dim) {
    opacity: 0.3;
    filter: saturate(0.6);
  }
  /* Same dot as TerminalPanel's tab status. */
  .status-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.6;
  }
  .status-dot.connected {
    background: var(--success);
    opacity: 1;
  }
  .status-dot.connecting {
    background: var(--warning);
    opacity: 1;
  }
  .status-dot.error {
    background: var(--danger);
    opacity: 1;
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
</style>

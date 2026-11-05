<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  // App-wide pages (Profile, Appearance, Terminal, Servers) store on this device;
  // server-scoped pages (General, Providers, Projects, Access) store on whichever
  // server the page header points at.
  import { askConfirm } from "../confirm.svelte";
  import { fmtVersion } from "../serverVersion";
  import { Dialog, Tabs } from "bits-ui";
  import { untrack, type ComponentProps, type Snippet } from "svelte";
  import { app, forgetKnownServer, type ConnectionId } from "../state.svelte";
  import { basename } from "../format";
  import { isDesktop, localServerSupported, requestWebAlerts, revealItemInDir, windowChromeKind } from "../platform";
  import { swipe, commits, ownsHorizontalDrag } from "../gestures";
  import { SettingsNav, provideNav, hairline } from "../settingsNav.svelte";
  import SubPage from "./SubPage.svelte";
  import { viewport } from "../viewport.svelte";
  import {
    browseAndAddProject,
    connectServerRow,
    disconnect,
    serverRows,
    type ServerRow,
    setPeerName,
    restartServer,
    detectCli,
    setPeerAvatar,
    disconnectPeer,
    setProfile,
    removeServer,
    setRemoteAccess,
    setRuntimeSettings,
    setAutoGenerateTitle,
    setNotifyPrefs,
    setModelRoles,
    ensureModels,
    setRemotePassword,
    setServerIdentity,
    registerToken,
    removeToken,
    removeProject,
    loadCustomThemes,
    themesRevealPath,
    listTokens,
    setLimitAction,
  } from "../ipc";
  import { extractAccentFromImage, hexToHue, hslToHex, tokensFor, TERMINAL_THEME_PRESETS } from "../theme";
  import { APP_THEME_PRESETS } from "../themePresets";
  import { encodePairingCode } from "../pairing";
  import { settingsFromFile, settingsToFile } from "../settingsFile";
  import { isPhotoAvatar, photoAvatarDataUrl } from "../avatar";
  import { avatarSrc } from "../avatarCache.svelte";
  import type { CliKind, LimitAction, ModelRole, NotifyPrefs, ProviderInfo } from "../types";
  import { effortLevels, effortLabel } from "./EffortPicker.svelte";
  let settingsFileMsg = $state("");
  let settingsFileInput = $state<HTMLInputElement | null>(null);
  function exportSettings() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([settingsToFile(app.settings)], { type: "application/json" }));
    a.download = "yoakeland-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importSettings(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const found = settingsFromFile(await file.text(), app.settings);
      Object.assign(app.settings, found);
      apply();
      settingsFileMsg = `Imported ${Object.keys(found).length} settings.`;
    } catch (err) {
      settingsFileMsg = err instanceof Error ? err.message : String(err);
    }
  }
  let webAlerts = $state<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  /** Each tab's page title, and whether it applies to one server (shown as [server] / page). */
  const HEADS: Record<string, { title: string; scoped: boolean }> = {
    profile: { title: "General", scoped: false },
    appearance: { title: "Appearance", scoped: false },
    text: { title: "Text & code", scoped: false },
    keyboard: { title: "Keyboard", scoped: false },
    integrations: { title: "Discord", scoped: false },
    servers: { title: "Servers", scoped: false },
    general: { title: "Server", scoped: true },
    providers: { title: "Providers", scoped: true },
    models: { title: "Models", scoped: true },
    projects: { title: "Projects", scoped: true },
    safety: { title: "Safety", scoped: true },
    notifications: { title: "Notifications", scoped: true },
    access: { title: "Access", scoped: true },
  };
  import Button from "./ui/Button.svelte";
  import AvatarEditor from "./AvatarEditor.svelte";
  import NumberField from "./ui/NumberField.svelte";
  import Segmented from "./ui/Segmented.svelte";
  import Slider from "./ui/Slider.svelte";
  import Switch from "./ui/Switch.svelte";
  import TextField from "./ui/TextField.svelte";
  import TextArea from "./ui/TextArea.svelte";
    import { DEFAULT_NOTIFY_PREFS, NOTIFY_KINDS } from "../notifyKinds";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import ProvidersPage from "./providers/ProvidersPage.svelte";
  import Dropdown from "./Dropdown.svelte";
  import ScopeTitle from "./ScopeTitle.svelte";
  import AuditPanel from "./AuditPanel.svelte";
  import SearchInput from "./SearchInput.svelte";
  import TerminalPreview from "./TerminalPreview.svelte";
  import ConnectForm from "./ConnectForm.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionRules from "./PermissionRules.svelte";
  import PeoplePanel from "./PeoplePanel.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ServerIconEditor from "./ServerIconEditor.svelte";
  import Kbd from "./Kbd.svelte";
  import { tip } from "../tooltip.svelte";
  import { previewDiscordActivity, refreshDiscordRpcStatus, rpcStatus } from "../discordRpc.svelte";
  import { DEFAULT_DISCORD_CLIENT_ID, DEFAULT_DISCORD_RPC, DISCORD_EDITOR_TEMPLATE_VARS, DISCORD_EDITOR_TIMER_SCOPES, DISCORD_PRESENCE_MODES, DISCORD_STATUS_DISPLAY_TYPES, DISCORD_TEMPLATE_VARS, discordAppIconCdnUrl, discordAssetCdnUrl, resolveDiscordClientId, type DiscordApplicationInfo } from "../discordRpcSettings";
  import { discordAssets } from "../platform";
  import {
    ACTIONS,
    bindsFor,
    comboFromEvent,
    conflictsFor,
    isCustomized,
    recorder,
    removeBind,
    resetBinds,
    setBind,
    type KeyAction,
  } from "../keybinds.svelte";

  const QUICK_AVATARS = ["🐣", "🦊", "🐙", "🐢", "🐝", "🐺"];

  // Defaults to whichever connection the rest of the app is focused on, but the picker
  // below (shown only with more than one server) can point these tabs elsewhere without
  // changing what the main window shows.
  let selectedConnectionId = $state<ConnectionId | null>(null);
  let cid = $derived(selectedConnectionId ?? app.activeConnectionId);
  let server = $derived(cid ? app.servers[cid] : null);
  const serverItems = $derived(Object.entries(app.servers).map(([id, s]) => ({ value: id, label: s.label })));

  // ---- Integrations tab (Discord Rich Presence) ----
  const discordSettings = $derived(app.settings.discordRpc);
  const DISCORD_ACTIVITY_LABELS = { playing: "Playing", listening: "Listening to", watching: "Watching", competing: "Competing in" } as const;
  let discordPreviewKind = $state<"chat" | "editor">("chat");
  const U = "https://… (optional)";
  const DISCORD_FIELDS = {
    chat: [
      ["details", "Details", "{status} in {project}"],
      ["detailsUrl", "Details link", U],
      ["state", "State", "{chat}"],
      ["stateUrl", "State link", U],
      ["largeImage", "Image", "logo or https://…"],
      ["largeText", "Hover text", "yoakeland"],
      ["largeUrl", "Link", U],
      ["smallImage", "Image", "Optional"],
      ["smallText", "Hover text", "Optional"],
      ["smallUrl", "Link", U],
    ],
    editor: [
      ["editorDetails", "Details", "Editing {file}"],
      ["editorDetailsUrl", "Details link", U],
      ["editorState", "State", "{project} · {language}"],
      ["editorStateUrl", "State link", U],
      ["editorLargeImage", "Image", "logo, {languageKey} or https://…"],
      ["editorLargeText", "Hover text", "{language}"],
      ["editorLargeUrl", "Link", U],
      ["editorSmallImage", "Image", "Optional"],
      ["editorSmallText", "Hover text", "Optional"],
      ["editorSmallUrl", "Link", U],
    ],
  } as const;
  const DISCORD_GROUPS = [
    ["Lines", 0, 4],
    ["Large image", 4, 7],
    ["Small image", 7, 10],
  ] as const;
  const DISCORD_ACTIVITY_TYPES = [
    { value: "playing", label: "Playing" },
    { value: "listening", label: "Listening to" },
    { value: "watching", label: "Watching" },
    { value: "competing", label: "Competing in" },
  ];
  const discordPreviews = $derived({
    chat: previewDiscordActivity(app.settings.discordRpc, "chat"),
    editor: previewDiscordActivity(app.settings.discordRpc, "editor"),
  });
  const discordHasId = $derived(!!resolveDiscordClientId(discordSettings));
  const discordAppId = $derived(resolveDiscordClientId(discordSettings));
  // The application's public profile (icon hash, uploaded art) backs the preview images;
  // Discord's main-process fetch sidesteps CORS, so the renderer just resolves keys.
  let discordApp = $state<DiscordApplicationInfo | null>(null);
  $effect(() => {
    if (!isDesktop || !discordHasId) {
      discordApp = null;
      return;
    }
    const id = discordAppId;
    void discordAssets(id).then(
      (app_) => {
        if (discordAppId === id) discordApp = app_;
      },
      () => {
        if (discordAppId === id) discordApp = null;
      },
    );
  });
  const discordAssetIds = $derived(new Map((discordApp?.assets ?? []).map((a) => [a.name, a.id])));
  const discordIconSrc = $derived(
    discordApp?.icon ? discordAppIconCdnUrl(discordAppId, discordApp.icon) : "",
  );
  const discordAppName = $derived(discordSettings.name.trim() || discordApp?.name.trim() || "yoakeland");
  // Ticks only while the preview is showing a timer, so the settings page stays idle otherwise.
  let discordNow = $state(Date.now());
  $effect(() => {
    if (!discordPreviews.chat?.timestamps && !discordPreviews.editor?.timestamps) return;
    discordNow = Date.now();
    const id = setInterval(() => (discordNow = Date.now()), 1000);
    return () => clearInterval(id);
  });
  function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
  }
  /** Preview source for an asset key: a public URL as-is, a known asset key via Discord's CDN, and
   * the application's own icon for the bare "logo"/empty default. Unknown keys get no image, which
   * the card mockup shows as the Discord stand-in. */
  function discordImageSrc(key: string): string {
    const value = key.trim();
    if (/^https?:\/\//i.test(value)) return value;
    const assetId = discordAssetIds.get(value);
    if (assetId) return discordAssetCdnUrl(discordAppId, assetId);
    // "logo" is the convention for the app's own picture in the example keys.
    if (discordIconSrc && (value === "logo" || value === "")) return discordIconSrc;
    return value === "logo" || value === "" ? "/logo.png" : "";
  }
  const discordStatusText = $derived(
    !discordSettings.enabled
      ? "Off"
      : rpcStatus.connected
        ? "Connected to Discord"
        : (rpcStatus.error ?? "Looking for a running Discord client…"),
  );
  $effect(() => {
    if (app.showSettings && app.settingsTab === "integrations") refreshDiscordRpcStatus();
  });

  // Opening the agents tab asks again, so a CLI installed since connecting is listed.
  $effect(() => {
    if (app.settingsTab === "providers" && cid && connected) untrack(() => detectCli(cid));
  });

  let remotePasswordInput = $state("");
  let serverIdentityInput = $state("");
  $effect(() => {
    if (server?.serverIdentity != null) serverIdentityInput = server.serverIdentity;
  });

  const connected = $derived(server?.connectionStatus === "connected");
  const serverIdentityDirty = $derived(
    !!serverIdentityInput.trim() && serverIdentityInput.trim() !== server?.serverIdentity,
  );

  // --- Model roles (SPEC.md §4f) ---
  const ROLE_ROWS = [
    { key: "plan", label: "Planning", hint: "Every turn in Plan mode." },
    { key: "explore", label: "Exploring", hint: "Read-only subagents that search the code." },
    { key: "utility", label: "Titles & summaries", hint: "Chat names and long-chat summaries." },
    { key: "advisor", label: "Advisor", hint: "A stronger model the chat can consult. Anthropic only." },
  ];
  const apiProviders = $derived((server?.providers ?? []).filter((p) => p.kind === "api_key"));
  // The role pickers list models the composer may not have fetched yet.
  $effect(() => {
    if (!cid || !server) return;
    for (const p of apiProviders) if (!server.modelsByProvider[p.name]) ensureModels(cid, p.name);
  });
  function roleModelItems(key: string) {
    const items: { value: string; label: string; group?: string }[] = [{ value: "", label: "Same as chat" }];
    for (const p of apiProviders) {
      if (key === "advisor" && p.httpProvider !== "anthropic") continue;
      for (const m of server?.modelsByProvider[p.name] ?? []) {
        items.push({ value: `${p.name}\n${m.id}`, label: m.displayName ?? m.id, group: p.name });
      }
    }
    return items;
  }
  const roleValue = (key: string) => {
    const r = server?.modelRoles[key];
    return r ? `${r.providerName}\n${r.model ?? ""}` : "";
  };
  function roleEfforts(key: string) {
    const r = server?.modelRoles[key];
    const p = r && apiProviders.find((x) => x.name === r.providerName);
    const levels = effortLevels(p, server?.modelsByProvider[r?.providerName ?? ""]?.find((m) => m.id === r?.model), r?.model);
    return levels && [{ value: "", label: "Default" }, ...levels.map((l) => ({ value: l, label: effortLabel(l) }))];
  }
  function saveRole(key: string, role: ModelRole | undefined) {
    if (!cid || !server) return;
    const roles = { ...server.modelRoles };
    if (role) roles[key] = role;
    else delete roles[key];
    setModelRoles(cid, roles);
  }
  function pickRoleModel(key: string, v: string) {
    if (!v) return saveRole(key, undefined);
    const [providerName, model] = v.split("\n");
    saveRole(key, { providerName, model });
  }
  function pickRoleEffort(key: string, v: string) {
    const r = server?.modelRoles[key];
    if (r) saveRole(key, { ...r, reasoningEffort: v || undefined });
  }
  const isLocalConnection = $derived(connected && server?.connectionMode === "local");
  // People (tokens) can be managed from the server's own machine or by a full-access device; only
  // the remote listener and shared password stay local-only. A phone's pairing code is limited.
  const canManagePeople = $derived(connected && (isLocalConnection || !!server?.canAdmin));
  $effect(() => {
    if (canManagePeople && server && !isLocalConnection) listTokens(server.connectionId);
  });
  const limitedHere = $derived(connected && !isLocalConnection && !!server?.limited);

  // The profile is one identity on every server, so a change goes to all of them, not just the open one.
  const connectedIds = () => Object.values(app.servers).filter((v) => v.connectionStatus === "connected").map((v) => v.connectionId);

  // What this page shows and edits: the person the open server knows me as, else this device's profile.
  const me = $derived(app.myProfile);
  let nameDraft = $state("");
  $effect(() => {
    nameDraft = me.name;
  });
  // A server with people takes the edit as set_profile on the open server only; the local copy
  // is kept to seed servers where I have no profile yet. Servers without people get the old device label.
  function saveProfile(change: { name?: string; avatar?: string }) {
    if (change.name !== undefined) app.settings.profileName = change.name;
    if (change.avatar !== undefined) app.settings.profileAvatar = change.avatar;
    apply();
    if (server?.user) setProfile(server.connectionId, change);
    for (const id of connectedIds()) {
      if (app.servers[id]?.user) continue;
      if (change.name !== undefined) setPeerName(id, change.name || "anonymous");
      if (change.avatar !== undefined) setPeerAvatar(id, change.avatar);
    }
  }

  function onProfileNameChange() {
    const name = nameDraft.trim();
    if (name) saveProfile({ name });
    else nameDraft = me.name;
  }

  function pushAvatar(avatar: string) {
    saveProfile({ avatar });
  }

  function setEmojiAvatar(emoji: string) {
    pushAvatar(emoji);
  }

  let avatarInput: HTMLInputElement;
  // Phone: the avatar opens a crop editor page; elsewhere it goes straight to the file picker.
  let editor = $state<ReturnType<typeof AvatarEditor>>();
  const onAvatarTap = () => (viewport.narrow ? void nav.push("avatar") : avatarInput?.click());
  const serverCount = $derived(Object.values(app.servers).length);
  const connectedCount = $derived(connectedIds().length);
  let uploadingAvatar = $state(false);

  async function onAvatarFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploadingAvatar = true;
    try {
      pushAvatar(await photoAvatarDataUrl(file));
    } finally {
      uploadingAvatar = false;
      (e.target as HTMLInputElement).value = "";
    }
  }

  async function onRemoveServer(id: ConnectionId, label: string) {
    if (!(await askConfirm(`Remove "${label}"? Disconnects it and stops offering it for reconnect.`))) return;
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
  // Non-null while the add form is open: {} for a blank one, or a
  // remembered remote's address (app.openAddServer, e.g. from the palette).
  let addPrefill = $state<{ host?: string; port?: number } | null>(null);
  $effect(() => {
    const req = app.addServerRequest;
    if (!req) return;
    addPrefill = req;
    app.addServerRequest = null;
  });

  // Something asked for the add form (palette, deep link): on a phone that is a page.
  $effect(() => {
    if (!addPrefill || !viewport.narrow || !app.showSettings) return;
    untrack(() => {
      if (!nav.has("tab")) nav.reset(["tab"]);
      void nav.push("add-server");
    });
  });

  async function onRemoveRow(r: ServerRow) {
    if (r.connectionId) await onRemoveServer(r.connectionId, r.label);
    else if (r.known && (await askConfirm(`Forget "${r.label}"? It stops being offered for reconnect.`))) forgetKnownServer(r.known.serverId);
    serversVersion++;
  }

  async function onDisconnectPeer(peerId: string, name: string) {
    if (cid && (await askConfirm(`Disconnect "${name}"? Any peer can disconnect any other. There is no extra permission check.`))) {
      disconnectPeer(cid, peerId);
    }
  }

  function onRemoteAccessToggle(checked: boolean) {
    if (cid) setRemoteAccess(cid, checked);
  }

  function onAutoGenerateTitleToggle(checked: boolean) {
    if (cid) setAutoGenerateTitle(cid, checked);
  }

  // Server-wide limits and the no-sandbox policy (RuntimeSettings); the server echoes back what it stored.
  const runtime = $derived(server?.runtime);
  const unsandboxedOpen = $derived(server?.unsandboxedProjects ?? []);
  function patchRuntime(patch: Parameters<typeof setRuntimeSettings>[1]) {
    if (cid) setRuntimeSettings(cid, patch);
  }
  /** The numeric runtime settings beyond the limits above: key, label, hint, unit, minimum. */
  const RESOURCE_SETTINGS = [
    { key: "execTimeoutSec", label: "Command timeout", hint: "How long one bash command may run.", unit: "s", min: 1 },
    { key: "execOutputMaxBytes", label: "Command output kept", hint: "Bash output past this is dropped.", unit: "bytes", min: 4096 },
    { key: "terminalMemoryMaxMB", label: "Terminal memory cap", hint: "Per new terminal, where the system supports it.", unit: "MB", min: 64 },
    { key: "terminalPidsMax", label: "Terminal process cap", hint: "Processes per new terminal.", unit: "", min: 16 },
    { key: "terminalReadMaxChars", label: "Terminal output the model sees", hint: "The tail of each terminal read.", unit: "chars", min: 500 },
    { key: "terminalHistoryKB", label: "Terminal scrollback replayed", hint: "What a client gets when it attaches.", unit: "KB", min: 16 },
    { key: "poolIdleMinutes", label: "Keep idle coding agents for", hint: "Unused Claude/Codex/… processes close after this.", unit: "min", min: 1 },
    { key: "poolMaxLive", label: "Most coding agents alive at once", hint: "0 means no cap. Closes the least recently used idle one to make room. Running turns are never stopped.", unit: "", min: 0 },
    { key: "pricingRefreshHours", label: "Refresh model prices every", hint: "A model with no price also triggers a refresh, at most hourly.", unit: "h", min: 1 },
    { key: "uploadRetentionDays", label: "Keep unused uploads for", hint: "Attachments no chat references and nobody has read for this long are deleted. 0 keeps them forever.", unit: "days", min: 0 },
  ] as const;
  let compactInstructionsInput = $state("");
  $effect(() => {
    compactInstructionsInput = runtime?.compactInstructions ?? "";
  });
  let remoteAddrInput = $state("");
  $effect(() => {
    remoteAddrInput = server?.remoteAddr ?? "";
  });
  function submitRemoteAddr(e: Event) {
    e.preventDefault();
    if (cid) setRemoteAccess(cid, server?.remoteAccessEnabled ?? false, { addr: remoteAddrInput.trim() });
  }

  // Notification policy (server-wide, every device sees the same) and this device's OS alerts.
  const notifyPrefs = $derived(server?.notifyPrefs ?? DEFAULT_NOTIFY_PREFS);
  function patchNotify(patch: Partial<NotifyPrefs>) {
    if (cid) setNotifyPrefs(cid, { ...notifyPrefs, ...patch });
  }
  function setKindOn(kind: string, on: boolean) {
    patchNotify({ muted: on ? notifyPrefs.muted.filter((k) => k !== kind) : [...notifyPrefs.muted, kind] });
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

  let addingPerson = $state(false);
  let tokenNameInput = $state("");
  let tokenEmailInput = $state("");

  function submitToken(e: Event) {
    e.preventDefault();
    if (!cid || !tokenNameInput.trim()) return;
    registerToken(cid, tokenNameInput.trim(), tokenEmailInput.trim() || undefined, false, server?.user ? { user: "new", newUserName: tokenNameInput.trim(), tier: "limited" } : undefined);
    tokenNameInput = "";
    tokenEmailInput = "";
    addingPerson = false;
  }

  async function onRemoveToken(name: string) {
    if (cid && (await askConfirm(`Revoke "${name}"'s access? They're disconnected right away.`))) {
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

  let themeNote = $state<string | null>(null);

  // The accent only paints a mode that has no theme of its own.
  const accentUsed = $derived(
    (app.settings.theme !== "light" && !app.themeFor("dark")) || (app.settings.theme !== "dark" && !app.themeFor("light")),
  );

  async function reloadThemes() {
    themeNote = await loadCustomThemes();
  }

  async function revealThemesFile() {
    try {
      await revealItemInDir(await themesRevealPath());
    } catch (e) {
      themeNote = String(e instanceof Error ? e.message : e);
    }
  }

  // ---- Custom hue slider (fixed saturation/lightness, see hslToHex) ----
  // Tracked as its own state rather than derived from the accent hex: hue -> hex -> hue
  // round-trips through 8-bit rounding, so re-deriving on every drag step snapped the thumb
  // to a slightly different angle than dragged to. Still re-synced when the accent changes
  // from outside this slider (e.g. a wallpaper-derived accent).
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

  // Mode cards preview what each mode would paint: its chosen theme, or the accent-derived
  // colors, so picking a theme or moving the accent visibly recolors them.
  const darkPreview = $derived(tokensFor(app.themeFor("dark"), app.settings.accent, "dark"));
  const lightPreview = $derived(tokensFor(app.themeFor("light"), app.settings.accent, "light"));

  function skeletonBg(modeId: string): string {
    if (modeId === "dark") return darkPreview.bg;
    if (modeId === "light") return lightPreview.bg;
    return `linear-gradient(115deg, ${darkPreview.bg} 50%, ${lightPreview.bg} 50%)`;
  }

  function skeletonLine(modeId: string): string {
    if (modeId === "dark") return darkPreview.sidebarFgDim;
    if (modeId === "light") return lightPreview.sidebarFgDim;
    // Split diagonal needs one line color that reads on both halves: the
    // mode-specific ones above are each tuned for just one side.
    return "rgba(128, 128, 128, 0.7)";
  }

  function apply() {
    app.applySettings();
  }

  // Applied on release, not per step: rescaling the whole UI under the pointer mid-drag
  // would move the slider away from it.
  const BASE_UI_FONT_SIZE = 14;
  let scalePct = $state(Math.round((app.settings.uiFontSize / BASE_UI_FONT_SIZE) * 100));
  function applyScale() {
    app.settings.uiFontSize = (BASE_UI_FONT_SIZE * scalePct) / 100;
    apply();
  }

  const CODE_PREVIEW = [
    "```ts",
    "import type { Peer } from \"./peers\";",
    "",
    "// Greets everyone connected to this server",
    "export async function greet(peers: Peer[], prefix = \"hi\"): Promise<number> {",
    "  let greeted = 0;",
    "  for (const p of peers) {",
    "    if (!p.online) continue;",
    "    console.log(`${prefix}, ${p.name}! You joined ${p.joinedAt.toLocaleDateString()} from ${p.address}.`);",
    "    greeted++;",
    "  }",
    "  return greeted * 42;",
    "}",
    "",
    "export function summarize(peers: Peer[]): string {",
    "  const names = peers.map((p) => p.name).sort();",
    "  if (names.length <= 2) return names.join(\" and \");",
    "  return `${names.slice(0, -1).join(\", \")}, and ${names[names.length - 1]}`;",
    "}",
    "",
    "export const DEFAULT_PREFIX = \"hello\";",
    "```",
  ].join("\n");

  // Same resolution as TerminalView.
  const termColors = $derived(
    (!app.settings.terminalUseAppTheme && TERMINAL_THEME_PRESETS.find((p) => p.id === app.settings.terminalColorTheme)?.colors) ||
      app.appTerminalColors,
  );

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

  /** A switch, not a one-shot button: turning it on keeps accent and wallpaper in step,
   * so swapping the wallpaper later recolors the UI without a second trip here. */
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

  // ---- Search: dims non-matching rows rather than hiding them, so the page doesn't reflow.
  // Every tab's content stays mounted (bits-ui only toggles `hidden`), so all are indexed. ----
  const ALL_TABS = ["profile", "appearance", "text", "keyboard", "integrations", "servers", "general", "providers", "models", "projects", "safety", "notifications", "access"];
  // No physical keyboard to bind on a phone.
  const TAB_ORDER = $derived(viewport.narrow ? ALL_TABS.filter((t) => t !== "keyboard") : ALL_TABS);
  const TAB_LABELS: Record<string, string> = {
    profile: "general profile you name avatar picture chats tool calls thinking feed summary archive alerts desktop notifications closing quit stop server setup",
    appearance: "appearance look theme accent wallpaper window surfaces motion animation",
    text: "text code fonts font scale terminal shell colors diff padding scrolling",
    integrations: "discord integrations rich presence rpc activity status",
    keyboard: "keyboard shortcuts keybinds keybindings hotkeys keys",
    servers: "servers connections remote",
    general: "general server name titles",
    providers: "providers agents accounts api keys subscriptions acp registry",
    models: "models roles planning exploring titles summaries advisor",
    projects: "projects folders paths",
    safety: "safety limits bash sandbox permissions browser spend rules",
    notifications: "notifications alerts needs you desktop",
    access: "access network remote password tokens peers people audit log history approved refused",
  };
  // Phone: root list -> a tab's page -> sub-pages is a page stack (settingsNav). Opening to a specific tab
  // (provider or server prompts) lands straight on its page.
  const nav = new SettingsNav();
  provideNav(nav);
  nav.tabTitle = () => HEADS[app.settingsTab]?.title ?? "";
  // The outermost level has nothing to pop: a swipe right there closes settings, the page following the finger.
  const closeEl = () => document.querySelector<HTMLElement>(".settings-content");
  const closeSwipe = {
    axis: "x",
    start: (e: PointerEvent) => !ownsHorizontalDrag(e.target),
    accept: (d: number) => d > 0,
    onMove: (d: number) => {
      const el = closeEl();
      if (el) (el.style.transition = "none"), (el.style.transform = `translateX(${Math.max(0, d)}px)`);
    },
    onEnd: (d: number, v: number) => {
      const el = closeEl();
      const go = commits(d / innerWidth, v, 1);
      if (!el) return;
      el.style.transition = go ? "opacity 0.14s ease" : "transform 0.2s var(--ui-ease)";
      el.style.opacity = go ? "0" : "";
      el.style.transform = go ? el.style.transform : "";
      const reset = () => (el.style.transition = el.style.transform = el.style.opacity = "");
      if (!go) return void setTimeout(reset, 200);
      // Stay faded while it closes, so it doesn't flash back before bits' own fade-out.
      setTimeout(() => {
        app.showSettings = false;
        setTimeout(reset, 300);
      }, 140);
    },
    onCancel: () => closeEl()?.style.removeProperty("transform"),
  } as const;
  const goBack = () => (nav.depth ? nav.gesture : closeSwipe);
  const hostEl = (el: HTMLElement) => {
    nav.host = el;
    queueMicrotask(() => nav.rest());
    return () => (nav.host = null);
  };
  $effect(() => {
    if (app.showSettings && viewport.narrow && app.settingsTab === "keyboard") app.settingsTab = "appearance";
  });
  // Opening lands on the list, or straight on the tab someone asked for.
  $effect(() => {
    if (app.showSettings) untrack(() => nav.reset(app.settingsTab !== "appearance" ? ["tab"] : []));
  });
  // The outer shell's back button (and the browser's) pops one settings level first, then closes settings.
  $effect(() => {
    if (!app.showSettings || !viewport.narrow) return;
    const prev = untrack(() => viewport.back);
    viewport.back = () => (nav.depth ? void nav.pop() : (app.showSettings = false));
    return () => (viewport.back = prev);
  });
  let settingsSearch = $state("");
  let tabHasMatch = $state<Record<string, boolean>>({});
  let firstMatchByTab: Record<string, HTMLElement | null> = {};

  function searchable(node: HTMLElement, params: { tab: string; query: string }) {
    function update({ tab, query }: { tab: string; query: string }) {
      const q = query.trim().toLowerCase();
      // Searching a tab's own name lights up the whole tab.
      const wholeTab = !!q && TAB_LABELS[tab].includes(q);
      const rows = node.querySelectorAll<HTMLElement>(
        ".field, .setting-row, .num-cell, .form-grid > label, .list > li, .servers > li",
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
      // A per-key write, never a read-then-assign: reading tabHasMatch here would make this
      // effect depend on what it writes (infinite loop).
      tabHasMatch[tab] = !q || wholeTab || !!first;
    }
    update(params);
    return { update };
  }

  // ---- Keyboard tab ----
  const actionGroups = $derived(
    [...new Set(ACTIONS.map((a) => a.group))].map((g) => [g, ACTIONS.filter((a) => a.group === g)] as const),
  );
  const GROUP_ICONS: Record<string, ComponentProps<typeof Icon>["name"]> = {
    General: "settings",
    View: "layout-columns",
    Chat: "message-circle",
    "Chat list": "clipboard-list",
    Terminal: "terminal-2",
    Files: "file-text",
  };
  const anyCustomized = $derived(ACTIONS.some((a) => isCustomized(a.id)));
  // The slot being recorded; `combo` + `taken` once a pressed combo turned out to be in use.
  let rec = $state<{ id: string; slot: number; combo?: string; taken?: KeyAction[] } | null>(null);

  function startRecording(id: string, slot: number) {
    rec = { id, slot };
    recorder.active = true;
  }
  function stopRecording() {
    rec = null;
    recorder.active = false;
  }
  function commit(id: string, slot: number, combo: string) {
    setBind(id, slot, combo);
    stopRecording();
  }
  function onRecordKey(e: KeyboardEvent) {
    if (!rec || rec.combo) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stopRecording();
    const combo = comboFromEvent(e);
    if (!combo) return;
    const taken = conflictsFor(rec.id, combo);
    if (bindsFor(rec.id).includes(combo) || !taken.length) return commit(rec.id, rec.slot, combo);
    rec = { ...rec, combo, taken };
    recorder.active = false;
  }
  $effect(() => {
    if (!app.showSettings || app.settingsTab !== "keyboard") stopRecording();
  });

  // "/" jumps to the search box, unless the user is already typing somewhere.
  function focusSearchOnSlash(e: KeyboardEvent) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || rec || !app.showSettings) return;
    const t = e.target as HTMLElement | null;
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
    const input = document.querySelector<HTMLInputElement>(".settings-search input");
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  }

  const noMatches = $derived(!!settingsSearch.trim() && TAB_ORDER.every((t) => tabHasMatch[t] === false));

  // Re-runs when the matches change (i.e. per query), not when the user
  // clicks a tab, so manually opening a non-matching tab doesn't bounce.
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

{#snippet settingsHead()}
  {@const h = HEADS[app.settingsTab] ?? { title: "", scoped: false }}
  <header class="page-head">
    <button type="button" class="settings-back" aria-label="Back" onclick={() => void nav.pop()}>
      <Icon name="chevron-left" size={18} />
    </button>
    <div class="head-main">
      <small class="crumb">{nav.crumb("tab")}</small>
      <div class="head-row">
        <ScopeTitle
          variant="page"
          items={h.scoped && server ? serverItems : []}
          value={cid ?? undefined}
          onchange={(v) => (selectedConnectionId = v ?? null)}
          server={h.scoped ? server : null}
          triggerTitle="Which server these settings apply to"
        >
          <h2>{h.title}</h2>
        </ScopeTitle>
      </div>
    </div>
  </header>
{/snippet}

{#snippet pageHead(title: string, scoped: boolean)}
  {#if scoped && !connected}
    <!-- Everything after this in the page is hidden by CSS: disabled controls with no server read as broken. -->
    <div class="offline">
      <Icon name="plug-connected" size={22} />
      <span class="row-label">{server ? `${server.label} isn't connected` : "No server connected"}</span>
      <p class="hint">These settings live on a server. Connect one to change them.</p>
      <Button type="button" onclick={() => (app.settingsTab = "servers")}>Go to Servers</Button>
    </div>
  {/if}
{/snippet}

{#snippet serverActions(r: ServerRow)}
  {#if r.connectionId && (r.status === "connected" || r.status === "connecting")}
    <Button type="button" size="sm" onclick={() => disconnect(r.connectionId!)}>Disconnect</Button>
  {:else}
    <Button type="button" size="sm" onclick={() => connectServerRow(r)}>
      {r.connectionId ? "Reconnect" : "Connect"}
    </Button>
  {/if}
  <Button
    type="button"
    icon={!viewport.narrow}
    variant="ghost"
    destructive
    onclick={async () => {
      await onRemoveRow(r);
      if (viewport.narrow && !serverList.some((x) => x.key === r.key) && nav.has(`server-${r.key}`)) void nav.pop();
    }}
    {@attach tip(r.connectionId ? "Remove" : "Forget")}
  >
    <Icon name="trash" size={13} />{#if viewport.narrow}&nbsp;{r.connectionId ? "Remove" : "Forget"}{/if}
  </Button>
{/snippet}

{#snippet face(size: number)}
  <span class="face" style="width: {size}px; height: {size}px; font-size: {size * 0.55}px">
    {#if isPhotoAvatar(me.avatar)}
      <img src={avatarSrc(me.avatar)} alt="" />
    {:else}
      {me.avatar || "🐣"}
    {/if}
  </span>
{/snippet}

{#snippet cardPage(body: Snippet)}
  <section class="settings-section"><div class="card">{@render body()}</div></section>
{/snippet}

{#snippet rowText(label: string, hint?: string, more?: string)}
  <div class="setting-text">
    <span class="row-label">
      {label}
      {#if more}<span class="more" {@attach tip(more)}><Icon name="info-circle" size={12} /></span>{/if}
    </span>
    {#if hint}<p class="hint">{hint}</p>{/if}
  </div>
{/snippet}

{#snippet toggle(checked: boolean, onChange: (v: boolean) => void, disabled = false)}
  <Switch {checked} {disabled} onchange={onChange} />
{/snippet}

<!-- A handful of mutually exclusive options, all visible at once, a
     dropdown only earns its extra click once the list is too long to show. -->
{#snippet segmented(options: { value: string; label: string }[], value: string, pick: (v: string) => void)}
  <Segmented {options} {value} onchange={pick} />
{/snippet}

{#snippet choiceCards(kind: "area" | "surface" | "tools", options: { value: string; label: string }[], value: string, pick: (v: string) => void)}
  <div class="mode-cards choices" role="radiogroup">
    {#each options as o (o.value)}
      <button type="button" role="radio" aria-checked={value === o.value} class="mode-card" class:active={value === o.value} onclick={() => pick(o.value)}>
        <div class="choice-prev {kind} {o.value}">
          {#if kind === "area"}
            <span class="p-side"></span><span class="p-main"></span>
          {:else if kind === "surface"}
            <span class="p-line"></span><span class="p-line short"></span><span class="p-line"></span>
            <span class="p-pop"></span>
          {:else}
            <span class="p-line"></span>
            {#each o.value === "simple" ? [0] : [0, 1, 2] as i (i)}<span class="p-bar"></span>{/each}
            <span class="p-line short"></span>
          {/if}
        </div>
        <span class="mode-card-label">{o.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet presetPicker(get: () => string, set: (v: string) => void)}
  <Dropdown
    items={[{ value: "app", label: "Match app theme" }, ...TERMINAL_THEME_PRESETS.map((p) => ({ value: p.id, label: p.name, group: "Presets" }))]}
    bind:value={get, set}
    contentClass="above-modal"
  >
    {#snippet item({ value, label, selected })}
      {@const colors = value === "app" ? app.appTerminalColors : TERMINAL_THEME_PRESETS.find((p) => p.id === value)?.colors}
      <span class="term-theme-swatch" style="background: {colors?.background}">
        <span style="background: {colors?.red}"></span>
        <span style="background: {colors?.green}"></span>
        <span style="background: {colors?.blue}"></span>
      </span>
      <span class="dropdown-item-label">{label}</span>
      {#if selected}<Icon name="check" size={11} />{/if}
    {/snippet}
  </Dropdown>
{/snippet}

{#snippet slotPicker(mode: "dark" | "light", label: string)}
  {@const all = [...APP_THEME_PRESETS, ...app.customThemes].filter((t) => t[mode])}
  <div class="setting-row">
    {@render rowText(label, app.themeFor(mode) ? undefined : "Default follows the accent.")}
    <Dropdown
      items={[
        { value: "default", label: "Default" },
        ...APP_THEME_PRESETS.filter((t) => t[mode]).map((t) => ({ value: t.id, label: t.name, group: "Presets" })),
        ...app.customThemes.filter((t) => t[mode]).map((t) => ({ value: t.id, label: t.name, group: "Custom" })),
      ]}
      bind:value={
        () => app.themeFor(mode)?.id ?? "default",
        (v) => {
          const id = v === "default" ? "" : v;
          if (mode === "dark") app.settings.darkTheme = id;
          else app.settings.lightTheme = id;
          apply();
        }
      }
      contentClass="above-modal"
    >
      {#snippet item({ value, label, selected })}
        {@const c = tokensFor(all.find((x) => x.id === value), app.settings.accent, mode)}
        <span class="item-lead">
          <span class="check-gutter">{#if selected}<Icon name="check" size={10} />{/if}</span>
          <span class="term-theme-swatch" style="background: {c.bg}">
            <span style="background: {c.panelBg}"></span>
            <span style="background: {c.text}"></span>
            <span style="background: {c.accent}"></span>
          </span>
        </span>
        <span class="dropdown-item-label">{label}</span>
      {/snippet}
    </Dropdown>
  </div>
{/snippet}

{#snippet tab(value: string, label: string, icon: ComponentProps<typeof Icon>["name"])}
  <Tabs.Trigger value={value} class="settings-tab-trigger {settingsSearch && tabHasMatch[value] === false ? 'tab-dim' : ''}" onclick={() => viewport.narrow && void nav.push("tab")}>
    <Icon name={icon} size={14} /> {label}
  </Tabs.Trigger>
{/snippet}

<svelte:window onkeydowncapture={(e) => (onRecordKey(e), focusSearchOnSlash(e))} />

{#snippet discordCard(kind: "chat" | "editor", title: string)}
  {@const p = discordPreviews[kind]}
  {@const large = discordImageSrc(p?.assets?.large_image ?? "")}
  {@const small = discordImageSrc(p?.assets?.small_image ?? "")}
  <div class="discord-pick">
    <span class="discord-pick-title">{title}</span>
    <span class="discord-card">
      <span class="discord-card-head">
        {DISCORD_ACTIVITY_LABELS[discordSettings.activityType]}
        <Icon name="dots" size={16} />
      </span>
      <span class="discord-activity">
        <span class="discord-art">
          {#if large}
            <img src={large} alt="" />
          {:else}
            <span class="discord-art-fallback"><Icon name="brand-discord" size={22} /></span>
          {/if}
          {#if p?.assets?.small_image}
            <span class="discord-badge">
              {#if small}
                <img src={small} alt="" />
              {:else}
                <Icon name="brand-discord" size={10} />
              {/if}
            </span>
          {/if}
        </span>
        <span class="discord-body">
          <strong class="discord-name">{discordAppName}</strong>
          {#if p}
            {#if p.details}<span class="discord-details">{p.details}</span>{/if}
            {#if p.state}<span class="discord-state">{p.state}</span>{/if}
            {#if p.timestamps}
              <span class="discord-time"><Icon name="device-gamepad" size={14} />{formatElapsed(discordNow - p.timestamps.start)}</span>
            {/if}
          {:else}
            <span class="discord-state">Nothing would show right now.</span>
          {/if}
        </span>
      </span>
      {#if p?.buttons?.length}
        <span class="discord-buttons">
          {#each p.buttons as b (b.label)}
            <span class="discord-button">{b.label}</span>
          {/each}
        </span>
      {/if}
    </span>
  </div>
{/snippet}

{#snippet bindSlot(a: KeyAction, slot: number, combo: string | undefined)}
  {@const recording = rec?.id === a.id && rec.slot === slot}
  <span class="bind" class:recording class:empty={!combo}>
    <button
      type="button"
      class="bind-main"
      onclick={() => (recording ? stopRecording() : startRecording(a.id, slot))}
      onblur={() => recording && !rec?.combo && stopRecording()}
      aria-label={combo ? `Change ${a.label} shortcut` : `Add a ${a.label} shortcut`}
    >
      {#if recording && !rec?.combo}
        <span class="bind-prompt">Press keys…</span>
      {:else if recording && rec?.combo}
        <Kbd combo={rec.combo} />
      {:else if combo}
        <Kbd {combo} />
      {:else}
        <Icon name="plus" size={12} />
      {/if}
    </button>
    {#if combo && !recording}
      <button type="button" class="bind-x" {@attach tip("Remove")} onclick={() => removeBind(a.id, slot)}>
        <Icon name="xmark" size={11} />
      </button>
    {/if}
  </span>
{/snippet}

<Dialog.Root bind:open={app.showSettings}>
  <Dialog.Portal>
    <Dialog.Overlay class="settings-overlay" />
    <SheetDialog variant="page" class="settings-content">
      <Dialog.Close class="settings-close" aria-label="Close settings"><Icon name="xmark" size={18} /></Dialog.Close>

      <div class="settings-swipe" {@attach swipe(goBack)} {@attach hostEl}>
      <Tabs.Root bind:value={app.settingsTab} orientation="vertical" class="settings-tabs">
        <Tabs.List class="tabs-list">
          <div class="settings-bar">
            <Dialog.Close class="settings-exit" aria-label="Close settings"><Icon name="chevron-left" size={16} /></Dialog.Close>
            <Dialog.Title class="settings-title">Settings</Dialog.Title>
          </div>
          <div class="settings-search"><SearchInput bind:value={settingsSearch} placeholder="Search settings…" hint="/" /></div>
          {#if noMatches}<div class="no-matches">No settings match “{settingsSearch.trim()}”</div>{/if}

          <button type="button" class="profile-tile" onclick={() => void nav.push("profile")}>
            <span class="pt-avatar">
              {#if isPhotoAvatar(me.avatar)}
                <img src={avatarSrc(me.avatar)} alt="" />
              {:else}
                <span class="emoji">{me.avatar || "🐣"}</span>
              {/if}
              <span class="pt-badge"><Icon name="pencil" size={12} /></span>
            </span>
            <span class="pt-who">
              <b>{me.name || "anonymous"}</b>
              <small>{connectedCount} of {serverCount} server{serverCount === 1 ? "" : "s"} connected</small>
            </span>
          </button>

          <div class="tabs-group-label">App</div>
          <div class="tabs-group">
          {@render tab("profile", "General", "user")}
          {@render tab("appearance", "Appearance", "palette")}
          {@render tab("text", "Text & code", "terminal-2")}
          {#if !viewport.narrow}{@render tab("keyboard", "Keyboard", "keyboard")}{/if}
          {@render tab("integrations", "Discord", "brand-discord")}
          {@render tab("servers", "Servers", "server")}
          </div>

          <div class="tabs-group-label" {@attach tip("These apply to one server. Pick which at the top of each page.")}>
            {server ? server.label : "Server"}
          </div>
          <div class="tabs-group">
          {@render tab("general", "Server", "settings")}
          {@render tab("providers", "Providers", "brain")}
          {@render tab("models", "Models", "sparkles")}
          {@render tab("projects", "Projects", "code")}
          {@render tab("safety", "Safety", "shield-check")}
          {@render tab("notifications", "Notifications", "bell")}
          {@render tab("access", "Access", "network")}
          </div>
        </Tabs.List>

        <div class="settings-main" {@attach hairline}>
          {@render settingsHead()}
        <Tabs.Content value="profile" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "profile", query: settingsSearch }}>
            {@render pageHead("General", false)}
            {#if viewport.narrow}
              <SubPage id="profile" title="Profile" link={false}>
                <div class="hero">
                  <button type="button" class="hero-av" aria-label="Edit picture" onclick={onAvatarTap}>
                    {@render face(96)}
                    <span class="hero-badge"><Icon name="pencil" size={14} /></span>
                  </button>
                  <b>{me.name || "anonymous"}</b>
                  <small>This device</small>
                </div>
                <section class="settings-section">
                  <h3 class="section-heading"><Icon name="id" size={15} />Display name</h3>
                  <div class="card">
                    <div class="field">
                      <TextField type="text" placeholder="anonymous" bind:value={nameDraft} onchange={onProfileNameChange} />
                      <span class="hint">{server?.user ? `Shown to other people on ${server.label}.` : "Shown to other people on the servers you connect to."}</span>
                    </div>
                  </div>
                </section>
                <section class="settings-section">
                  <h3 class="section-heading"><Icon name="media-image" size={15} />Picture</h3>
                  <div class="card">
                    <button type="button" class="go-row" onclick={onAvatarTap}>
                      <span class="go-text"><span>Edit picture</span><small>Presets, upload, crop</small></span>
                      <Icon name="chevron-right" size={16} />
                    </button>
                  </div>
                  <p class="hint">Pictures are cropped square and scaled to 96×96 before they leave this device.</p>
                </section>
                <section class="settings-section">
                  <h3 class="section-heading"><Icon name="eye" size={15} />How others see you</h3>
                  <div class="card">
                    <div class="setting-row seen">
                      {@render face(36)}
                      <div class="setting-text">
                        <span class="row-label">{me.name || "anonymous"}</span>
                        <span class="hint">This device · online now</span>
                      </div>
                    </div>
                  </div>
                </section>
                <section class="settings-section">
                  <h3 class="section-heading"><Icon name="share-2" size={15} />Shared with</h3>
                  <div class="card">
                    {#each serverList as r (r.key)}
                      <div class="setting-row">
                        <ServerAvatar name={r.label} seed={r.seed} size={22} />
                        <div class="setting-text"><span class="row-label">{r.label}</span></div>
                        <span class="hint">{r.status}</span>
                      </div>
                    {:else}
                      <div class="setting-row"><span class="hint">No servers yet.</span></div>
                    {/each}
                  </div>
                </section>
              </SubPage>
              <SubPage id="avatar" title="Edit picture" link={false} lazy>
                {#snippet end()}
                  <button type="button" class="sp-done" onclick={() => editor?.save()}>Done</button>
                {/snippet}
                <AvatarEditor
                  bind:this={editor}
                  bare
                  current={me.avatar}
                  emojis={QUICK_AVATARS}
                  oncancel={() => void nav.pop()}
                  onsave={(v) => {
                    pushAvatar(v);
                    void nav.pop();
                  }}
                />
              </SubPage>
            {:else}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="user" size={15} />Profile</h3>
              <div class="card">
              <div class="field profile-card">
                <button
                  type="button"
                  class="avatar-preview"
                  onclick={onAvatarTap}
                  {@attach tip("Choose a picture")}
                  disabled={uploadingAvatar}
                >
                  {#if isPhotoAvatar(me.avatar)}
                    <img src={avatarSrc(me.avatar)} alt="" />
                  {:else}
                    <span class="emoji">{me.avatar || "🐣"}</span>
                  {/if}
                  <span class="avatar-edit"><Icon name="media-image" size={13} /></span>
                </button>
                <div class="profile-fields">
                  <label class="profile-name">
                    <span class="row-label">Display name</span>
                    <TextField type="text" placeholder="anonymous" bind:value={nameDraft} onchange={onProfileNameChange} />
                    <span class="hint">{server?.user ? `Shown to other people on ${server.label}.` : "Shown to other people on the servers you connect to."}</span>
                  </label>
                  <div class="btn-row">
                    <Button type="button" onclick={onAvatarTap} disabled={uploadingAvatar}>
                      <Icon name="media-image" size={13} />
                      {uploadingAvatar ? "Reading…" : isPhotoAvatar(me.avatar) ? "Replace picture" : "Choose picture"}
                    </Button>
                    {#if isPhotoAvatar(me.avatar)}
                      <Button type="button" variant="ghost" onclick={() => setEmojiAvatar(QUICK_AVATARS[0])}>Remove</Button>
                    {/if}
                  </div>
                </div>
              </div>
              <input bind:this={avatarInput} type="file" accept="image/*" hidden onchange={onAvatarFile} />
              <div class="quick-avatars">
                {#each QUICK_AVATARS as emoji (emoji)}
                  <button
                    type="button"
                    class="quick-avatar"
                    class:active={me.avatar === emoji}
                    {@attach tip(`Use ${emoji} instead of a picture`)}
                    onclick={() => setEmojiAvatar(emoji)}
                  >
                    {emoji}
                  </button>
                {/each}
              </div>
              <p class="hint">Pictures are cropped square and scaled to 96×96 before they leave this device.</p>
              </div>
            </section>
            {/if}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="message-circle" size={15} />Chats</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText("Tool calls and thinking", "Simple folds them into one dropdown above the answer.")}
                {@render choiceCards(
                  "tools",
                  [
                    { value: "simple", label: "Simple" },
                    { value: "verbose", label: "Verbose" },
                  ],
                  app.settings.toolView,
                  (v) => ((app.settings.toolView = v as "simple" | "verbose"), apply()),
                )}
              </div>
              <div class="setting-row">
                {@render rowText("New chat feed", "Recent chats and starter prompts in an empty chat.")}
                {@render toggle(app.settings.emptyFeed, (v) => ((app.settings.emptyFeed = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText(
                  "Summarize long replies",
                  "A short summary card under each long reply.",
                  "Written by the Titles & summaries model. Any reply can also be summarized from its actions.",
                )}
                {@render toggle(app.settings.autoSummary, (v) => ((app.settings.autoSummary = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText(
                  "Auto-archive idle chats",
                  "Untouched chats drop into Archived after this long. 0 keeps them until you archive them.",
                )}
                <div class="with-unit">
                  <NumberField class="ctrl-num" min={0} max={365} bind:value={app.settings.autoArchiveDays} onchange={apply} />
                  <span>days</span>
                </div>
              </div>
              <div class="setting-row" data-setting="sidebar-cards">
                {@render rowText("New sidebar style", "Card chats and a slimmer projects tab. Off keeps the classic sidebar.")}
                {@render toggle(app.settings.sidebarCards, (v) => ((app.settings.sidebarCards = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText(
                  "Group chats",
                  "How the list and the Archived shelf split: by server then project, by project only, or flat.",
                )}
                {@render segmented(
                  [
                    { value: "remote", label: "Remote" },
                    { value: "project", label: "Project" },
                    { value: "none", label: "None" },
                  ],
                  app.settings.sidebarGrouping,
                  (v) => ((app.settings.sidebarGrouping = v as "remote" | "project" | "none"), apply()),
                )}
              </div>
              {#if app.active && !app.active.limited}
                <div class="setting-row">
                  {@render rowText("When a usage limit is hit", "Continuing waits for the limit to reset, then picks the chat back up.")}
                  {@render segmented(
                    [
                      { value: "ask", label: "Ask me" },
                      { value: "continue", label: "Continue automatically" },
                      { value: "stop", label: "Stop" },
                    ],
                    app.active.limitAction,
                    (v) => app.activeConnectionId && setLimitAction(app.activeConnectionId, v as LimitAction),
                  )}
                </div>
              {/if}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="bell" size={15} />Alerts</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText(
                  isDesktop ? "Desktop alerts on this device" : "Browser alerts on this device",
                  isDesktop ? "Only while the window is in the background." : webAlerts === "denied" ? "Blocked: allow notifications for this site in the browser's settings." : webAlerts === "unsupported" ? "This browser can't show them." : webAlerts === "default" ? "Allow them in this browser first." : "Only while this tab is in the background and open.",
                  "Never for the chat you're reading, or while another of your devices is in use.",
                )}
                {#if !isDesktop && webAlerts === "default" && app.settings.osNotifications !== "off"}
                  <Button type="button" onclick={() => void requestWebAlerts().then((p) => (webAlerts = p))}>Allow</Button>
                {/if}
                <Dropdown
                  items={[
                    { value: "off", label: "Off" },
                    { value: "urgent", label: "When it needs you" },
                    { value: "all", label: "Also when it finishes" },
                  ]}
                  bind:value={() => app.settings.osNotifications, (v) => ((app.settings.osNotifications = v as typeof app.settings.osNotifications), apply(), !isDesktop && v !== "off" && void requestWebAlerts().then((p) => (webAlerts = p)))}
                  contentClass="above-modal"
                />
              </div>
              </div>
            </section>
            {#if localServerSupported}
              <section class="settings-section">
                <h3 class="section-heading"><Icon name="power" size={15} />Closing</h3>
                <div class="card">
                <div class="setting-row">
                  {@render rowText(
                    "Stop the server when closing",
                    "Quitting the app also stops the local server.",
                    "You'll be asked first if chats or terminals are still running.",
                  )}
                  {@render toggle(app.settings.stopServerOnClose, (v) => ((app.settings.stopServerOnClose = v), apply()))}
                </div>
                </div>
              </section>
            {/if}
            <section class="settings-section">
              <div class="card">
              <div class="setting-row">
                {@render rowText("Settings file", "Move your settings to another install, or back them up.", settingsFileMsg || "Server pairings and sign-ins stay where they are.")}
                <Button type="button" onclick={exportSettings}>Export</Button>
                <Button type="button" onclick={() => settingsFileInput?.click()}>Import…</Button>
                <input bind:this={settingsFileInput} type="file" accept="application/json,.json" hidden onchange={importSettings} />
              </div>
              <div class="setting-row">
                {@render rowText("Setup", "Walk through connecting a server, a provider and a project again.")}
                <Button type="button" onclick={() => ((app.settings.onboarded = false), apply(), (app.showSettings = false))}>Run setup again</Button>
              </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="appearance" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "appearance", query: settingsSearch }}>
            {@render pageHead("Appearance", false)}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="palette" size={15} />Theme</h3>
              <div class="card">
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
                              <span class="sk-toggle on" style="background: {mode.id === "light" ? lightPreview.accent : darkPreview.accent}"></span>
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
              {#if accentUsed}
              <div class="field">
                <span class="row-label">Accent</span>
                <div class="accent-row">
                  <button
                    type="button"
                    class="swatch wallpaper-swatch"
                    class:active={app.settings.accentFromWallpaper}
                    disabled={!app.settings.wallpaper}
                    {@attach tip(app.settings.wallpaper ? "Use the wallpaper's color" : "Set a wallpaper below to use this")}
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
              {/if}
              <SubPage id="presets" title="Theme presets" inCard wrap={cardPage} link={{ value: `${app.themeFor("dark")?.name ?? "Default"} · ${app.themeFor("light")?.name ?? "Default"}`, hint: "Dark and light themes, custom themes" }}>
              {#if app.settings.theme !== "light"}
                {@render slotPicker("dark", "Dark theme")}
              {/if}
              {#if app.settings.theme !== "dark"}
                {@render slotPicker("light", "Light theme")}
              {/if}
              {#if isDesktop}
                <div class="setting-row">
                  {@render rowText("Custom themes", themeNote ?? "One .json file per theme. Changes apply as you save.")}
                  <div class="btn-row">
                    <Button type="button" onclick={revealThemesFile}>Open folder</Button>
                    <Button type="button" onclick={reloadThemes}>Reload</Button>
                  </div>
                </div>
              {/if}
              </SubPage>
              </div>
            </section>
            <SubPage id="wallpaper" title="Wallpaper" link={{ value: app.settings.wallpaper ? "Image set" : "None", hint: "Shown behind an empty thread's composer." }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="wallpaper" size={15} />Wallpaper</h3>
              <div class="card">
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
                  <Button type="button"
                    icon
                    onclick={() => wallpaperInput?.click()}
                    {@attach tip(app.settings.wallpaper ? "Change image" : "Choose image")}
                  >
                    <Icon name="pencil" size={13} />
                  </Button>
                  {#if app.settings.wallpaper}
                    <Button type="button" icon destructive onclick={clearWallpaper} {@attach tip("Remove image")}>
                      <Icon name="trash" size={13} />
                    </Button>
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
                      { value: "mosaic", label: "Soft mosaic" },
                      { value: "gameboy", label: "GameBoy" },
                      { value: "none", label: "None" },
                    ]}
                    bind:value={
                      () => app.settings.wallpaperStyle,
                      (v) => ((app.settings.wallpaperStyle = v as "dither" | "scanlines" | "mosaic" | "gameboy" | "none"), apply())
                    }
                    contentClass="above-modal"
                  />
                </div>
              {/if}
              </div>
            </section>
            </SubPage>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="app-window" size={15} />Window</h3>
              <div class="card">
              <div class="pair">
              {#if !viewport.narrow}
                <div class="field">
                  {@render rowText("Main area")}
                  {@render choiceCards(
                    "area",
                    [
                      { value: "floating", label: "Floating" },
                      { value: "flat", label: "Flat" },
                    ],
                    app.settings.mainArea,
                    (v) => ((app.settings.mainArea = v as "floating" | "flat"), apply()),
                  )}
                </div>
              {/if}

              <div class="field">
                {@render rowText("Surfaces")}
                {@render choiceCards(
                  "surface",
                  [
                    { value: "opaque", label: "Opaque" },
                    { value: "frosted", label: "Frosted" },
                  ],
                  app.settings.surface,
                  (v) => ((app.settings.surface = v as "opaque" | "frosted"), apply()),
                )}
              </div>

              </div>
              {#if windowChromeKind}
                <div class="setting-row">
                  {@render rowText(
                    "Window controls",
                    "Minimize, maximize, close, and dragging by the top edge." + (windowChromeKind === "overlay" ? " Needs a restart." : ""),
                  )}
                  {@render toggle(app.settings.windowChrome, (v) => ((app.settings.windowChrome = v), apply()))}
                </div>
              {/if}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="wind" size={15} />Motion</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText("Animation speed", "0 turns them off.")}
                <div class="slider">
                  <Slider label="Animation speed" min={0} max={2} step={0.1} bind:value={app.settings.animationSpeed} oninput={apply} format={(v) => `${v.toFixed(1)}×`} />
                  <span class="slider-value">{app.settings.animationSpeed.toFixed(1)}×</span>
                </div>
              </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="text" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "text", query: settingsSearch }}>
            {@render pageHead("Text & code", false)}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="layout-dashboard" size={15} />Interface</h3>
              <div class="card">
              <div class="type-preview" style:font-family={app.settings.uiFontFamily} style:font-size="{scalePct}%">
                <strong>The quick brown fox</strong>
                <span>jumps over the lazy dog, 0123456789.</span>
              </div>
              <div class="setting-row">
                {@render rowText("Font")}
                <TextField type="text" class="ctrl-wide" bind:value={app.settings.uiFontFamily} onchange={apply} />
              </div>
              <div class="setting-row">
                {@render rowText("Scale")}
                <div class="slider">
                  <Slider label="Interface scale" min={80} max={140} step={5} bind:value={scalePct} onchange={applyScale} format={(v) => `${v}%`} />
                  <span class="slider-value">{scalePct}%</span>
                </div>
              </div>
              </div>
            </section>
            <div class="sub-group">
            <SubPage id="code" title="Code blocks" inCard link={{ value: app.settings.codeWrapLines ? "Wrapped" : "Scrolls", hint: "Font, wrapping, line numbers, colors" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="code" size={15} />Code blocks</h3>
              <div class="card">
              <div class="code-preview"><Markdown text={CODE_PREVIEW} /></div>
              <div class="setting-row">
                {@render rowText("Font")}
                <TextField type="text" class="ctrl-wide" bind:value={app.settings.codeFontFamily} onchange={apply} />
              </div>
              <div class="setting-row">
                {@render rowText("Font size")}
                <div class="with-unit">
                  <NumberField class="ctrl-num" min={10} max={18} step={0.5} bind:value={app.settings.codeFontSize} onchange={apply} />
                  <span>px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Wrap long lines")}
                {@render toggle(app.settings.codeWrapLines, (v) => ((app.settings.codeWrapLines = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText("Line numbers", "A numbered gutter beside each code block.")}
                {@render toggle(app.settings.codeLineNumbers, (v) => ((app.settings.codeLineNumbers = v), apply()))}
              </div>
              <div class="setting-row">
                {@render rowText("Colors")}
                {@render presetPicker(
                  () => (app.settings.codeUseAppTheme ? "app" : app.settings.codeColorTheme),
                  (v) => {
                    app.settings.codeUseAppTheme = v === "app";
                    if (v !== "app") app.settings.codeColorTheme = v;
                    apply();
                  },
                )}
              </div>
              </div>
            </section>
            </SubPage>
            <SubPage id="diffs" title="Diffs" inCard link={{ value: app.settings.diffColors === "colorblind" ? "Colorblind" : "Green / red", hint: "Colors" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="file-diff" size={15} />Diffs</h3>
              <div class="card">
              <div class="diff-sample" aria-hidden="true">
                <div><i>1</i><span><b class="k">export function</b> <b class="f">formatUser</b>(user: <b class="t">User</b>) {"{"}</span></div>
                <div class="del"><i>2</i><span>{"  "}<b class="k">return</b> user.name.<mark>toUpperCase()</mark>;</span></div>
                <div class="add"><i>2</i><span>{"  "}<b class="k">return</b> <mark><b class="s">`{"${"}</b>user.name<b class="s">{"}"} &lt;{"${"}</b>user.email<b class="s">{"}"}&gt;`</b></mark>;</span></div>
                <div><i>3</i><span>{"}"}</span></div>
              </div>
              <div class="setting-row">
                {@render rowText("Colors")}
                {@render segmented(
                  [
                    { value: "default", label: "Green / red" },
                    { value: "colorblind", label: "Blue / orange" },
                  ],
                  app.settings.diffColors,
                  (v) => ((app.settings.diffColors = v as "default" | "colorblind"), apply()),
                )}
              </div>
              </div>
            </section>
            </SubPage>
            <SubPage id="term" title="Terminal" inCard link={{ hint: "Colors, padding, scrolling" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="terminal-2" size={15} />Terminal</h3>
              <div class="card">
              <TerminalPreview colors={termColors} />
              <div class="setting-row">
                {@render rowText("Colors")}
                {@render presetPicker(
                  () => (app.settings.terminalUseAppTheme ? "app" : app.settings.terminalColorTheme),
                  (v) => {
                    app.settings.terminalUseAppTheme = v === "app";
                    if (v !== "app") app.settings.terminalColorTheme = v;
                    apply();
                  },
                )}
              </div>
              <div class="setting-row">
                {@render rowText("Horizontal padding")}
                <div class="slider">
                  <Slider label="Horizontal padding" min={0} max={40} bind:value={app.settings.terminalMarginX} oninput={apply} format={(v) => `${v}px`} />
                  <span class="slider-value">{app.settings.terminalMarginX}px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Vertical padding")}
                <div class="slider">
                  <Slider label="Vertical padding" min={0} max={40} bind:value={app.settings.terminalMarginY} oninput={apply} format={(v) => `${v}px`} />
                  <span class="slider-value">{app.settings.terminalMarginY}px</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Smooth scrolling", "Eases wheel movement.")}
                {@render toggle(app.settings.terminalSmoothScroll, (v) => ((app.settings.terminalSmoothScroll = v), apply()))}
              </div>
              </div>
            </section>
            </SubPage>
            </div>
          </div>
        </Tabs.Content>


        

        <Tabs.Content value="integrations" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "integrations", query: settingsSearch }}>
            {@render pageHead("Discord", false)}
            {#if !isDesktop}
              <p class="hint">Discord Rich Presence is only available in the desktop app.</p>
            {:else}
              <section class="settings-section">
                <div class="card">
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="row-label">Show what I'm working on</span>
                    <span class="discord-status" class:on={rpcStatus.connected} class:error={discordSettings.enabled && !rpcStatus.connected && !!rpcStatus.error}>
                      <span class="dot"></span>{discordStatusText}
                    </span>
                  </div>
                  {@render toggle(app.settings.discordRpc.enabled, (v) => ((app.settings.discordRpc.enabled = v), apply()))}
                </div>
                <div class="discord-stage" class:off={!discordSettings.enabled}>
                  <span class="hint">What your profile shows.</span>
                  <div class="discord-cards">
                    {@render discordCard("chat", "In a chat")}
                    {@render discordCard("editor", "In the editor")}
                  </div>
                </div>
                </div>
              </section>

              <section class="settings-section">
                <h3 class="section-heading"><Icon name="cards" size={15} />Both cards</h3>
                <div class="card">
                <div class="setting-row">
                  {@render rowText("Show", "Auto switches between the chat and editor card.")}
                  <Dropdown
                    items={DISCORD_PRESENCE_MODES}
                    bind:value={() => app.settings.discordRpc.mode, (v) => (app.settings.discordRpc.mode = v as typeof app.settings.discordRpc.mode, apply())}
                    contentClass="above-modal"
                  />
                </div>
                <div class="setting-row">
                  {@render rowText("Activity word", "Discord shows this before the app name, e.g. Playing.")}
                  <Dropdown
                    items={DISCORD_ACTIVITY_TYPES}
                    bind:value={() => app.settings.discordRpc.activityType, (v) => (app.settings.discordRpc.activityType = v as typeof app.settings.discordRpc.activityType, apply())}
                    contentClass="above-modal"
                  />
                </div>
                <div class="setting-row">
                  {@render rowText("Member list text", "Which line shows beside your name in member lists.")}
                  <Dropdown
                    items={DISCORD_STATUS_DISPLAY_TYPES}
                    bind:value={() => app.settings.discordRpc.statusDisplayType, (v) => (app.settings.discordRpc.statusDisplayType = v as typeof app.settings.discordRpc.statusDisplayType, apply())}
                    contentClass="above-modal"
                  />
                </div>
                <details class="disclosure" open={!!settingsSearch.trim()}>
                  <summary>
                    {@render rowText("Buttons", app.settings.discordRpc.showButtons ? "Two links under the card. Discord hides your own buttons from you." : "Off")}
                    <span class="disclosure-chevron"><Icon name="chevron-down" size={14} /></span>
                  </summary>
                  <div class="disclosure-body">
                    <div class="setting-row">
                      {@render rowText("Show buttons", "Each needs a label and an http(s) link.")}
                      {@render toggle(app.settings.discordRpc.showButtons, (v) => ((app.settings.discordRpc.showButtons = v), apply()))}
                    </div>
                    {#if app.settings.discordRpc.showButtons}
                      <div class="form-grid">
                        <label>First label <TextField bind:value={app.settings.discordRpc.button1Label} onchange={apply} placeholder="Website" /></label>
                        <label>First link <TextField bind:value={app.settings.discordRpc.button1Url} onchange={apply} placeholder="https://…" /></label>
                        <label>Second label <TextField bind:value={app.settings.discordRpc.button2Label} onchange={apply} placeholder="Optional" /></label>
                        <label>Second link <TextField bind:value={app.settings.discordRpc.button2Url} onchange={apply} placeholder="https://…" /></label>
                      </div>
                    {/if}
                  </div>
                </details>
                </div>
              </section>

              <section class="settings-section">
                <h3 class="section-heading"><Icon name="pencil" size={15} />Editing: {discordPreviewKind === "chat" ? "In a chat" : "In the editor"}</h3>
                <p class="hint">Text and images differ per card. Only this card changes.</p>
                <div class="card">
                  <div class="setting-row">
                    {@render rowText("Card", "Which card to edit.")}
                    {@render segmented(
                      [
                        { value: "chat", label: "In a chat" },
                        { value: "editor", label: "In the editor" },
                      ],
                      discordPreviewKind,
                      (v) => (discordPreviewKind = v as "chat" | "editor"),
                    )}
                  </div>
                  {#if discordPreviewKind === "chat"}
                    <div class="setting-row">
                      {@render rowText("Hide on plain chats", "Only show chats that belong to a project.")}
                      {@render toggle(app.settings.discordRpc.hideOnChats, (v) => ((app.settings.discordRpc.hideOnChats = v), apply()))}
                    </div>
                    <div class="setting-row">
                      {@render rowText("Show when idle", "Keep a card while no chat is open.")}
                      {@render toggle(app.settings.discordRpc.showWhenIdle, (v) => ((app.settings.discordRpc.showWhenIdle = v), apply()))}
                    </div>
                  {:else}
                    <div class="setting-row">
                      {@render rowText("Editor timer", "When the elapsed time restarts.")}
                      <Dropdown
                        items={DISCORD_EDITOR_TIMER_SCOPES}
                        bind:value={() => app.settings.discordRpc.editorTimerScope, (v) => (app.settings.discordRpc.editorTimerScope = v as typeof app.settings.discordRpc.editorTimerScope, apply())}
                        contentClass="above-modal"
                      />
                    </div>
                  {/if}
                  <div class="card-pad edit-body">
                    {#each DISCORD_GROUPS as [title, from, to] (title)}
                      <div class="field-group">
                        <span class="field-group-title">{title}</span>
                        <div class="form-grid" class:three={to - from === 3}>
                          {#each DISCORD_FIELDS[discordPreviewKind].slice(from, to) as [key, label, ph] (key)}
                            <label>
                              {label}
                              <TextField bind:value={app.settings.discordRpc[key]} onchange={apply} placeholder={ph} />
                            </label>
                          {/each}
                        </div>
                      </div>
                    {/each}
                    {#if discordPreviewKind === "chat" && app.settings.discordRpc.showWhenIdle}
                      <div class="field-group">
                        <span class="field-group-title">While idle</span>
                        <div class="form-grid">
                          <label>Details <TextField bind:value={app.settings.discordRpc.idleDetails} onchange={apply} placeholder="Taking a break" /></label>
                          <label>State <TextField bind:value={app.settings.discordRpc.idleState} onchange={apply} placeholder="yoakeland" /></label>
                        </div>
                      </div>
                    {/if}
                    <p class="hint">
                      Use {(discordPreviewKind === "chat" ? DISCORD_TEMPLATE_VARS : DISCORD_EDITOR_TEMPLATE_VARS).map((v) => `{${v}}`).join(" ")} in any line. An empty line is hidden.
                    </p>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <h3 class="section-heading"><Icon name="adjustments-horizontal" size={15} />Advanced</h3>
                <div class="card">
                <details class="disclosure" open={!!settingsSearch.trim()}>
                  <summary>
                    {@render rowText("Advanced", "Your own Discord application.")}
                    <span class="disclosure-chevron"><Icon name="chevron-down" size={14} /></span>
                  </summary>
                  <div class="disclosure-body">
                    <div class="form-grid">
                      <label>
                        Application ID
                        <TextField bind:value={app.settings.discordRpc.clientId} onchange={apply} placeholder={DEFAULT_DISCORD_CLIENT_ID || "From the Discord Developer Portal"} />
                      </label>
                      <label>
                        Application name
                        <TextField bind:value={app.settings.discordRpc.name} onchange={apply} placeholder={discordAppName} />
                      </label>
                    </div>
                    <p class="hint">Blank uses yoakeland's own. Your own lets you change the name and art.</p>
                    <Button type="button" variant="ghost" class="align-start" onclick={async () => { if (!(await askConfirm("Reset all Discord settings, including both cards?"))) return; app.settings.discordRpc = { ...DEFAULT_DISCORD_RPC }; apply(); }}>
                      Reset everything to defaults
                    </Button>
                  </div>
                </details>
                </div>
              </section>
            {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="keyboard" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "keyboard", query: settingsSearch }}>
            {@render pageHead("Keyboard", false)}
            {#if anyCustomized}
              <div class="keys-intro">
                <Button type="button" size="sm" variant="ghost" onclick={() => (stopRecording(), resetBinds())}>
                  <Icon name="restore" size={12} /> Reset all
                </Button>
              </div>
            {/if}
            {#each actionGroups as [group, actions] (group)}
              <section class="settings-section">
                <h3 class="section-heading"><Icon name={GROUP_ICONS[group] ?? "keyboard"} size={15} />{group}</h3>
                <div class="card">
                {#each actions as a (a.id)}
                  {@const binds = bindsFor(a.id)}
                  <div class="setting-row keybind-row">
                    {@render rowText(a.label)}
                    <div class="binds">
                      {#if isCustomized(a.id)}
                        <Button type="button" icon variant="ghost" class="reset" {@attach tip("Reset to default")} onclick={() => resetBinds(a.id)}>
                          <Icon name="restore" size={12} />
                        </Button>
                      {/if}
                      {@render bindSlot(a, 0, binds[0])}
                      {#if binds.length || (rec?.id === a.id && rec.slot === 1)}
                        {@render bindSlot(a, 1, binds[1])}
                      {/if}
                    </div>
                  </div>
                  {#if rec?.id === a.id && rec.combo && rec.taken}
                    <div class="conflict" role="alert">
                      <Icon name="warning" size={13} />
                      <span class="grow">
                        <Kbd combo={rec.combo} /> is already used by {rec.taken.map((t) => t.label).join(", ")}.
                      </span>
                      <Button type="button" size="sm" variant="primary" onclick={() => commit(a.id, rec!.slot, rec!.combo!)}>Use here</Button>
                      <Button type="button" size="sm" variant="ghost" onclick={stopRecording}>Cancel</Button>
                    </div>
                  {/if}
                {/each}
                </div>
              </section>
            {/each}
          </div>
        </Tabs.Content>

        <Tabs.Content value="servers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "servers", query: settingsSearch }}>
            {@render pageHead("Servers", false)}
            <section class="settings-section">
              <p class="hint">Every server this app has connected to. Each settings page applies to one at a time.</p>
              <div class="card">
              <ul class="list">
                {#each serverList as r (r.key)}
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <li
                    class:tappable={viewport.narrow}
                    role={viewport.narrow ? "button" : undefined}
                    tabindex={viewport.narrow ? 0 : undefined}
                    onclick={() => viewport.narrow && void nav.push(`server-${r.key}`)}
                    onkeydown={(e) => viewport.narrow && e.key === "Enter" && void nav.push(`server-${r.key}`)}
                  >
                    <ServerAvatar name={r.label} seed={r.seed} size={22} />
                    <div class="list-text">
                      <span class="list-title">
                        {r.label}
                        <span class="status-dot {r.status}" {@attach tip(r.status)}></span>
                      </span>
                      <span class="list-meta" {@attach tip(r.address)}>{r.address}</span>
                    </div>
                    <span class="row-actions">{@render serverActions(r)}</span>
                    <span class="row-chev"><Icon name="chevron-right" size={16} /></span>
                    {#if viewport.narrow}
                    <SubPage id={`server-${r.key}`} title={r.label} link={false}>
                      <section class="settings-section">
                        <div class="card">
                          <div class="setting-row">
                            {@render rowText("Status", r.status)}
                          </div>
                          <div class="setting-row">
                            {@render rowText("Address", r.address)}
                          </div>
                          <div class="setting-row actions-row">{@render serverActions(r)}</div>
                        </div>
                      </section>
                    </SubPage>
                    {/if}
                  </li>
                {:else}
                  <li class="empty">No servers yet.</li>
                {/each}
              </ul>
              {#if viewport.narrow}
                <SubPage id="add-server" title="Add a server" inCard lazy link={{ hint: "Connect to another server" }}>
                  <section class="settings-section">
                    <div class="card"><div class="card-pad"><ConnectForm prefill={addPrefill ?? {}} showLocal={false} onconnected={() => ((addPrefill = null), void nav.pop())} /></div></div>
                  </section>
                </SubPage>
              {:else}
              <div class="card-pad">
              {#if addPrefill}
                {#key addPrefill}
                  <div class="inset-card">
                    <div class="inset-head">
                      <span class="row-label">Add a remote server</span>
                      <Button type="button" icon variant="ghost" onclick={() => (addPrefill = null)} {@attach tip("Cancel")}>
                        <Icon name="xmark" size={13} />
                      </Button>
                    </div>
                    <ConnectForm prefill={addPrefill} showLocal={false} onconnected={() => (addPrefill = null)} />
                  </div>
                {/key}
              {:else}
                <Button type="button" class="align-start" onclick={() => (addPrefill = {})}>
                  <Icon name="plus" size={13} /> Add server
                </Button>
              {/if}
              </div>
              {/if}
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="general" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "general", query: settingsSearch }}>
            {@render pageHead("Server", true)}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="server" size={15} />Server</h3>
              <div class="card">
              <form class="identity-row" onsubmit={submitServerIdentity}>
                {#if server && connected}<ServerIconEditor connectionId={server.connectionId} size={44} />{/if}
                <div class="identity-fields">
                  <TextField type="text" class="identity-name" placeholder="Server name" aria-label="Server name" bind:value={serverIdentityInput} disabled={!connected} />
                  <p class="hint">Name and icon are shown to everyone connected, on every device.</p>
                </div>
                {#if serverIdentityDirty}
                  <Button type="submit" variant="primary" disabled={!connected}>Save</Button>
                {/if}
              </form>
              {#if server?.outdated}
                <div class="setting-row">
                  {@render rowText("Out of date", `Running ${server.version ? fmtVersion(server.version) : "an unknown version"}, latest is v${app.latestServerVersion}.`)}
                  {#if server.connectionMode === "local" && app.updateServer}
                    <Button type="button" variant="primary" onclick={() => app.updateServer?.(server.connectionId)} disabled={!connected}>Update</Button>
                  {/if}
                </div>
              {/if}
              {#if server && !server.limited}
                <div class="setting-row">
                  {@render rowText("Restart", server.connectionMode === "local" ? "Runs the newest installed version. Running chats stop." : "Stops the server; it only comes back if something restarts it (systemd, a supervisor). Running chats stop.")}
                  <Button type="button" onclick={() => restartServer(server.connectionId)} disabled={!connected}>Restart</Button>
                </div>
              {/if}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="message-circle" size={15} />Chats</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText("Auto-generate titles", "Names new threads from their first message.")}
                {@render toggle(server?.autoGenerateTitleEnabled ?? true, onAutoGenerateTitleToggle, !connected)}
              </div>
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="stack-2" size={15} />Context</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText(
                  "Compact chats at",
                  "Summarized once context passes this. 0 uses 64,000.",
                  "Never above 90% of the model's window. Claude Code is told this as its context window and compacts about 33,000 tokens below that; other agents compact on their own. Change one chat with /autocompact. /compact summarizes now.",
                )}
                <span class="num-unit">
                  <NumberField
                    class="ctrl-num"
                    min={0}
                    step={10000}
                    disabled={!connected || !runtime}
                    value={runtime?.autoCompactTokens ?? 0}
                    onchange={(v) => patchRuntime({ autoCompactTokens: Math.max(0, Math.round(v || 0)) })}
                  />
                  <span class="hint">tokens</span>
                </span>
              </div>
              <div class="setting-row stacked">
                {@render rowText(
                  "Summary instructions",
                  "Steers every summary on an API provider.",
                  "Automatic or from /compact. It narrows the focus and never replaces the base prompt. A summary these make implausibly short is redone without them. Claude Code doesn't take it; give its /compact instructions after the command.",
                )}
                <TextArea
                  bind:value={compactInstructionsInput}
                  rows={2}
                  maxlength={4000}
                  disabled={!connected || !runtime}
                  placeholder="e.g. Keep the exact error messages and test commands."
                  onchange={() => patchRuntime({ compactInstructions: compactInstructionsInput })}
                />
              </div>
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="gauge" size={15} />Limits</h3>
              <div class="card">
              <div class="num-grid">
                {#each RESOURCE_SETTINGS.filter((r) => !r.key.startsWith("pool")) as r (r.key)}
                  <label class="num-cell">
                    <span class="row-label">{r.label}<span class="more" {@attach tip(r.hint)}><Icon name="info-circle" size={12} /></span></span>
                    <span class="num-unit">
                      <NumberField
                        class="ctrl-num"
                        min={r.min}
                        step={1}
                        disabled={!connected || !runtime}
                        value={runtime?.[r.key] ?? 0}
                        onchange={(v) => patchRuntime({ [r.key]: Math.max(r.min, Math.round(v || r.min)) })}
                      />
                      <span class="hint">{r.unit}</span>
                    </span>
                  </label>
                {/each}
              </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="safety" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "safety", query: settingsSearch }}>
            {@render pageHead("Safety", true)}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="gauge" size={15} />Limits</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText(
                  "Model calls per turn",
                  "A turn pauses and asks to continue after this many. 0 is no limit.",
                  "Coding agents like Claude Code run their own loop and aren't limited.",
                )}
                <NumberField

                  class="ctrl-num"
                  min={0}
                  step={1}
                  disabled={!connected || !runtime}
                  value={runtime?.maxRoundsPerTurn ?? 0}
                  onchange={(v) => patchRuntime({ maxRoundsPerTurn: Math.max(0, Math.round(v || 0)) })}
                />
              </div>
              <div class="setting-row">
                {@render rowText(
                  "Spend per chat (USD)",
                  "A chat pauses and asks to continue once it has spent this much. 0 is no limit.",
                  "Applies mid-turn too. Only priced usage counts.",
                )}
                <NumberField

                  class="ctrl-num"
                  min={0}
                  step={0.5}
                  disabled={!connected || !runtime}
                  value={runtime?.maxSessionCostUsd ?? 0}
                  onchange={(v) => patchRuntime({ maxSessionCostUsd: Math.max(0, v || 0) })}
                />
              </div>
              <div class="setting-row" class:danger-row={unsandboxedOpen.length > 0 && !runtime?.disableBashWhenUnsandboxed}>
                {@render rowText(
                  "Turn bash off without a sandbox",
                  "Hides bash and terminals from the model in projects that have none. Off by default.",
                  "Without bubblewrap or namespaces, bash and terminals run directly on the machine and can touch anything the server's user can.",
                )}
                {@render toggle(runtime?.disableBashWhenUnsandboxed ?? false, (v) => patchRuntime({ disableBashWhenUnsandboxed: v }), !connected || !runtime)}
              </div>
              {#if unsandboxedOpen.length > 0}
                <p class="hint danger-text">
                  <Icon name="warning" size={13} />
                  {unsandboxedOpen.length === 1 ? "1 open project has" : `${unsandboxedOpen.length} open projects have`} no sandbox:
                  {runtime?.disableBashWhenUnsandboxed ? "bash is off there." : "bash there is unprotected."}
                </p>
              {/if}
              <div class="setting-row">
                {@render rowText(
                  "Keep the browser on approved sites",
                  "Stops the agent following links to sites it isn't cleared for.",
                  "While the agent drives the browser, links and redirects to other sites are stopped and it has to ask. Your own navigation is never blocked.",
                )}
                {@render toggle(runtime?.browserBlockCrossOrigin ?? true, (v) => patchRuntime({ browserBlockCrossOrigin: v }), !connected || !runtime)}
              </div>
              </div>
            </section>
            <SubPage id="rules" title="Permission rules" link={{ hint: "What the agent may run without asking" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="shield-check" size={15} />Permissions</h3>
              <div class="card">
              <div class="card-pad"><PermissionRules {cid} projectPath={server?.currentProjectPath ?? undefined} /></div>
              </div>
            </section>
            </SubPage>
          </div>
        </Tabs.Content>

        <Tabs.Content value="notifications" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "notifications", query: settingsSearch }}>
            {@render pageHead("Notifications", true)}
            <section class="settings-section">
              <p class="hint">Only the first two are on by default. Nothing alerts for a chat you're viewing on any device.</p>
              <div class="card">
              <div class="setting-row">
                {@render rowText("Needs you", "Permission requests, questions from the agent, failed turns, the spend cap.")}
                {@render toggle(notifyPrefs.urgent, (v) => patchNotify({ urgent: v }), !connected)}
              </div>
              <div class="setting-row">
                {@render rowText("Worth knowing", "A long response finished in a chat you weren't watching; a response cut off at the output limit.")}
                {@render toggle(notifyPrefs.normal, (v) => patchNotify({ normal: v }), !connected)}
              </div>
              <div class="setting-row">
                {@render rowText("Devices", "A remote device connected or disconnected.")}
                {@render toggle(notifyPrefs.quiet, (v) => patchNotify({ quiet: v }), !connected)}
              </div>
              <div class="setting-row">
                {@render rowText("Announce finished responses after", "Seconds a turn must have run. Shorter ones stay quiet.")}
                <NumberField

                  class="ctrl-num"
                  min={0}
                  max={3600}
                  step={5}
                  disabled={!connected}
                  value={notifyPrefs.minTurnSec}
                  onchange={(v) => patchNotify({ minTurnSec: Math.max(0, Math.round(v || 0)) })}
                />
              </div>
              </div>
            </section>
            <SubPage id="kinds" title="Kinds" link={{ value: `${NOTIFY_KINDS.length - notifyPrefs.muted.length} of ${NOTIFY_KINDS.length} on`, hint: "Mute or allow each kind of alert" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="tag" size={15} />Kinds</h3>
              <div class="card">
              {#each NOTIFY_KINDS as k (k.kind)}
                <div class="setting-row">
                  {@render rowText(k.label)}
                  {@render toggle(!notifyPrefs.muted.includes(k.kind), (v) => setKindOn(k.kind, v), !connected)}
                </div>
              {/each}
              </div>
            </section>
            </SubPage>
          </div>
        </Tabs.Content>

        <Tabs.Content value="providers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "providers", query: settingsSearch }}>
            {@render pageHead("Providers", true)}
            <ProvidersPage {cid} {server} {connected} />
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="robot" size={15} />Coding agent processes</h3>
              <div class="card">
              <div class="num-grid">
                {#each RESOURCE_SETTINGS.filter((r) => r.key.startsWith("pool")) as r (r.key)}
                  <label class="num-cell">
                    <span class="row-label">{r.label}<span class="more" {@attach tip(r.hint)}><Icon name="info-circle" size={12} /></span></span>
                    <span class="num-unit">
                      <NumberField
                        class="ctrl-num"
                        min={r.min}
                        step={1}
                        disabled={!connected || !runtime}
                        value={runtime?.[r.key] ?? 0}
                        onchange={(v) => patchRuntime({ [r.key]: Math.max(r.min, Math.round(v || r.min)) })}
                      />
                      <span class="hint">{r.unit}</span>
                    </span>
                  </label>
                {/each}
              </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="models" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "models", query: settingsSearch }}>
            {@render pageHead("Models", true)}
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="brain" size={15} />Model roles</h3>
              <p class="hint">Send parts of the work to other models. Unset roles use the chat's model; coding agents skip these.</p>
              {#each ROLE_ROWS as r (r.key)}
                {@const efforts = roleEfforts(r.key)}
                <div class="setting-row">
                  {@render rowText(r.label, r.hint)}
                  <div class="btn-row">
                    <Dropdown
                      items={roleModelItems(r.key)}
                      bind:value={() => roleValue(r.key), (v) => pickRoleModel(r.key, v ?? "")}
                      placeholder="Same as chat"
                      searchable
                      contentClass="above-modal"
                    />
                    {#if efforts}
                      <Dropdown
                        items={efforts}
                        bind:value={() => server?.modelRoles[r.key]?.reasoningEffort ?? "", (v) => pickRoleEffort(r.key, v ?? "")}
                        contentClass="above-modal"
                      />
                    {/if}
                  </div>
                </div>
              {/each}
            </section>
          </div>
        </Tabs.Content>


        <Tabs.Content value="projects" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "projects", query: settingsSearch }}>
            {@render pageHead("Projects", true)}
            <section class="settings-section">
              <div class="card">
              <ul class="list">
                {#each (server?.recentProjects ?? []) as path (path)}
                  <li>
                    <Icon name="folder" size={14} />
                    <div class="list-text">
                      <span class="list-title">{basename(path)}</span>
                      <span class="list-meta" {@attach tip(path)}>{path}</span>
                    </div>
                    <Button type="button"
                      icon variant="ghost" destructive
                      onclick={() => {
                        server?.forgetProject(path);
                        if (cid) removeProject(cid, path);
                      }}
                      {@attach tip("Remove from list")}
                    >
                      <Icon name="trash" size={13} />
                    </Button>
                  </li>
                {:else}
                  <li class="empty">No projects yet.</li>
                {/each}
              </ul>
              <div class="card-pad">
                <Button type="button" disabled={!connected} onclick={() => cid && browseAndAddProject(cid)}>
                  <Icon name="folder-plus" size={13} /> Add project…
                </Button>
              </div>
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="access" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "access", query: settingsSearch }}>
            {@render pageHead("Access", true)}
            {#if connected}
              <p class="notice tier" class:limited={limitedHere}>
                <Icon name={limitedHere ? "warning" : "check"} size={13} />
                {#if isLocalConnection}
                  <strong>This computer.</strong> Full access to this server.
                {:else if server?.tierName === "trusted"}
                  <strong>Trusted access.</strong> You can work in projects already here, add Limited people and help run this server, but not reach the machine itself: no new folders, terminals, CLI agents, MCP servers or runtime settings unless the owner allows them.
                {:else if limitedHere}
                  <strong>Limited access.</strong> This device paired with a phone's code, so it can chat and edit files in projects already open here, but not add folders, providers, MCP servers or settings, open terminals or manage people. Ask the server's owner for full access (the device list marks each device's tier), or pair again with a full-access code (<code>yoakeland pair</code> on the server).
                {:else}
                  <strong>Full access.</strong> You can manage providers, projects, people and settings on this server. The remote listener and shared password can only be changed from the server's own machine.
                {/if}
              </p>
            {/if}

            <section class="settings-section">
              <h3 class="section-heading"><Icon name="world" size={15} />Remote access</h3>
              <div class="card">
              <div class="setting-row">
                {@render rowText("Allow remote (TCP) connections", "Exposes this server to the network. Anyone with a token or the password can connect.")}
                {@render toggle(server?.remoteAccessEnabled ?? false, onRemoteAccessToggle, !isLocalConnection)}
              </div>
              <div class="inset-card" class:disabled-row={!server?.remoteAccessEnabled}>
                <form class="setting-row" onsubmit={submitRemoteAddr}>
                  {@render rowText("Listen address", "Empty means :7890. Changing it restarts the listener.")}
                  <div class="btn-row">
                    <TextField type="text" class="ctrl-wide" placeholder=":7890" bind:value={remoteAddrInput} disabled={!isLocalConnection} />
                    <Button type="submit" disabled={!isLocalConnection || remoteAddrInput.trim() === (server?.remoteAddr ?? "")}>Save</Button>
                  </div>
                </form>
                <form class="setting-row" onsubmit={submitRemotePassword}>
                  {@render rowText("Shared password", "One secret for everyone. Prefer per-person tokens below.")}
                  <div class="btn-row">
                    <TextField type="password" class="ctrl-wide" placeholder="new password" bind:value={remotePasswordInput} disabled={!isLocalConnection} />
                    <Button type="submit" disabled={!isLocalConnection || !remotePasswordInput}>Set</Button>
                  </div>
                </form>
              </div>
              </div>
            </section>

            <div class="sub-group">
            <SubPage id="people" title="People" inCard link={{ hint: "Who can connect, and with what access" }}>
            <section class="settings-section">
              <div class="section-head">
                <h3 class="section-heading"><Icon name="users" size={15} />People</h3>
                {#if !addingPerson}
                  <Button type="button" size="sm" disabled={!canManagePeople} onclick={() => (addingPerson = true)}>
                    <Icon name="plus" size={13} /> Add person
                  </Button>
                {/if}
              </div>
              <p class="hint">Each person gets their own token. Their chats and git commits carry its name. Names can't change once registered; revoke and re-register to rename.</p>
              <div class="card">

              {#if server?.justRegisteredToken}
                <div class="warning-card">
                  <p class="warning-heading"><Icon name="warning" size={12} /> Copy this now</p>
                  <p class="hint">
                    Pairing code for <strong>{server.justRegisteredToken.name}</strong>. Shown only once. They paste
                    it into Add server; it carries the token{server.justRegisteredToken.caPem
                      ? " and this server's certificate"
                      : ""}.
                  </p>
                  <div class="btn-row">
                    <TextField
                      type="text"
                      readonly
                      value={encodePairingCode(server.justRegisteredToken.token, server.justRegisteredToken.caPem)}
                      onclick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button type="button"
                      variant="primary"
                      onclick={() => {
                        const t = server?.justRegisteredToken;
                        if (t) void navigator.clipboard?.writeText(encodePairingCode(t.token, t.caPem));
                        if (server) server.justRegisteredToken = null;
                      }}
                    >
                      <Icon name="copy" size={13} /> Copy &amp; dismiss
                    </Button>
                  </div>
                </div>
              {/if}

              {#if addingPerson}
                <form class="inset-card" onsubmit={submitToken}>
                  <div class="form-grid">
                    <label>Name <TextField type="text" placeholder="name" bind:value={tokenNameInput} disabled={!canManagePeople} /></label>
                    <label>
                      <span>Email <span class="optional">(optional)</span></span>
                      <TextField type="email" placeholder="for git commits" bind:value={tokenEmailInput} disabled={!canManagePeople} />
                    </label>
                  </div>
                  <div class="btn-row align-end">
                    <Button type="button" variant="ghost" onclick={() => (addingPerson = false)}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={!canManagePeople || !tokenNameInput.trim()}>
                      <Icon name="plus" size={13} /> Add
                    </Button>
                  </div>
                </form>
              {/if}

              {#if server?.people && cid}
                <PeoplePanel {cid} />
              {:else}
              <ul class="list">
                {#each (server?.tokens ?? []) as token (token.name)}
                  <li>
                    <span class="avatar-dot"><Icon name="user" size={13} /></span>
                    <div class="list-text">
                      <span class="list-title">{token.name}</span>
                      <span class="list-meta">{token.email ?? "no email"} · {token.restricted ? "limited access" : "full access"}</span>
                    </div>
                    <Button type="button"
                      icon variant="ghost" destructive
                      onclick={() => onRemoveToken(token.name)}
                      disabled={!canManagePeople}
                      {@attach tip("Revoke access")}
                    >
                      <Icon name="user-x" size={13} />
                    </Button>
                  </li>
                {:else}
                  <li class="empty">No one yet.</li>
                {/each}
              </ul>
              {/if}
              </div>
            </section>
            </SubPage>
            {#if server?.connectionStatus === "connected" && !server?.people}
              <SubPage id="peers" title="Connected now" inCard link={{ value: String((server?.peers ?? []).filter((p) => p.peerId !== server?.selfPeerId).length), hint: "Devices on this server" }}>
              <section class="settings-section">
                <h3 class="section-heading"><Icon name="plug-connected" size={15} />Connected now</h3>
                <div class="card">
                <ul class="list">
                  {#each (server?.peers ?? []).filter((p) => p.peerId !== server?.selfPeerId) as peer (peer.peerId)}
                    <li>
                      {#if isPhotoAvatar(peer.avatar ?? "")}
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
                      <Button type="button"
                        icon variant="ghost" destructive
                        onclick={() => onDisconnectPeer(peer.peerId, peer.name)}
                        {@attach tip("Disconnect")}
                      >
                        <Icon name="unlink" size={13} />
                      </Button>
                    </li>
                  {:else}
                    <li class="empty">No one else is connected.</li>
                  {/each}
                </ul>
                </div>
              </section>
              </SubPage>
            {/if}
            <SubPage id="audit" title="Audit log" inCard link={{ hint: "Kept on the server" }}>
            <section class="settings-section">
              <h3 class="section-heading"><Icon name="clipboard-list" size={15} />Audit log</h3>
              <p class="hint">Kept on the server (newest 15 MB). Never holds a password, token or key.</p>
              <div class="card">
              <AuditPanel cid={cid ?? null} connected={!!connected} />
              </div>
            </section>
            </SubPage>
            </div>
          </div>
        </Tabs.Content>
        </div>
        <div class="sub-stage"></div>
      </Tabs.Root>
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Dims without blurring: the dialog card is the only thing that frosts (--float-blur below).
     Blurring both layers would muddy the screen and lose the "pane of glass" look. */
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
  /* Dropdown.svelte's own z-index sits below this modal's; bump it above so it isn't
     rendered behind the settings panel. */
  :global(.above-modal) {
    z-index: var(--z-context-menu);
  }
  :global(.settings-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(62rem, 94vw);
    height: min(50rem, 90vh);
    display: flex;
    /* A dialog card is a floating surface like any other, see the --float-*
       tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-dialog);
    z-index: var(--z-overlay-content);
    overflow: hidden;
    animation: dialogIn var(--dialog-enter-duration) ease-out;
  }
  :global(.settings-content[data-state="closed"]) {
    animation: dialogOut var(--dialog-exit-duration) ease-in;
  }
  :global(.settings-close) {
    position: absolute;
    top: 0.67rem;
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
    padding: 0.57rem 0.71rem 1.14rem;
    overflow-y: auto;
    background: var(--wash-1);
    border-right: 1px solid var(--panel-border);
  }
  /* Kept for screen readers; the sidebar has no visible title. */
  :global(.settings-title) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .settings-search {
    display: flex;
  }
  .no-matches {
    margin: 0 0 0.57rem 0.57rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  /* Same small-caps label as the palette's group headings. */
  .tabs-group-label {
    flex-shrink: 0;
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.64rem;
    padding: 0.5rem 0.64rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-body-size);
    text-align: left;
    transition: background calc(0.1s * var(--anim-speed, 1)) ease, color calc(0.1s * var(--anim-speed, 1)) ease,
      opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.settings-tab-trigger .icon) {
    flex-shrink: 0;
    opacity: 0.7;
    transition: color calc(0.1s * var(--anim-speed, 1)) ease, opacity calc(0.1s * var(--anim-speed, 1)) ease;
  }
  :global(.settings-tab-trigger:hover) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  :global(.settings-tab-trigger:hover .icon) {
    opacity: 1;
  }
  :global(.settings-tab-trigger[data-state="active"]) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
    font-weight: 500;
  }
  :global(.settings-tab-trigger[data-state="active"]::before) {
    content: "";
    position: absolute;
    left: 0;
    top: 22%;
    bottom: 22%;
    width: 2px;
    border-radius: var(--radius-pill, 999px);
    background: var(--accent);
  }
  :global(.settings-tab-trigger[data-state="active"] .icon) {
    color: var(--accent);
    opacity: 1;
  }
  :global(.settings-tab-trigger.tab-dim) {
    opacity: 0.35;
  }
  :global(.tab-panel) {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 1.14rem 1.71rem 1.71rem;
  }
  :global(.tab-panel[hidden]) {
    display: none;
  }
  .tab-body {
    --ctrl-h: 2.14rem;
    /* Settings reads at 13px / 12px; the app-wide scale is a notch smaller. */
    --text-body-size: 0.93rem;
    --text-label-size: 0.86rem;
    display: flex;
    flex-direction: column;
    gap: 2.14rem;
    max-width: 46rem;
    margin-inline: auto;
  }
  .settings-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* The same on every page: it stays put while the page below scrolls. */
  .page-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 3.2rem;
    padding: 0 2.9rem 0 1.71rem; /* right: clear of the close button */
    border-bottom: 1px solid var(--panel-border);
  }
  .page-head h2 {
    margin: 0;
    font-size: 1.07rem;
    font-weight: var(--text-title-weight);
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0;
    padding: 0.57rem 0.71rem;
    border-radius: var(--radius-sm);
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .notice.tier.limited {
    border-color: var(--warning, var(--panel-border));
  }
  .notice :global(.icon) {
    flex-shrink: 0;
    margin-top: 0.07rem;
    color: var(--warning);
  }

  /* ---- Sections and rows ---- */
  .settings-section {
    --card-pad-x: 1.14rem;
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
  }
  .settings-section > .hint {
    margin-inline: var(--card-pad-x);
  }
  /* One bordered card per section; rows inside are told apart by a hairline. */
  .card {
    display: flex;
    flex-direction: column;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    overflow: clip;
  }
  .card:not(:has(> *)) {
    display: none;
  }
  .card > * + *,
  .card :is(.setting-row, .field) + :is(.setting-row, .field) {
    border-top: 1px solid var(--panel-border);
  }
  .card .setting-row,
  .card > .field,
  .card > .pair,
  .card > .num-grid,
  .card > .hint,
  .card > .type-preview,
  .card > .disclosure > summary,
  .card > .disclosure > .disclosure-body {
    padding: 0.86rem var(--card-pad-x);
  }
  .card-pad {
    padding: 0.86rem var(--card-pad-x);
  }
  .card .list li {
    padding-inline: var(--card-pad-x);
  }
  .card .disclosure-body .setting-row {
    padding: 0;
  }
  .card .inset-card {
    padding: 0;
    border-left: none;
  }
  .add-row {
    min-height: 2.9rem;
    padding: 0 var(--card-pad-x);
    background: none;
    border: 0;
    color: var(--text-dim);
    font-size: var(--text-body-size);
    text-align: left;
  }
  .add-row:hover:not(:disabled) {
    color: var(--text);
    background: var(--wash-1);
  }
  .card .setting-row.danger-row {
    background: var(--danger-dim);
  }
  .section-heading {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0 var(--card-pad-x);
    font-size: 1.07rem;
    font-weight: 600;
    line-height: 1;
    color: var(--text);
  }
  .section-heading :global(.icon) {
    color: var(--text-dim);
    opacity: 0.7;
    /* Optical centring against the capital initial: cap-height centre sits above the line-box centre. */
    position: relative;
    top: -0.04rem;
  }
  /* Icons are 15px on a 24 grid: 2.4 user units renders a 1.5px stroke, matching the 600-weight text. */
  .section-heading :global(.icon svg) {
    stroke-width: 2.4;
  }
  .settings-section[hidden] {
    display: none;
  }
  .subnav {
    width: min(100%, 28rem);
    margin-top: -1.14rem;
  }
  .offline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.43rem;
    padding: 3.43rem 1rem;
    text-align: center;
    color: var(--text-dim);
  }
  .offline .hint {
    margin-bottom: 0.57rem;
  }
  .offline ~ * {
    display: none !important;
  }
  /* Two pickers side by side, each with its own label. */
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.71rem;
    padding-bottom: 0.29rem;
  }
  /* Side by side, not stacked: the card's row hairline would draw above the second one. */
  .card .pair > .field + .field {
    border-top: 0;
  }
  .pair > .field {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
  }
  /* A row that opens in place, for settings most people never touch. */
  .disclosure > summary {
    display: flex;
    align-items: center;
    gap: 1.14rem;
    padding: 0.79rem 0;
    list-style: none;
    cursor: pointer;
  }
  .disclosure > summary::-webkit-details-marker {
    display: none;
  }
  .disclosure-chevron {
    display: flex;
    color: var(--text-dim);
  }
  .disclosure[open] .disclosure-chevron {
    scale: 1 -1;
  }
  .disclosure-body {
    display: flex;
    flex-direction: column;
    gap: 1.14rem;
    padding: 0.29rem 0 1.14rem;
  }
  .edit-body {
    display: flex;
    flex-direction: column;
    gap: 1.14rem;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
  }
  .field-group-title {
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text);
  }
  .discord-stage {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
    padding: 0.86rem var(--card-pad-x);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .discord-stage.off {
    opacity: 0.5;
  }
  .more {
    display: inline-flex;
    vertical-align: -0.14rem;
    margin-left: 0.29rem;
    color: var(--text-dim);
    cursor: help;
  }
  .more:hover {
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
    gap: 1.71rem;
    min-height: 2.4rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  /* A row whose control is a wide field: the text above it, the field full width below. */
  .setting-row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 0.57rem;
  }
  /* The control side never shrinks, the text side wraps instead. */
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
    font-weight: 500;
    color: var(--text);
  }
  .hint {
    margin: 0;
    max-width: 34rem;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .optional {
    font-weight: 400;
    opacity: 0.7;
  }

  /* ---- Controls: one height (--ctrl-h, shared with Dropdown) for every field and button.
     The controls themselves are in components/ui; these only size them for a settings row. ---- */
  :global(.ui-field.ctrl-wide) {
    width: 15rem;
  }
  /* Unit in a fixed column so the fields line up down the page whatever their unit is. */
  .num-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 1.14rem 1.71rem;
    padding-top: 0.43rem;
  }
  .num-cell {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    min-width: 0;
  }
  .num-unit {
    display: inline-grid;
    grid-template-columns: auto 2.8rem;
    align-items: center;
    gap: 6px;
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
    min-width: 12rem;
    background: var(--wash-2);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .form-grid :global(.dropdown-trigger) {
    width: 100%;
  }
  .keys-intro {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .keybind-row {
    min-height: 1.86rem;
  }
  .binds {
    display: flex;
    align-items: center;
    gap: 0.29rem;
  }
  .binds :global(.reset) {
    --ctrl-h: 1.57rem;
  }
  .bind {
    display: inline-flex;
    align-items: center;
    height: 1.57rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--wash-1);
  }
  .bind:hover {
    border-color: color-mix(in srgb, var(--text) 25%, transparent);
  }
  .bind.empty {
    border-style: dashed;
  }
  .bind.recording {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .bind-main {
    display: inline-flex;
    align-items: center;
    height: 100%;
    min-width: 1.57rem;
    justify-content: center;
    padding: 0 0.36rem;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .bind-prompt {
    font-size: var(--text-label-size);
    color: var(--accent);
  }
  .bind-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 100%;
    padding: 0;
    background: none;
    border: none;
    border-left: 1px solid var(--panel-border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .bind-x:hover {
    color: var(--danger);
  }
  .conflict {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.43rem 0.57rem;
    border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 8%, transparent);
    font-size: var(--text-label-size);
  }
  .conflict > :global(.icon) {
    color: var(--warning);
  }
  .conflict .grow {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    flex-wrap: wrap;
  }
  .identity-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.86rem var(--card-pad-x);
  }
  .identity-fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  :global(.ui-field.identity-name) {
    max-width: 22rem;
  }
  .btn-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  :global(.align-start) {
    align-self: flex-start;
  }
  :global(.align-end) {
    align-self: flex-end;
  }

  /* ---- Lists: one row recipe for servers, projects, keys, people. ---- */
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    min-height: 2.86rem;
    padding: 0.43rem 0;
    color: var(--text-dim);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .list li + li {
    border-top: 1px solid color-mix(in srgb, var(--panel-border) 60%, transparent);
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
    background: var(--wash-3);
  }
  /* A form that opens in place: indented under a hairline, no fill. */
  .inset-card {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
    padding: 0.29rem 0 0.29rem 0.86rem;
    border-left: 2px solid var(--panel-border);
  }
  .inset-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -0.29rem -0.29rem 0 0;
  }
  .form-grid.three {
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.71rem;
  }
  .form-grid label {
    min-width: 0;
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
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .warning-card {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
    padding: 0.86rem;
    background: color-mix(in srgb, var(--warning) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 28%, var(--panel-border));
    border-radius: var(--radius-lg);
  }
  /* Bash is exposed with no sandbox: red, not the usual amber. */
  .warning-card.danger-card {
    background: var(--danger-dim);
    border-color: var(--danger);
  }
  .hint.danger-text {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    color: var(--danger);
    font-weight: 600;
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
  /* Only the code scrolls (both axes), so the header stays put and the horizontal bar is always in view. */
  .code-preview :global(.code-block pre) {
    max-height: 15rem;
    overflow: auto;
    scrollbar-width: thin;
  }
  .type-preview {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    padding: 0.14rem 0;
    color: var(--text);
  }
  .type-preview span {
    color: var(--text-dim);
  }
  /* Same shape as the diff view: number gutter, a bar down the edge of each changed line, the
     changed words picked out inside it. */
  .diff-sample {
    display: flex;
    flex-direction: column;
    background: var(--code-bg, var(--wash-1));
    font-family: var(--code-font-family, ui-monospace, monospace);
    font-size: var(--text-label-size);
    white-space: pre;
    overflow: hidden;
  }
  .diff-sample div {
    display: flex;
    gap: 1.1rem;
    padding: 0 0.86rem 0 0.57rem;
    line-height: 1.75;
    box-sizing: border-box;
  }
  .diff-sample i {
    width: 1.4rem;
    font-style: normal;
    text-align: right;
    color: color-mix(in srgb, var(--text) 40%, transparent);
  }
  .diff-sample b {
    font-weight: inherit;
  }
  .diff-sample .k {
    color: var(--syn-keyword);
  }
  .diff-sample .f {
    color: var(--syn-function);
  }
  .diff-sample .t {
    color: var(--syn-type);
  }
  .diff-sample .s {
    color: var(--syn-string);
  }
  .diff-sample mark {
    color: inherit;
    border-radius: 3px;
  }
  .diff-sample .add {
    border-left: 3px solid var(--diff-add);
    padding-left: calc(0.57rem - 3px);
    background: color-mix(in srgb, var(--diff-add) 14%, transparent);
  }
  .diff-sample .add mark {
    background: color-mix(in srgb, var(--diff-add) 35%, transparent);
  }
  .diff-sample .del {
    border-left: 3px dashed var(--diff-del);
    padding-left: calc(0.57rem - 3px);
    background: color-mix(in srgb, var(--diff-del) 14%, transparent);
  }
  .diff-sample .del mark {
    background: color-mix(in srgb, var(--diff-del) 35%, transparent);
  }
  /* The card already rounds and borders it. */
  .code-preview :global(.code-block) {
    margin: 0;
    border: 0;
    border-radius: 0;
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
    border-radius: var(--radius-lg);
    padding: 0.43rem;
    cursor: pointer;
  }
  .mode-card.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--panel-border));
    background: var(--accent-dim);
  }
  /* Layout previews for a choice: a few neutral blocks, no text, so they read at a glance. */
  .choice-prev {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    height: 4.3rem;
    padding: 0.43rem;
    overflow: hidden;
    border-radius: var(--radius-xs);
    background: var(--wash-3);
  }
  .mode-cards.choices {
    max-width: 22rem;
  }
  /* Beside its label, like the other rows, instead of leaving a gap on the right. */
  .setting-row > .mode-cards.choices {
    width: 17rem;
    flex-shrink: 0;
  }
  .choice-prev .p-line,
  .choice-prev .p-bar {
    display: block;
    height: 0.21rem;
    border-radius: 999px;
    background: var(--wash-4);
  }
  .choice-prev .p-line.short {
    width: 55%;
  }
  .choice-prev .p-bar {
    height: 0.64rem;
    border-radius: 3px;
    background: var(--wash-3);
  }
  .choice-prev.area {
    flex-direction: row;
    gap: 0.21rem;
    padding: 0;
  }
  .choice-prev.area .p-side {
    width: 22%;
    background: var(--wash-2);
  }
  .choice-prev.area .p-main {
    flex: 1;
    background: var(--panel-bg);
  }
  .choice-prev.area.floating {
    padding: 0.36rem 0.36rem 0.36rem 0;
  }
  .choice-prev.area.floating .p-main {
    border-radius: 6px;
    border: 1px solid var(--panel-border);
  }
  .choice-prev.surface .p-pop {
    position: absolute;
    inset: 0.86rem 0.86rem 0.5rem;
    border-radius: 5px;
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
  }
  .choice-prev.surface.frosted .p-pop {
    background: color-mix(in srgb, var(--panel-bg) 45%, transparent);
    backdrop-filter: blur(5px);
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
  /* Colored with the actual derived theme per mode (set inline, see skeletonStyle()), not a
     fixed gray, so all three previews stay comparable side by side regardless of current mode. */
  .mode-skeleton {
    width: 100%;
    height: 5.7rem;
    border-radius: var(--radius-xs);
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
    background: var(--wash-2);
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
  /* Track stops sit at exact 60-degree increments for accurate hue-to-position mapping;
     the thumb matches track height exactly (border-box) so it fills the groove with no gap. */
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
  /* Dimmed and inert rather than removed, so the picked preset stays visible for when the
     "Use app theme colors" switch goes back off. */
  .disabled-row {
    opacity: 0.45;
    pointer-events: none;
  }
  /* Three ANSI dots (red/green/blue, the most recognizable at a glance) over the preset's
     background, not a full swatch, so it reads at list-item size. */
  .term-theme-swatch {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.14rem;
    width: 1.57rem;
    height: 1.14rem;
    border-radius: var(--radius-xs);
    border: 1px solid var(--wash-4);
  }
  /* The check lives in the left margin a grouped item is already indented by; Default (no group)
     gets the same x and its content is pushed over to line up with the rest. */
  .item-lead {
    display: flex;
    align-items: center;
  }
  .check-gutter {
    display: flex;
    flex-shrink: 0;
    width: 0.72rem;
    margin: 0 0.1rem 0 -0.1rem;
  }
  :global(.dropdown-item.grouped) .check-gutter {
    margin-left: -0.82rem;
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
    background: var(--wash-2);
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
  .profile-card {
    flex-direction: row;
    align-items: center;
    gap: 1.43rem;
  }
  .profile-fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
  }
  .profile-name {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .avatar-preview {
    position: relative;
    flex-shrink: 0;
    width: 6.43rem;
    height: 6.43rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--wash-2);
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
    font-size: 2.6rem;
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
  .card > .quick-avatars {
    padding: 0.86rem var(--card-pad-x);
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
    background: var(--wash-2);
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

  .head-main,
  .head-row {
    display: contents;
  }
  .crumb {
    display: none;
  }
  :global(.settings-back),
  :global(.settings-exit) {
    display: none;
  }
  /* Phone-only: the profile card above the destinations, and the groups' wrappers (invisible elsewhere). */
  .profile-tile {
    display: none;
  }
  .tabs-group {
    display: contents;
  }
  .settings-swipe {
    display: contents;
  }
  @media (max-width: 700px) {
    :global(.settings-tabs) {
      position: relative;
      touch-action: pan-y;
    }
    /* A nested scroller stops inheriting the page's touch-action; without this the browser claims a sideways drag (and cancels the swipe back). */
    :global(:where(.settings-tabs *)) {
      touch-action: pan-y;
    }
    /* A real header: a round back button and the page's name, tall enough for a thumb. */
    .settings-bar {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      height: 3.5rem;
      margin: 0;
      padding: 0 0.35rem;
    }
    :global(.settings-exit) {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      background: none;
      border: none;
      border-radius: 50%;
      color: var(--text);
    }
    :global(.settings-exit:active) {
      background: var(--wash-3);
    }
    /* Visually hidden on desktop (the sidebar says where you are); a phone has no sidebar. */
    :global(.settings-title) {
      position: static !important;
      width: auto !important;
      height: auto !important;
      clip-path: none !important;
      margin: 0 !important;
      overflow: visible !important;
      font-size: 1.25rem;
      font-weight: 700;
    }
    :global(.settings-search .search.search) {
      height: 3rem;
      margin: 0.2rem 1rem 0.6rem;
      padding-inline: 1rem;
      border-radius: var(--radius-pill);
      background: var(--wash-3);
      border-color: transparent;
    }
    /* Headings line up with the rows' text: the group's inset plus the row's padding. */
    .tabs-group-label {
      margin: 1.3rem 1rem 0.4rem calc(0.8rem + 16px);
      font-size: max(12px, 0.78rem);
    }
    :global(.settings-close) {
      display: none;
    }
    :global(.settings-tabs .tabs-list) {
      width: 100%;
      border-right: 0;
      padding: 1rem 0.7rem calc(var(--safe-bottom) + 1rem);
    }
    :global(.settings-tabs .settings-tab-trigger) {
      min-height: 2.9rem;
    }
    /* A list of destinations, not a selection. */
    :global(.settings-tabs .settings-tab-trigger[data-state="active"]) {
      background: none;
      color: var(--text);
      font-weight: inherit;
    }
    :global(.settings-tabs .settings-tab-trigger[data-state="active"]::before) {
      display: none;
    }
    :global(.settings-tabs .settings-tab-trigger::after) {
      content: "›";
      margin-left: auto;
      font-size: 1.3em;
      opacity: 0.45;
    }
    /* Pages stack on top of each other; settingsNav slides and hides them. */
    :global(.settings-tabs .tabs-list),
    .settings-main,
    .sub-stage :global(.sub-page) {
      position: absolute;
      inset: 0;
      width: 100%;
      background: var(--panel-bg);
    }
    .settings-main {
      will-change: transform;
      box-shadow: -12px 0 28px -16px rgb(0 0 0 / 0.5);
    }
    .sub-stage {
      display: contents;
    }
    .crumb {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: max(11px, 0.72rem);
      line-height: 1.2;
      color: var(--text-dim);
    }
    .head-main {
      display: block;
      flex: 1;
      min-width: 0;
    }
    .head-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .page-head {
      min-height: 3.5rem;
      padding: 0 0.35rem;
      border-bottom-color: transparent;
      transition: border-color calc(0.16s * var(--anim-speed, 1)) ease;
    }
    .settings-main:global(.scrolled) .page-head {
      border-bottom-color: var(--panel-border);
    }
    .page-head h2 {
      font-size: 1.15rem;
      font-weight: 700;
    }
    :global(.tab-panel) {
      padding: 0.7rem 0.8rem calc(var(--safe-bottom) + 1.4rem);
    }
    .settings-back {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 2.75rem;
      height: 2.75rem;
      background: none;
      border: none;
      border-radius: 50%;
      color: var(--text);
    }
    .settings-back:active {
      background: var(--wash-3);
    }
    .setting-row {
      flex-wrap: wrap;
      gap: 0.5rem 1.14rem;
    }
    .setting-text {
      flex: 1 1 11rem;
    }
    /* In a stacked field the basis would be a height, not a width. */
    .field > .setting-text,
    .setting-row.stacked > .setting-text {
      flex: none;
    }
    .setting-row > :last-child {
      max-width: 100%;
    }
    :global(.ui-field.ctrl-wide) {
      width: min(15rem, 100%);
    }
    .pair,
    .form-grid,
    .form-grid.three {
      grid-template-columns: 1fr;
    }

    /* Floating grouped lists: an inset, rounded surface a shade lighter than the page, hairlines that
       start at the row's text. The section's title becomes the small label above its group. */
    .settings-section {
      --card-pad-x: 1rem;
      gap: 0.4rem;
    }
    .section-heading {
      margin: 1.3rem 0 0 var(--card-pad-x);
      font-size: max(12px, 0.8rem);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      gap: 0.35rem;
    }
    .card {
      background: var(--wash-2);
    }
    .card > * + *,
    .card :is(.setting-row, .field) + :is(.setting-row, .field) {
      border-top: 0;
      background-image: linear-gradient(var(--panel-border), var(--panel-border));
      background-size: calc(100% - var(--card-pad-x)) 1px;
      background-position: right top;
      background-repeat: no-repeat;
    }
    /* The switch is 31px tall; its hit area is not (Switch.svelte is not ours to change). */
    .card :global(.switch)::after {
      content: "";
      position: absolute;
      inset: -9px -4px;
    }
    .card .setting-row,
    .card > .field,
    .card > .pair,
    .card > .num-grid,
    .card > .disclosure > summary,
    .card > .disclosure > .disclosure-body {
      min-height: 52px;
      padding-block: 0.6rem;
    }
    .add-row {
      min-height: 52px;
    }
    /* Controls a thumb can land on: the desktop's 30px fields become 48px, and text steps up with them. */
    .tab-body {
      --ctrl-h: 3rem;
      --text-body-size: 1rem;
      --text-label-size: 0.9rem;
    }
    .tab-body :global(.dropdown-trigger) {
      min-width: 0;
    }
    .mode-cards {
      width: 100%;
    }
    .mode-cards > :global(*) {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
    }
    /* The destinations: a profile card, then floating groups of icon-tile rows with a chevron. */
    :global(.settings-tabs .tabs-list) {
      padding: 0.4rem 0 calc(var(--safe-bottom) + 1rem) !important;
    }
    .profile-tile {
      display: flex;
      align-items: center;
      gap: 14px;
      width: calc(100% - 1.6rem);
      min-height: 52px;
      margin: 0.2rem 0.8rem 0;
      padding: 14px;
      background: var(--wash-2);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius-lg);
      color: var(--text);
      text-align: left;
    }
    .profile-tile::after {
      content: "›";
      margin-left: auto;
      font-size: 1.3em;
      opacity: 0.45;
    }
    .profile-tile:active {
      background: var(--wash-3);
    }
    .pt-avatar {
      position: relative;
      flex: none;
      display: grid;
      place-items: center;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: var(--wash-3);
    }
    .pt-avatar img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }
    .pt-avatar .emoji {
      font-size: 30px;
      line-height: 1;
    }
    .pt-badge {
      position: absolute;
      right: -2px;
      bottom: -2px;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent);
      color: var(--panel-bg);
      border: 2px solid var(--panel-bg);
    }
    .pt-who {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .pt-who b {
      font-size: 1.2rem;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pt-who small {
      font-size: max(12px, 0.85rem);
      color: var(--text-dim);
    }
    .tabs-group {
      display: flex;
      flex-direction: column;
      margin-inline: 0.8rem;
      background: var(--wash-2);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius-lg);
      overflow: clip;
    }
    :global(.settings-tabs .settings-tab-trigger) {
      min-height: 52px !important;
      gap: 14px;
      padding-inline: 16px !important;
      border-radius: 0 !important;
      font-size: 1.05rem;
      color: var(--text);
    }
    :global(.settings-tabs .settings-tab-trigger:hover) {
      background: none;
    }
    :global(.settings-tabs .settings-tab-trigger:active) {
      background: var(--wash-3);
    }
    /* A small, light icon; the hairline starts after it. */
    :global(.settings-tabs .settings-tab-trigger .icon) {
      width: 22px !important;
      height: 22px !important;
      color: var(--text-dim);
      opacity: 1;
    }
    :global(.settings-tabs .settings-tab-trigger .icon svg) {
      width: 17px;
      height: 17px;
      stroke-width: 1.5;
    }
    :global(.settings-tabs .settings-tab-trigger + .settings-tab-trigger::before) {
      content: "";
      display: block;
      position: absolute;
      top: 0;
      bottom: auto;
      left: 52px;
      right: 0;
      width: auto;
      height: 1px;
      border-radius: 0;
      background: var(--panel-border);
    }
    /* While the picture editor is open it is the whole page. */
    .tab-body:has(:global(.avatar-editor)) > .settings-section {
      display: none;
    }
    /* A phone sees the photo's edit pencil as a badge, not a hover veil. */
    .avatar-preview {
      overflow: visible;
    }
    .avatar-preview img,
    .avatar-preview .emoji {
      border-radius: 50%;
    }
    .avatar-preview .avatar-edit {
      inset: auto -2px -2px auto;
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 50%;
      background: var(--accent);
      color: var(--panel-bg);
      opacity: 1;
    }
  }
  .discord-status {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .discord-status .dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.5;
  }
  .discord-status.on {
    color: var(--text);
  }
  .discord-status.on .dot {
    background: var(--success);
    opacity: 1;
  }
  .discord-status.error .dot {
    background: var(--danger);
    opacity: 1;
  }
  .discord-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 0.86rem;
  }
  .discord-pick {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    min-width: 0;
    padding: 0.43rem;
  }
  .discord-pick-title {
    padding-inline: 0.29rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .discord-card {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
    padding: 0.86rem;
    border-radius: 0.57rem;
    background: color-mix(in srgb, var(--panel-bg) 84%, black);
  }
  .discord-activity {
    display: flex;
    align-items: center;
    gap: 0.86rem;
  }
  .discord-art {
    position: relative;
    flex-shrink: 0;
    width: 3.71rem;
    height: 3.71rem;
    margin: 0.07rem 0.21rem 0.21rem 0;
    border-radius: 0.43rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .discord-art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .discord-art-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-dim);
  }
  .discord-badge {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.36rem;
    height: 1.36rem;
    overflow: hidden;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--panel-bg) 84%, black);
    background: var(--panel-bg);
    color: var(--text-dim);
  }
  .discord-badge img {
    border-radius: 50%;
  }
  .discord-body {
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
    min-width: 0;
  }
  .discord-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text);
  }
  .discord-card-head :global(svg) {
    color: var(--text-dim);
  }
  .discord-name {
    font-size: var(--text-body-size);
    font-weight: 700;
    color: var(--text);
  }
  .discord-details {
    font-size: var(--text-label-size);
    font-weight: 400;
    color: var(--text-dim);
    overflow-wrap: anywhere;
    text-decoration: none;
  }
  .discord-time {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    color: var(--success);
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
  }
  .discord-state {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow-wrap: anywhere;
    text-decoration: none;
  }
  .discord-buttons {
    display: flex;
    gap: 0.43rem;
  }
  .discord-button {
    flex: 1;
    padding: 0.36rem 0.57rem;
    border-radius: 0.29rem;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    font-size: var(--text-label-size);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Phone sub-pages (SubPage.svelte, settingsNav) ---- */
  .sub-group {
    display: contents;
  }
  .face {
    display: grid;
    place-items: center;
    flex: none;
    overflow: hidden;
    border-radius: 50%;
    background: var(--accent-dim);
    line-height: 1;
  }
  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .row-actions {
    display: contents;
  }
  .row-chev {
    display: none;
  }
  .go-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 52px;
    padding: 0.6rem var(--card-pad-x);
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .go-row:active {
    background: var(--wash-3);
  }
  .go-text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .go-text small {
    color: var(--text-dim);
    font-size: max(12px, 0.8rem);
  }
  .sp-done {
    height: 2.75rem;
    padding: 0 0.9rem;
    background: none;
    border: 0;
    border-radius: var(--radius-pill);
    color: var(--accent);
    font: inherit;
    font-weight: 600;
  }
  .sp-done:active {
    background: var(--wash-3);
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.8rem 0 0.2rem;
  }
  .hero b {
    font-size: 1.25rem;
  }
  .hero small {
    color: var(--text-dim);
  }
  .hero-av {
    position: relative;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 50%;
  }
  .hero-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-fg, #fff);
    border: 2px solid var(--panel-bg);
  }
  .seen {
    align-items: center;
  }
  @media (max-width: 700px) {
    .sub-group {
      display: block;
      background: var(--wash-2);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius-lg);
      overflow: clip;
    }
    .sub-group > :global(.sub-link + .sub-link) {
      border-top: 1px solid var(--panel-border);
    }
    .row-actions {
      display: none;
    }
    .row-chev {
      display: block;
      opacity: 0.55;
    }
    .actions-row {
      flex-wrap: nowrap;
    }
    .actions-row > :global(*) {
      flex: 1;
    }
  }
</style>

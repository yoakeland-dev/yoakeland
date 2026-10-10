<script lang="ts">
  // App-wide pages (Profile, Appearance, Terminal, Servers) store on this device;
  // server-scoped pages (General, Providers, Projects, Access) store on whichever
  // server the page header points at.
  import { Dialog, Tabs } from "bits-ui";
  import { untrack, type ComponentProps } from "svelte";
  import { app, forgetKnownServer, type ConnectionId } from "../state.svelte";
  import { basename } from "../format";
  import { isDesktop, revealItemInDir, windowChromeKind } from "../platform";
  import { swipe, commits, ownsHorizontalDrag } from "../gestures";
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
    setRuntimeSettings,
    setAutoGenerateTitle,
    setNotifyPrefs,
    setModelRoles,
    ensureModels,
    setRemotePassword,
    setServerIdentity,
    registerProvider,
    removeProvider,
    signInOpenRouter,
    cancelOpenRouterSignIn,
    registerToken,
    removeToken,
    removeProject,
    loadCustomThemes,
    themesRevealPath,
  } from "../ipc";
  import { extractAccentFromImage, hexToHue, hslToHex, tokensFor, TERMINAL_THEME_PRESETS } from "../theme";
  import { APP_THEME_PRESETS } from "../themePresets";
  import { encodePairingCode } from "../pairing";
  import { isPhotoAvatar, photoAvatarDataUrl } from "../avatar";
  import type { CliKind, ModelRole, NotifyPrefs, ProviderInfo } from "../types";
  import { effortLevels, effortLabel } from "./EffortPicker.svelte";
  import Button from "./ui/Button.svelte";
  import NumberField from "./ui/NumberField.svelte";
  import Segmented from "./ui/Segmented.svelte";
  import Slider from "./ui/Slider.svelte";
  import Switch from "./ui/Switch.svelte";
  import TextField from "./ui/TextField.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import { CLI_AGENTS } from "../modelVendor";
  import { DEFAULT_NOTIFY_PREFS, NOTIFY_KINDS } from "../notifyKinds";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import Dropdown from "./Dropdown.svelte";
  import AuditPanel from "./AuditPanel.svelte";
  import SearchInput from "./SearchInput.svelte";
  import ConnectForm from "./ConnectForm.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionRules from "./PermissionRules.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import Kbd from "./Kbd.svelte";
  import { tip } from "../tooltip.svelte";
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

  // ---- Providers tab (credentials only; model selection lives in ModelPicker.svelte) ----
  // OpenRouter can be added two ways: pasting a key (the form below, also the only way from a browser)
  // or signing in from the desktop app (the card with the coding agents, openrouter_oauth_*, SPEC.md §3.1).
  let providerName = $state("");
  let httpProvider = $state<"anthropic" | "openai" | "openrouter">("anthropic");
  let apiKey = $state("");
  let baseUrl = $state("");

  function resetProviderForm() {
    providerName = "";
    apiKey = "";
    baseUrl = "";
  }

  const OPENROUTER_ACCOUNT = "openrouter-oauth";
  let orStatus = $state<"idle" | "waiting" | "finishing">("idle");
  let orError = $state("");
  const orAccount = $derived(server?.providers.find((p) => p.httpProvider === "openrouter" && p.authMethod === "oauth"));
  // Pasted keys only: the signed-in account has its own card.
  const manualKeys = $derived((server?.providers ?? []).filter((p) => p.kind === "api_key" && p.authMethod !== "oauth"));

  async function signInOR() {
    if (!cid) return;
    orError = "";
    orStatus = "waiting";
    try {
      await signInOpenRouter(cid, OPENROUTER_ACCOUNT);
      orStatus = "finishing";
      // provider_registered ends this (see the effect below); a failed exchange only shows up in the log.
      setTimeout(() => {
        if (orStatus !== "finishing") return;
        orStatus = "idle";
        orError = "The server couldn't finish signing in. Its log has the reason.";
      }, 20_000);
    } catch (e) {
      // Cancel resets to idle first, so only a real failure still reads "waiting" here.
      if (orStatus === "waiting") orError = e instanceof Error ? e.message : String(e);
      orStatus = "idle";
    }
  }

  function cancelOR() {
    orStatus = "idle";
    void cancelOpenRouterSignIn();
  }

  $effect(() => {
    if (orAccount && orStatus !== "idle") orStatus = "idle";
  });

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

  // Subscription CLIs are a one-per-machine login, not a credential you'd want two of, so
  // they get a fixed name and an on/off switch instead of a registration form (the wire
  // protocol still requires a `name` on register_provider).
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

  // --- Model roles (SPEC.md §4f) ---
  const ROLE_ROWS = [
    { key: "plan", label: "Planning", hint: "Runs every turn in Plan mode. Pick your strongest model." },
    { key: "explore", label: "Exploring", hint: "Read-only subagents that search the code and report back. A small, fast model is enough." },
    { key: "utility", label: "Titles & summaries", hint: "Names chats and summarizes long ones when they outgrow the context." },
    { key: "advisor", label: "Advisor", hint: "A stronger Anthropic model the chat's model can consult mid-task (Anthropic chats only)." },
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
  // Non-null while the add form is open: {} for a blank one, or a
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

  // Server-wide limits and the no-sandbox policy (RuntimeSettings); the server echoes back what it stored.
  const runtime = $derived(server?.runtime);
  const unsandboxedOpen = $derived(server?.unsandboxedProjects ?? []);
  function patchRuntime(patch: Parameters<typeof setRuntimeSettings>[1]) {
    if (cid) setRuntimeSettings(cid, patch);
  }
  /** The numeric runtime settings beyond the limits above: key, label, hint, unit, minimum. */
  const RESOURCE_SETTINGS = [
    { key: "execTimeoutSec", label: "Command timeout", hint: "How long one bash command may run.", unit: "s", min: 1 },
    { key: "execOutputMaxBytes", label: "Command output kept", hint: "Output of one bash command past this is dropped.", unit: "bytes", min: 4096 },
    { key: "terminalMemoryMaxMB", label: "Terminal memory cap", hint: "Per terminal opened from now on, where the system supports it.", unit: "MB", min: 64 },
    { key: "terminalPidsMax", label: "Terminal process cap", hint: "Processes per terminal opened from now on.", unit: "", min: 16 },
    { key: "terminalReadMaxChars", label: "Terminal output the model sees", hint: "The tail of each terminal read.", unit: "chars", min: 500 },
    { key: "terminalHistoryKB", label: "Terminal scrollback replayed", hint: "What a client gets when it attaches.", unit: "KB", min: 16 },
    { key: "poolIdleMinutes", label: "Keep idle coding agents for", hint: "An unused Claude/Codex/… process is closed after this.", unit: "min", min: 1 },
    { key: "poolMaxLive", label: "Most coding agents alive at once", hint: "0 means no cap. The least recently used idle one is closed to make room; running turns are never stopped.", unit: "", min: 0 },
    { key: "pricingRefreshHours", label: "Refresh model prices every", hint: "An unpriced model also triggers one refresh, at most hourly.", unit: "h", min: 1 },
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
    registerToken(cid, tokenNameInput.trim(), tokenEmailInput.trim() || undefined);
    tokenNameInput = "";
    tokenEmailInput = "";
    addingPerson = false;
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
  const TAB_ORDER = ["profile", "appearance", "terminal", "keyboard", "servers", "general", "providers", "projects", "safety", "notifications", "access", "audit"];
  const TAB_LABELS: Record<string, string> = {
    profile: "profile you name avatar picture",
    appearance: "appearance look theme fonts",
    terminal: "terminal shell colors",
    keyboard: "keyboard shortcuts keybinds keybindings hotkeys keys",
    servers: "servers connections remote",
    general: "general server name titles",
    providers: "providers models api keys subscriptions",
    projects: "projects folders paths",
    safety: "safety limits bash sandbox permissions browser spend rules",
    notifications: "notifications alerts needs you desktop",
    access: "access network remote password tokens peers people",
    audit: "audit log history approved refused",
  };
  // Phone: the tab list and the page are two screens. Opening to a specific tab (provider or server
  // prompts) lands straight on its page.
  let detail = $state(false);
  // Swipe right to go back a screen: the page follows the finger, then either leaves or springs back.
  const backTarget = () =>
    document.querySelector<HTMLElement>(detail ? ".settings-content .tab-panel:not([hidden])" : ".settings-content");
  const goBack = {
    axis: "x",
    start: (e: PointerEvent) => !ownsHorizontalDrag(e.target),
    accept: (d: number) => d > 0,
    onMove: (d: number) => {
      const el = backTarget();
      if (el) (el.style.transition = "none"), (el.style.transform = `translateX(${Math.max(0, d)}px)`);
    },
    onEnd: (d: number, v: number) => {
      const el = backTarget();
      const go = commits(d / innerWidth, v, 1);
      if (!el) return;
      el.style.transition = go ? "opacity 0.14s ease" : "transform 0.2s var(--ui-ease)";
      el.style.opacity = go ? "0" : "";
      el.style.transform = go ? el.style.transform : "";
      const reset = () => (el.style.transition = el.style.transform = el.style.opacity = "");
      if (!go) return void setTimeout(reset, 200);
      // Stay faded while it closes, so it doesn't flash back before bits' own fade-out.
      setTimeout(() => {
        detail ? (detail = false) : (app.showSettings = false);
        setTimeout(reset, 300);
      }, 140);
    },
    onCancel: () => backTarget()?.style.removeProperty("transform"),
  } as const;
  $effect(() => {
    if (app.showSettings) detail = app.settingsTab !== "appearance";
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
        ".field, .setting-row, .cli-card, .provider-form, .list > li, .servers > li",
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

{#snippet pageHead(title: string, scoped: boolean)}
  <header class="page-head">
    <button type="button" class="settings-back" aria-label="All settings" onclick={() => (detail = false)}>
      <Icon name="chevron-left" size={16} />
    </button>
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
  <Switch {checked} {disabled} onchange={onChange} />
{/snippet}

<!-- A handful of mutually exclusive options, all visible at once, a
     dropdown only earns its extra click once the list is too long to show. -->
{#snippet segmented(options: { value: string; label: string }[], value: string, pick: (v: string) => void)}
  <Segmented {options} {value} onchange={pick} />
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

{#snippet slotPicker(mode: "dark" | "light", label: string)}
  {@const all = [...APP_THEME_PRESETS, ...app.customThemes].filter((t) => t[mode])}
  <div class="setting-row">
    {@render rowText(label, app.themeFor(mode) ? undefined : "Default follows the accent below.")}
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
  <Tabs.Trigger value={value} class="settings-tab-trigger {settingsSearch && tabHasMatch[value] === false ? 'tab-dim' : ''}" onclick={() => (detail = true)}>
    <Icon name={icon} size={14} /> {label}
  </Tabs.Trigger>
{/snippet}

<svelte:window onkeydowncapture={onRecordKey} />

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
    <Dialog.Content class="settings-content">
      <Dialog.Close class="settings-close" aria-label="Close settings"><Icon name="xmark" size={14} /></Dialog.Close>

      <div class="settings-swipe" {@attach swipe(() => goBack)}>
      <Tabs.Root bind:value={app.settingsTab} orientation="vertical" class="settings-tabs {detail ? 'detail' : ''}">
        <Tabs.List class="tabs-list">
          <div class="settings-bar">
            <Dialog.Close class="settings-exit" aria-label="Close settings"><Icon name="chevron-left" size={16} /></Dialog.Close>
            <Dialog.Title class="settings-title">Settings</Dialog.Title>
          </div>
          <div class="settings-search"><SearchInput boxed bind:value={settingsSearch} placeholder="Search settings…" /></div>
          {#if noMatches}<div class="no-matches">No settings match “{settingsSearch.trim()}”</div>{/if}

          <div class="tabs-group-label">App</div>
          {@render tab("profile", "Profile", "user")}
          {@render tab("appearance", "Appearance", "palette")}
          {@render tab("terminal", "Terminal", "terminal-2")}
          {@render tab("keyboard", "Keyboard", "keyboard")}
          {@render tab("servers", "Servers", "server")}

          <div class="tabs-group-label" {@attach tip("These apply to one server — pick which at the top of each page")}>
            {server ? server.label : "Server"}
          </div>
          {@render tab("general", "General", "settings")}
          {@render tab("providers", "Providers", "brain")}
          {@render tab("projects", "Projects", "code")}
          {@render tab("safety", "Safety", "shield-check")}
          {@render tab("notifications", "Notifications", "bell")}
          {@render tab("access", "Access", "network")}
          {@render tab("audit", "Audit log", "clipboard-list")}
        </Tabs.List>

        <Tabs.Content value="profile" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "profile", query: settingsSearch }}>
            {@render pageHead("Profile", false)}
            <section class="settings-section">
              <div class="field profile-card">
                <button
                  type="button"
                  class="avatar-preview"
                  onclick={() => avatarInput?.click()}
                  {@attach tip("Choose a picture")}
                  disabled={uploadingAvatar}
                >
                  {#if isPhotoAvatar(app.settings.profileAvatar)}
                    <img src={app.settings.profileAvatar} alt="" />
                  {:else}
                    <span class="emoji">{app.settings.profileAvatar || "🐣"}</span>
                  {/if}
                  <span class="avatar-edit"><Icon name="media-image" size={13} /></span>
                </button>
                <div class="profile-fields">
                  <label class="profile-name">
                    <span class="row-label">Display name</span>
                    <TextField type="text" placeholder="anonymous" bind:value={app.settings.profileName} onchange={onProfileNameChange} />
                    <span class="hint">How you appear to other people on the servers you connect to.</span>
                  </label>
                  <div class="btn-row">
                    <Button type="button" onclick={() => avatarInput?.click()} disabled={uploadingAvatar}>
                      <Icon name="media-image" size={13} />
                      {uploadingAvatar ? "Reading…" : isPhotoAvatar(app.settings.profileAvatar) ? "Replace picture" : "Choose picture"}
                    </Button>
                    {#if isPhotoAvatar(app.settings.profileAvatar)}
                      <Button type="button" variant="ghost" onclick={() => setEmojiAvatar(QUICK_AVATARS[0])}>Remove</Button>
                    {/if}
                  </div>
                </div>
              </div>
              <input bind:this={avatarInput} type="file" accept="image/*" hidden onchange={onAvatarFile} />
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Or use an emoji</h3>
              <div class="quick-avatars">
                {#each QUICK_AVATARS as emoji (emoji)}
                  <button
                    type="button"
                    class="quick-avatar"
                    class:active={app.settings.profileAvatar === emoji}
                    {@attach tip(`Use ${emoji} instead of a picture`)}
                    onclick={() => setEmojiAvatar(emoji)}
                  >
                    {emoji}
                  </button>
                {/each}
              </div>
              <p class="hint">Pictures are cropped square and scaled to 96×96 before they leave this device.</p>
            </section>
            <section class="settings-section">
              <div class="setting-row">
                {@render rowText("Setup", "Walk through connecting a server, a provider and a project again.")}
                <Button type="button" onclick={() => ((app.settings.onboarded = false), apply(), (app.showSettings = false))}>Run setup again</Button>
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
              {#if app.settings.theme !== "light"}
                {@render slotPicker("dark", "Dark theme")}
              {/if}
              {#if app.settings.theme !== "dark"}
                {@render slotPicker("light", "Light theme")}
              {/if}
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
              {#if isDesktop}
                <div class="setting-row">
                  {@render rowText("Custom themes", themeNote ?? "One .json file per theme, with a dark and a light side. Changes apply as you save.")}
                  <div class="btn-row">
                    <Button type="button" onclick={revealThemesFile}>Open folder</Button>
                    <Button type="button" onclick={reloadThemes}>Reload</Button>
                  </div>
                </div>
              {/if}
              <div class="setting-row">
                {@render rowText("Diff colors", "How added and removed lines are drawn.")}
                <div class="btn-row">
                  <span class="diff-preview" aria-hidden="true"><span class="add">+</span><span class="del">−</span></span>
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
            <section class="settings-section">
              <h3 class="section-heading">Wallpaper</h3>
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
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Window</h3>
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

              <div class="setting-row">
                {@render rowText("New chat feed", "Recent chats, your working tree and starter prompts below the composer in an empty chat.")}
                {@render toggle(app.settings.emptyFeed, (v) => ((app.settings.emptyFeed = v), apply()))}
              </div>

              {#if windowChromeKind}
                <div class="setting-row">
                  {@render rowText(
                    "Window controls",
                    "Minimize, maximize and close buttons, and dragging the window by its top edge. Turn off if your window manager does this." +
                      (windowChromeKind === "overlay" ? " Applies after a restart." : ""),
                  )}
                  {@render toggle(app.settings.windowChrome, (v) => ((app.settings.windowChrome = v), apply()))}
                </div>
              {/if}
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Typography</h3>
              <div class="setting-row">
                {@render rowText("Interface font")}
                <TextField type="text" class="ctrl-wide" bind:value={app.settings.uiFontFamily} onchange={apply} />
              </div>
              <div class="setting-row">
                {@render rowText("Interface scale", "Scales text and spacing across the whole app.")}
                <div class="slider">
                  <Slider label="Interface scale" min={80} max={140} step={5} bind:value={scalePct} onchange={applyScale} format={(v) => `${v}%`} />
                  <span class="slider-value">{scalePct}%</span>
                </div>
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">Code blocks</h3>
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
                  <Slider label="Animation speed" min={0} max={2} step={0.1} bind:value={app.settings.animationSpeed} oninput={apply} format={(v) => `${v.toFixed(1)}×`} />
                  <span class="slider-value">{app.settings.animationSpeed.toFixed(1)}×</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Auto-archive threads", "Idle threads move to the archive after this many days.")}
                <div class="with-unit">
                  <NumberField class="ctrl-num" min={1} max={365} bind:value={app.settings.autoArchiveDays} onchange={apply} />
                  <span>days</span>
                </div>
              </div>
              <div class="setting-row">
                {@render rowText("Desktop alerts on this device", "While the window is in the background. Never for the chat you are reading, or when another of your devices is in use.")}
                {@render segmented(
                  [
                    { value: "off", label: "Off" },
                    { value: "urgent", label: "Needs you" },
                    { value: "all", label: "Also finished" },
                  ],
                  app.settings.osNotifications,
                  (v) => {
                    app.settings.osNotifications = v as typeof app.settings.osNotifications;
                    apply();
                  },
                )}
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
                {@render rowText("Smooth scrolling", "Eases scroll-wheel movement instead of jumping a line at a time.")}
                {@render toggle(app.settings.terminalSmoothScroll, (v) => ((app.settings.terminalSmoothScroll = v), apply()))}
              </div>
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="keyboard" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "keyboard", query: settingsSearch }}>
            {@render pageHead("Keyboard", false)}
            <div class="keys-intro">
              <p class="hint">Click a shortcut to change it, then press the new keys (Esc cancels). Each action takes up to two.</p>
              {#if anyCustomized}
                <Button type="button" size="sm" variant="ghost" onclick={() => (stopRecording(), resetBinds())}>
                  <Icon name="restore" size={12} /> Reset all
                </Button>
              {/if}
            </div>
            {#each actionGroups as [group, actions] (group)}
              <section class="settings-section">
                <h3 class="section-heading">{group}</h3>
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
              </section>
            {/each}
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
                        <span class="status-dot {r.status}" {@attach tip(r.status)}></span>
                      </span>
                      <span class="list-meta" {@attach tip(r.address)}>{r.address}</span>
                    </div>
                    {#if r.connectionId && (r.status === "connected" || r.status === "connecting")}
                      <Button type="button" size="sm" onclick={() => disconnect(r.connectionId!)}>Disconnect</Button>
                    {:else}
                      <Button type="button" size="sm" onclick={() => connectServerRow(r)}>
                        {r.connectionId ? "Reconnect" : "Connect"}
                      </Button>
                    {/if}
                    <Button type="button" icon variant="ghost" destructive onclick={() => onRemoveRow(r)} {@attach tip(r.connectionId ? "Remove" : "Forget")}>
                      <Icon name="trash" size={13} />
                    </Button>
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
                  <TextField type="text" class="ctrl-wide" placeholder="this server's name" bind:value={serverIdentityInput} disabled={!connected} />
                  <Button type="submit" disabled={!connected || !serverIdentityInput.trim() || serverIdentityInput.trim() === server?.serverIdentity}>
                    Save
                  </Button>
                </div>
              </form>
              {#if server?.outdated}
                <div class="setting-row">
                  {@render rowText("Server is out of date", `Running ${server.version ? "v" + server.version : "a version that doesn't report itself"}, the latest is v${app.latestServerVersion}.`)}
                </div>
              {/if}
              <div class="setting-row">
                {@render rowText("Auto-generate chat titles", "Names new threads from their first message.")}
                {@render toggle(server?.autoGenerateTitleEnabled ?? true, onAutoGenerateTitleToggle, !connected)}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Context</h3>
              <div class="setting-row">
                {@render rowText("Compact chats at", "When a chat's context grows past this, it is summarized to make room. 0 means the built-in 64,000. Never above 90% of the model's window. Claude Code is told this as its context window and compacts about 33,000 tokens below it; other coding agents compact on their own. Change it for one chat with /autocompact; /compact summarizes right now.")}
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
                {@render rowText("Summary instructions", "Added to every summary a chat on an API provider makes, automatic or from /compact: what to emphasize, what to leave out. Claude Code doesn't take it; give its /compact instructions after the command. They narrow the focus and never replace the base prompt, which still keeps every request, decision, changed file and the remaining work. A summary these make implausibly short is redone without them.")}
                <TextArea
                  bind:value={compactInstructionsInput}
                  rows={3}
                  maxlength={4000}
                  disabled={!connected || !runtime}
                  placeholder="e.g. Keep the exact error messages and test commands."
                  onchange={() => patchRuntime({ compactInstructions: compactInstructionsInput })}
                />
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Resources</h3>
              {#each RESOURCE_SETTINGS as r (r.key)}
                <div class="setting-row">
                  {@render rowText(r.label, r.hint)}
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
                </div>
              {/each}
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="safety" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "safety", query: settingsSearch }}>
            {@render pageHead("Safety", true)}
            <section class="settings-section">
              <h3 class="section-heading">Limits</h3>
              <div class="setting-row">
                {@render rowText("Model calls per turn", "After this many, the turn pauses and asks whether to continue. 0 means no limit. Coding agents like Claude Code run their own loop and are not limited.")}
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
                {@render rowText("Spend per chat (USD)", "A chat that has spent this much pauses, mid-turn too, and asks whether to continue. 0 means no limit. Only priced usage counts.")}
                <NumberField

                  class="ctrl-num"
                  min={0}
                  step={0.5}
                  disabled={!connected || !runtime}
                  value={runtime?.maxSessionCostUsd ?? 0}
                  onchange={(v) => patchRuntime({ maxSessionCostUsd: Math.max(0, v || 0) })}
                />
              </div>
              <div class="warning-card" class:danger-card={unsandboxedOpen.length > 0 && !runtime?.disableBashWhenUnsandboxed}>
                <div class="setting-row">
                  {@render rowText(
                    "Turn bash off when a project has no sandbox",
                    "Without bubblewrap or namespaces, bash and terminals run straight on the machine and can read or change anything the server's user can. This withholds them from the model in those projects. Off by default.",
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
              </div>
              <div class="setting-row">
                {@render rowText("Keep the browser on approved sites", "While the agent drives the browser, a link or redirect to a site it has not been cleared to visit is stopped, and the agent has to ask. Your own navigation is never blocked.")}
                {@render toggle(runtime?.browserBlockCrossOrigin ?? true, (v) => patchRuntime({ browserBlockCrossOrigin: v }), !connected || !runtime)}
              </div>
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Permissions</h3>
              <PermissionRules {cid} projectPath={server?.currentProjectPath ?? undefined} />
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="notifications" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "notifications", query: settingsSearch }}>
            {@render pageHead("Notifications", true)}
            <section class="settings-section">
              <p class="hint">Only the first two are on by default. Nothing is raised for a chat you are looking at on any device, and each one is remembered on the server, so reading it on one device reads it on all of them.</p>
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
            </section>
            <section class="settings-section">
              <h3 class="section-heading">Kinds</h3>
              {#each NOTIFY_KINDS as k (k.kind)}
                <div class="setting-row">
                  {@render rowText(k.label)}
                  {@render toggle(!notifyPrefs.muted.includes(k.kind), (v) => setKindOn(k.kind, v), !connected)}
                </div>
              {/each}
            </section>
          </div>
        </Tabs.Content>

        <Tabs.Content value="providers" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "providers", query: settingsSearch }}>
            {@render pageHead("Providers", true)}
            <section class="settings-section">
              <h3 class="section-heading">Accounts</h3>
              <p class="hint">Coding agents run a CLI already signed in on the server, with its own tools — yoakeland never sees the credential. Sign in once in a terminal on the server first.</p>
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
                        <span class="list-meta warn" {@attach tip(`${c.cli} isn't on the server's PATH`)}><Icon name="warning" size={11} /> Not installed</span>
                      {:else}
                        <span class="list-meta" {@attach tip(`Runs the server's own ${c.cli} CLI`)}>{c.cli}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
                {#if isDesktop || orAccount}
                  <div class="cli-card">
                    <div class="cli-card-top">
                      <LobeIcon name="openrouter" size={22} />
                      {#if orAccount}
                        <Button type="button" onclick={() => onRemoveProvider(orAccount.name)}>Sign out</Button>
                      {:else if orStatus === "idle"}
                        <Button type="button" disabled={!connected} onclick={signInOR}>Sign in</Button>
                      {:else}
                        <Button type="button" variant="ghost" onclick={cancelOR}>Cancel</Button>
                      {/if}
                    </div>
                    <div class="list-text">
                      <span class="list-title">OpenRouter</span>
                      {#if orError}
                        <span class="list-meta warn"><Icon name="warning" size={11} /> {orError}</span>
                      {:else if orAccount}
                        <span class="list-meta">Signed in</span>
                      {:else if orStatus === "waiting"}
                        <span class="list-meta">Finish signing in in your browser…</span>
                      {:else if orStatus === "finishing"}
                        <span class="list-meta">Finishing…</span>
                      {:else}
                        <span class="list-meta" {@attach tip("Opens openrouter.ai in your browser. The server stores the key it returns")}>Sign in with your account</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">API keys</h3>
              {#if manualKeys.length}
                <ul class="list">
                  {#each manualKeys as p (p.name)}
                    <li>
                      <Icon name="brain" size={14} />
                      <div class="list-text">
                        <span class="list-title">{p.name}</span>
                        <span class="list-meta">{p.httpProvider}</span>
                      </div>
                      <Button type="button" icon variant="ghost" destructive onclick={() => onRemoveProvider(p.name)} {@attach tip("Remove")}>
                        <Icon name="trash" size={13} />
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
              <form class="inset-card provider-form" onsubmit={submitProvider}>
                <span class="row-label">Add an API key</span>
                <div class="form-grid">
                  <label>
                    Name
                    <TextField type="text" bind:value={providerName} placeholder="my-anthropic" />
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
                    <TextField bind:value={apiKey} type="password" placeholder="sk-…" />
                  </label>
                  <label>
                    <span>Base URL <span class="optional">(optional)</span></span>
                    <TextField type="text" bind:value={baseUrl} placeholder="http://localhost:11434/v1" />
                  </label>
                </div>
                <Button variant="primary" class="align-end" type="submit" disabled={!connected || !providerName.trim() || !apiKey.trim()}>
                  Add key
                </Button>
              </form>
            </section>

            <section class="settings-section">
              <h3 class="section-heading">Model roles</h3>
              <p class="hint">Hand parts of every chat's work on this server to other models — strong where it pays, cheap where it doesn't. Unset roles use the chat's own model. Coding agents route their own models and skip these.</p>
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
              <p class="hint">Folders on this server offered in the sidebar's project picker.</p>
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
              <Button type="button" class="align-start" disabled={!connected} onclick={() => cid && browseAndAddProject(cid)}>
                <Icon name="folder-plus" size={13} /> Add project…
              </Button>
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
            </section>

            <section class="settings-section">
              <div class="section-head">
                <h3 class="section-heading">People</h3>
                {#if !addingPerson}
                  <Button type="button" size="sm" disabled={!isLocalConnection} onclick={() => (addingPerson = true)}>
                    <Icon name="plus" size={13} /> Add person
                  </Button>
                {/if}
              </div>
              <p class="hint">Each person gets their own token, and their chats and git commits carry its name. Names are fixed once registered, so revoke and re-register to rename.</p>

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
                    <label>Name <TextField type="text" placeholder="name" bind:value={tokenNameInput} disabled={!isLocalConnection} /></label>
                    <label>
                      <span>Email <span class="optional">(optional)</span></span>
                      <TextField type="email" placeholder="for git commits" bind:value={tokenEmailInput} disabled={!isLocalConnection} />
                    </label>
                  </div>
                  <div class="btn-row align-end">
                    <Button type="button" variant="ghost" onclick={() => (addingPerson = false)}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={!isLocalConnection || !tokenNameInput.trim()}>
                      <Icon name="plus" size={13} /> Add
                    </Button>
                  </div>
                </form>
              {/if}

              <ul class="list">
                {#each (server?.tokens ?? []) as token (token.name)}
                  <li>
                    <span class="avatar-dot"><Icon name="user" size={13} /></span>
                    <div class="list-text">
                      <span class="list-title">{token.name}</span>
                      <span class="list-meta">{token.email ?? "no email"}</span>
                    </div>
                    <Button type="button"
                      icon variant="ghost" destructive
                      onclick={() => onRemoveToken(token.name)}
                      disabled={!isLocalConnection}
                      {@attach tip("Revoke access")}
                    >
                      <Icon name="user-x" size={13} />
                    </Button>
                  </li>
                {:else}
                  <li class="empty">No one yet.</li>
                {/each}
              </ul>
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
              </section>
            {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="audit" class="tab-panel">
          <div class="tab-body" use:searchable={{ tab: "audit", query: settingsSearch }}>
            {@render pageHead("Audit log", true)}
            <section class="settings-section">
              <p class="hint">What was approved or refused, what ran, and which settings, credentials and devices changed on this server. Kept on the server (newest 15 MB), never containing a password, token or key.</p>
              <AuditPanel cid={cid ?? null} connected={!!connected} />
            </section>
          </div>
        </Tabs.Content>
      </Tabs.Root>
      </div>
    </Dialog.Content>
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
    width: min(72rem, 94vw);
    height: min(50rem, 90vh);
    display: flex;
    /* A dialog card is a floating surface like any other, see the --float-*
       tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
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
    scrollbar-gutter: stable;
    padding: 1.14rem 1.71rem 1.71rem;
  }
  :global(.tab-panel[hidden]) {
    display: none;
  }
  .tab-body {
    --ctrl-h: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.43rem;
    max-width: 44rem;
    margin-inline: auto;
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
    gap: 0.86rem;
    padding-top: 1.43rem;
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

  /* ---- Controls: one height (--ctrl-h, shared with Dropdown) for every field and button.
     The controls themselves are in components/ui; these only size them for a settings row. ---- */
  :global(.ui-field.ctrl-wide) {
    width: 15rem;
  }
  /* Unit in a fixed column so the fields line up down the page whatever their unit is. */
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
    min-width: 9rem;
    background: rgba(255, 255, 255, 0.05);
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
    background: rgba(255, 255, 255, 0.03);
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
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
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
    border-radius: var(--radius-lg);
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
  .code-preview :global(.code-block) {
    margin: 0;
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
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  /* The check lives in the left margin a grouped item is already indented by; Default (no group)
     gets the same x and its content is pushed over to line up with the rest. */
  .diff-preview {
    display: inline-flex;
    gap: 0.14rem;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .diff-preview span {
    width: 1.14rem;
    text-align: center;
    border-radius: var(--radius-xs);
  }
  .diff-preview .add {
    color: var(--diff-add);
    background: color-mix(in srgb, var(--diff-add) 14%, transparent);
  }
  .diff-preview .del {
    color: var(--diff-del);
    background: color-mix(in srgb, var(--diff-del) 14%, transparent);
  }
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
  .profile-card {
    flex-direction: row;
    align-items: center;
    gap: 1.43rem;
    padding: 1.14rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
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

  :global(.settings-back),
  :global(.settings-exit) {
    display: none;
  }
  .settings-swipe {
    display: contents;
  }
  @media (max-width: 700px) {
    :global(.settings-tabs) {
      position: relative;
      touch-action: pan-y;
    }
    .settings-bar {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin: 0 0 0.5rem -0.5rem;
    }
    :global(.settings-exit) {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.3rem;
      height: 2.3rem;
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      color: var(--text-dim);
    }
    :global(.settings-title) {
      margin: 0 !important;
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
      color: inherit;
    }
    :global(.settings-tabs .settings-tab-trigger::after) {
      content: "›";
      margin-left: auto;
      font-size: 1.3em;
      opacity: 0.45;
    }
    :global(.settings-tabs.detail .tabs-list),
    :global(.settings-tabs:not(.detail) .tab-panel) {
      display: none;
    }
    :global(.tab-panel) {
      padding: 0.7rem 1rem calc(var(--safe-bottom) + 1.4rem);
    }
    .settings-back {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 2.3rem;
      height: 2.3rem;
      margin-left: -0.5rem;
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      color: var(--text-dim);
    }
    .page-head {
      min-height: 2.4rem;
      padding-right: 0;
    }
    .setting-row {
      flex-wrap: wrap;
      gap: 0.5rem 1.14rem;
    }
    .setting-text {
      flex: 1 1 11rem;
    }
    .setting-row > :last-child {
      max-width: 100%;
    }
    :global(.ui-field.ctrl-wide) {
      width: min(15rem, 100%);
    }
  }
</style>

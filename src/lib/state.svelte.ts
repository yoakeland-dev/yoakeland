import type {
  AskUserQuestionData,
  ChatMessage,
  ChatMode,
  CliKind,
  DirectoryEntry,
  FileDiff,
  GitStatus,
  NativeToolFields,
  ServerNotification,
  ServerStatus,
  Envelope,
  PeerInfo,
  ModelInfo,
  ModelOptions,
  PendingAsk,
  PermissionRequestData,
  ProviderInfo,
  SandboxTier,
  SessionSummary,
  SnapshotInfo,
  TerminalStatus,
  TerminalTab,
  TokenInfo,
  ToolCallEntry,
  ToolCallRequestedData,
  ToolResultData,
  TurnCompletedData,
  TerminalSummary,
} from "./types";

/** A tool call as persisted on a `get_session_history` assistant entry (§3.2). */
type HistoryToolCall = { id: string; name: string; args: Record<string, unknown> } & NativeToolFields;
import { deriveTheme, deriveTerminalTheme, TERMINAL_THEME_PRESETS } from "./theme";
import { invoke, setWindowChrome, syncNativeChrome, trafficLightsWidth, windowChromeKind } from "./platform";
import { base64ToBytes } from "./base64";
import { publishTerminalChunk, publishTerminalSnapshot } from "./terminalBus";

// Transport is Unix socket (local) or TCP+token (remote) per §2a — this only
// tracks which one we're on, for display purposes.
export type ConnectionMode = "local" | "remote";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// Opaque and client-minted (electron/backend.js mints it on connect_tcp/
// connect_unix). It is not yoakeland's own serverId (ServerState.serverId below),
// which isn't known until server_identity's first reply. This is what keys
// `AppState.servers`: a client can hold several of these open at once, one
// per live connection, each to a potentially different server.
export type ConnectionId = string;

/** What's needed to redial a connection — captured at connect time so a
 * reconnect (see ipc.ts's scheduleReconnect) can redial the exact same
 * target under a fresh ConnectionId, and so a known server can eventually be
 * offered back for reconnection without the user re-entering host/path
 * (never the token itself — see KnownServer's own doc comment). */
export type ConnectParams =
  | { mode: "local"; socketPath: string; binPath: string }
  | { mode: "remote"; host: string; port: number; token: string; caPem?: string };

const RECENT_PROJECTS_KEY = "yoake.recentProjects";
const CHAT_HISTORY_KEY = "yoake.chatHistory";
const LAST_USED_PROVIDER_KEY = "yoake.lastUsedProvider";
const LAST_USED_MODEL_KEY = "yoake.lastUsedModel";
const LAST_USED_MODE_KEY = "yoake.lastUsedMode";

// Event types whose handleEvent case reads the resolved top-level `sessionId`
// (as opposed to a project-scoped or self-contained payload) — an envelope
// of one of these with neither `sessionId` nor a current session is dropped
// rather than processed against a bogus "" session.
const SESSION_SCOPED_EVENTS = new Set([
  "model_delta",
  "tool_call_requested",
  "permission_request",
  "ask_user_question_requested",
  "tool_result",
  "turn_completed",
  "session_taken_over",
  "plan_written",
]);

// A path handler passed straight to `onclick` (instead of wrapped in an
// arrow function) receives the DOM event in place of its intended string
// argument — `String(event)` stringifies to this. Filters out that specific
// garbage shape wherever a path/project key is read back from storage.
function looksLikePath(p: unknown): p is string {
  return typeof p === "string" && !/^\[object \w+\]$/.test(p);
}

/** A pre-upgrade install may have "ask"/"auto" persisted under this key —
 * treated as invalid rather than migrated (ensureSession falls back to the
 * "read_write" default), since it's a one-time cosmetic default, not data
 * loss. */
function isChatMode(m: unknown): m is ChatMode {
  return m === "read_only" || m === "read_write" || m === "autonomous" || m === "plan";
}

interface ChatHistory {
  messagesBySession: Record<string, ChatMessage[]>;
  projectBySession: Record<string, string>;
  sessionsByProject: Record<string, SessionSummary[]>;
}

const EMPTY_CHAT_HISTORY: ChatHistory = { messagesBySession: {}, projectBySession: {}, sessionsByProject: {} };

/** Every render path (AssistantMessage.svelte's `segments`, first thing) reads
 * `message.text`/`message.toolCalls` unconditionally, with no defensive
 * check — `ChatMessage` declares both required, and every in-app constructor
 * (addUserMessage, applySessionHistory) honors that. localStorage doesn't:
 * it's a plain JSON blob that outlives whatever shape wrote it, so a message
 * saved by an older build (or corrupted by hand) can come back without one
 * and crash the whole chat view on load. Patch it back to the required shape
 * at the one place untrusted-by-construction data enters `$state`, rather
 * than defensive-checking every render site. */
function sanitizeChatHistory(history: ChatHistory): ChatHistory {
  const messagesBySession: Record<string, ChatMessage[]> = {};
  for (const [sessionId, msgs] of Object.entries(history.messagesBySession ?? {})) {
    messagesBySession[sessionId] = (msgs ?? []).map((m) => ({
      ...m,
      text: m.text ?? "",
      toolCalls: m.toolCalls ?? [],
    }));
  }
  const sessionsByProject: Record<string, SessionSummary[]> = {};
  for (const [project, sessions] of Object.entries(history.sessionsByProject ?? {})) {
    if (looksLikePath(project)) sessionsByProject[project] = sessions;
  }
  const projectBySession: Record<string, string> = {};
  for (const [sessionId, project] of Object.entries(history.projectBySession ?? {})) {
    if (looksLikePath(project)) projectBySession[sessionId] = project;
  }
  return { ...history, messagesBySession, sessionsByProject, projectBySession };
}

// --- Per-server persistence (namespaced by yoakeland's own stable serverId,
// SPEC.md §3.2 server_identity — not this client's ConnectionId, which is
// fresh every connect and would silently orphan a server's saved state on
// every reconnect) ---

function serverStorageKey(serverId: string, suffix: string): string {
  return `yoake.server.${serverId}.${suffix}`;
}

function loadServerRecentProjects(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(serverStorageKey(serverId, "recentProjects"));
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).filter(looksLikePath);
  } catch {
    return [];
  }
}

function saveServerRecentProjects(serverId: string, paths: string[]) {
  try {
    localStorage.setItem(serverStorageKey(serverId, "recentProjects"), JSON.stringify(paths.slice(0, 20)));
  } catch {
    // best-effort only
  }
}

function loadServerChatHistory(serverId: string): ChatHistory {
  try {
    const raw = localStorage.getItem(serverStorageKey(serverId, "chatHistory"));
    if (!raw) return { ...EMPTY_CHAT_HISTORY };
    return sanitizeChatHistory({ ...EMPTY_CHAT_HISTORY, ...(JSON.parse(raw) as ChatHistory) });
  } catch {
    return { ...EMPTY_CHAT_HISTORY };
  }
}

function saveServerChatHistory(serverId: string, history: ChatHistory) {
  try {
    localStorage.setItem(serverStorageKey(serverId, "chatHistory"), JSON.stringify(history));
  } catch {
    // best-effort only
  }
}

function loadServerString(serverId: string, suffix: string): string | null {
  try {
    return localStorage.getItem(serverStorageKey(serverId, suffix));
  } catch {
    return null;
  }
}

function saveServerString(serverId: string, suffix: string, value: string) {
  try {
    localStorage.setItem(serverStorageKey(serverId, suffix), value);
  } catch {
    // best-effort only
  }
}

const MIGRATED_LEGACY_STATE_KEY = "yoake.migratedLegacyState";

/** Runs at most once, ever, the first time ANY server's real serverId
 * becomes known after upgrading past the point where this client only ever
 * talked to one server (flat, un-namespaced localStorage keys). The *first*
 * connection to successfully report a serverId is the migration target —
 * there's exactly one plausible one for a pre-upgrade single-server install,
 * so there's nothing to ask the user to disambiguate. If no connection ever
 * succeeds after upgrading, this never runs and the legacy keys are simply
 * never touched — no guessing, nothing lost. */
function migrateLegacyStateIfNeeded(serverId: string) {
  try {
    if (localStorage.getItem(MIGRATED_LEGACY_STATE_KEY)) return;
    const moves: [string, string][] = [
      [RECENT_PROJECTS_KEY, "recentProjects"],
      [CHAT_HISTORY_KEY, "chatHistory"],
      [LAST_USED_PROVIDER_KEY, "lastUsedProvider"],
      [LAST_USED_MODEL_KEY, "lastUsedModel"],
      [LAST_USED_MODE_KEY, "lastUsedMode"],
    ];
    for (const [legacyKey, suffix] of moves) {
      const value = localStorage.getItem(legacyKey);
      if (value !== null) {
        localStorage.setItem(serverStorageKey(serverId, suffix), value);
        localStorage.removeItem(legacyKey);
      }
    }
    localStorage.setItem(MIGRATED_LEGACY_STATE_KEY, "1");
  } catch {
    // best-effort — worst case this re-attempts on a later launch
  }
}

// --- Known servers (yoake.knownServers) — everything needed to reconnect
// a remembered server on startup (ipc.ts's autoConnect) except a remote's
// token, which lives outside localStorage in the backend's owner-only
// credentials file (electron/backend.js), keyed by serverId. ---

export interface KnownServer {
  serverId: string;
  mode: ConnectionMode;
  host?: string;
  port?: number;
  socketPath?: string;
  /** Last-known display identity, so a remembered-servers list can show a
   * name before ever reconnecting. */
  label?: string;
}

const KNOWN_SERVERS_KEY = "yoake.knownServers";
const SPEND_TODAY_KEY = "yoake.spendToday";

function loadSpendToday(): { day: string; usd: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SPEND_TODAY_KEY) ?? "null");
    if (v && typeof v.day === "string" && typeof v.usd === "number") return v;
  } catch {
    // fall through
  }
  return { day: "", usd: 0 };
}

/** Read by the server lists in CommandPalette.svelte and SettingsPanel.svelte
 * — everything else about known servers stays internal to this module. */
export function loadKnownServers(): KnownServer[] {
  try {
    const raw = localStorage.getItem(KNOWN_SERVERS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).filter(
      (s): s is KnownServer => !!s && typeof s === "object" && typeof (s as KnownServer).serverId === "string",
    );
  } catch {
    return [];
  }
}

function upsertKnownServer(entry: KnownServer) {
  try {
    const known = loadKnownServers().filter((s) => s.serverId !== entry.serverId);
    known.unshift(entry);
    localStorage.setItem(KNOWN_SERVERS_KEY, JSON.stringify(known));
  } catch {
    // best-effort only
  }
}

/** Drops one entry from the remembered-servers list — the other half of
 * upsertKnownServer, so a server that showed up here (e.g. from a stray
 * connect attempt, or one you just don't want offered for reconnect anymore)
 * can actually be forgotten. Used by ipc.ts's removeServer for a currently
 * live connection, and directly by CommandPalette's "known servers" list for
 * one that isn't. */
export function forgetKnownServer(serverId: string) {
  try {
    localStorage.setItem(KNOWN_SERVERS_KEY, JSON.stringify(loadKnownServers().filter((s) => s.serverId !== serverId)));
  } catch {
    // best-effort only
  }
  void storeServerToken(serverId, null);
}

/** A remote server's auth token, remembered so it can reconnect unattended
 * (startup and dropped connections alike). null deletes it. */
export function storeServerToken(serverId: string, token: string | null): Promise<void> {
  return invoke<void>("store_credential", { key: serverId, value: token }).catch(() => {});
}
export function loadServerToken(serverId: string): Promise<string | null> {
  return invoke<string | null>("load_credential", { key: serverId }).catch(() => null);
}

/** Stable key for a (provider, model) pair — used as a Svelte `#each` key in
 * ModelPicker.svelte. Favorites themselves are server-persisted per provider
 * (SPEC.md §6b `set_favorite_models`), not tracked client-side any more. */
export function modelKey(providerName: string, model: string): string {
  return `${providerName}::${model}`;
}

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const RIGHT_SIDEBAR_MIN_WIDTH = 220;
export const CHAT_SIDEBAR_MIN_WIDTH = 220;
export const TERMINAL_MIN_HEIGHT = 120;

function loadBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // best-effort only
  }
}

const SIDEBAR_COLLAPSED_KEY = "yoake.sidebarCollapsed";
const RIGHT_SIDEBAR_COLLAPSED_KEY = "yoake.rightSidebarCollapsed";
const SIDEBAR_WIDTH_KEY = "yoake.sidebarWidth";
const RIGHT_SIDEBAR_RATIO_KEY = "yoake.rightSidebarRatio";
const TERMINAL_HEIGHT_RATIO_KEY = "yoake.terminalHeightRatio";
const CHAT_SIDEBAR_WIDTH_RATIO_KEY = "yoake.chatSidebarWidthRatio";
const SETTINGS_KEY = "yoake.settings";

// Appearance/profile preferences — entirely per-device, client-only (no
// protocol involvement). "Custom color themes" is just `accent` overridden at
// runtime; everything derived from it uses CSS color-mix() (see app.css) so
// it stays correct without recomputing per theme.
export interface AppSettings {
  /** "system" follows the OS's prefers-color-scheme, re-applied live when it
   * changes (listener registered once in +page.svelte). */
  theme: "dark" | "light" | "system";
  accent: string;
  /** Root font size in px — every rem-sized thing scales with it, so the UI
   * presents it as an interface scale (14px = 100%). */
  uiFontSize: number;
  codeFontSize: number;
  uiFontFamily: string;
  codeFontFamily: string;
  codeWrapLines: boolean;
  /** Code block syntax colors — same choice as the terminal's: derived from
   * the accent, or one of TERMINAL_THEME_PRESETS. See highlight.ts. */
  codeUseAppTheme: boolean;
  codeColorTheme: string;
  animationSpeed: number;
  /** "floating": the chat area is an inset rounded card. "flat": it fills
   * its space edge to edge with square corners — see [data-main] in app.css. */
  mainArea: "floating" | "flat";
  profileName: string;
  /** Either an emoji glyph or an uploaded 96x96 photo as a data URL — see
   * avatar.ts. Sent to every server this client connects to when
   * identifying (§2a `auth`) — one identity, shared across all of them, not
   * a per-server setting. */
  profileAvatar: string;
  wallpaper: string;
  /** Shader treatment applied to the new-chat wallpaper — see wallpaperGL.ts. */
  wallpaperStyle: "dither" | "scanlines" | "ascii" | "dotmatrix" | "gameboy";
  /** How the surfaces floating over the rest of the UI are finished: "opaque"
   * is the plain panel fill, "frosted" makes the composer, popup panels and
   * dialog cards, the idle pills and the window-chrome islands translucent
   * over a background blur. Pure CSS — all this setting does is toggle the
   * `data-surface` attribute the --float-* tokens hang off (see app.css), so
   * it needs nothing from the server or the render loop. The surfaces that
   * aren't floating (chat panel, both sidebars, terminal drawer) are
   * deliberately not part of it. */
  surface: "opaque" | "frosted";
  /** Window controls and the drag strip. */
  windowChrome: boolean;
  /** Keep the accent in sync with the wallpaper instead of picking one by
   * hand — re-derived whenever the wallpaper changes. */
  accentFromWallpaper: boolean;
  /** Sessions untouched this many days are treated as archived in the
   * sidebar's Archive tab even without the `archived` flag set — a display
   * categorization only, never mutates the server-side flag on its own. */
  autoArchiveDays: number;
  /** One trusted CA certificate (PEM) per "host:port" — yoakeland's TCP
   * listener is TLS-only, either via its own auto-managed CA (the normal
   * case, paired by importing its ca.pem once) or an operator-supplied real
   * certificate (left unpaired here, verified against the OS trust store
   * instead). Keyed by address rather than serverId because it has to be
   * looked up *before* a connection succeeds (palette's connect page prefill) —
   * before which no serverId is knowable. See trustedCaByServer for the
   * keyed-by-identity counterpart used once one is. */
  trustedCaByHostPort: Record<string, string>;
  /** The same pairing, re-keyed by the server's own stable serverId once
   * it's known (ServerState.hydrateFromServerId copies it over the first
   * time a given server is seen) — this is the one that's actually
   * authoritative for "do I already trust this server," since a server's
   * address can change (a new LAN IP, a different hostname) while its
   * identity doesn't. Both maps are kept, deliberately not collapsed to one
   * key (see the multi-server plan). */
  trustedCaByServer: Record<string, string>;
  /** true (default): the terminal's colors track the app's own accent/mode,
   * same generator (theme.ts's deriveTerminalTheme) that's always driven it.
   * false: pick one of theme.ts's TERMINAL_THEME_PRESETS by id instead. */
  terminalUseAppTheme: boolean;
  /** Preset id from TERMINAL_THEME_PRESETS — only consulted when
   * terminalUseAppTheme is false. */
  terminalColorTheme: string;
  /** xterm.js's smoothScrollDuration: 0 (default, matches xterm's own
   * default) is instant/no easing; TerminalView.svelte maps true to a fixed
   * duration. */
  terminalSmoothScroll: boolean;
  /** Padding inside the terminal pane, in px — TerminalView.svelte's
   * .terminal-view. Split horizontal/vertical since that's how the pane was
   * already padded (asymmetric) before this was configurable. */
  terminalMarginX: number;
  terminalMarginY: number;
  /** Which provider the status bar's usage widget shows collapsed, as
   * "<serverId>:<kind>" (UsageWidget.svelte). "" = the most-used one. */
  usageFocus: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accent: "#7c9bff",
  uiFontSize: 14,
  codeFontSize: 12.5,
  uiFontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  codeFontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  codeWrapLines: true,
  codeUseAppTheme: true,
  codeColorTheme: "dracula",
  animationSpeed: 1,
  mainArea: "floating",
  profileName: "",
  profileAvatar: "🐣",
  wallpaper: "",
  wallpaperStyle: "dither",
  surface: "opaque",
  windowChrome: true,
  accentFromWallpaper: false,
  autoArchiveDays: 14,
  trustedCaByHostPort: {},
  trustedCaByServer: {},
  terminalUseAppTheme: true,
  terminalColorTheme: "dracula",
  terminalSmoothScroll: false,
  terminalMarginX: 10,
  terminalMarginY: 5,
  usageFocus: "",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const loaded = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : { ...DEFAULT_SETTINGS };
    // A settings.json from before trustedCaByServer existed (or from before
    // the host:port map was renamed from trustedCaByServer to
    // trustedCaByHostPort) has neither field as an object — guard rather
    // than let a later `map[key] = ...` throw on undefined.
    if (!loaded.trustedCaByHostPort) loaded.trustedCaByHostPort = {};
    if (!loaded.trustedCaByServer) loaded.trustedCaByServer = {};
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Everything scoped to one connection — one server, whichever projects and
 * sessions live on it. `AppState.servers` holds one of these per live
 * connection; `AppState.active` is whichever the UI is currently showing
 * (today, always exactly one — see the multi-server-connections plan). Every
 * method here that used to read `this.settings`/`this.log(...)` on the old
 * single-server AppState now reaches through `this.app` for the handful of
 * things that are genuinely global rather than per-server. */
export class ServerState {
  // Not readonly: a dropped local connection reconnects under a new id (the
  // backend mints a fresh one per connect call). Rather
  // than losing this object's in-memory state (current session/project, nav
  // history, caches) and starting a fresh ServerState, ipc.ts's redial()
  // re-keys this same instance into app.servers under the new id and updates
  // this field to match, so a reconnect looks the same as it always has:
  // quietly picking back up, not resetting to an empty state.
  connectionId: ConnectionId;
  private readonly app: AppState;
  connectParams: ConnectParams;

  /** Null until server_identity's first reply lands on this connection. */
  serverId = $state<string | null>(null);
  connectionMode: ConnectionMode;
  connectionStatus = $state<ConnectionStatus>("connected");
  connectionError = $state<string | null>(null);

  // Not UI-bound, so a plain field rather than $state: whether the *next*
  // project_opened response should switch currentProjectPath. open_project
  // (SPEC.md §3.1) itself has no such concept — it just opens/validates a
  // path — so "should this also switch the active project" is a client-side
  // decision the sender (ipc.selectProject vs. ipc.browseAndAddProject)
  // makes per call. Defaults true so every other/future open_project caller
  // keeps today's switch-on-open behavior unless it opts out.
  nextProjectOpenSwitches = true;

  sandboxTierByProject = $state<Record<string, SandboxTier>>({});
  snapshotsByProject = $state<Record<string, SnapshotInfo[]>>({});
  showSnapshots = $state(false);
  // Set on snapshot_restored (§3.2) so SnapshotDialog can confirm the
  // in-flight restore actually completed instead of closing optimistically.
  lastSnapshotRestored = $state<{ snapshotId: string; at: number } | null>(null);

  // Shared notification feed (§3.2 `notification`) — replayed by
  // list_notifications on connect, then kept live by pushes. `unseen` counts
  // arrivals since the notification center was last opened.
  notifications = $state<ServerNotification[]>([]);
  unseenNotifications = $state(0);
  // Last status snapshot from the heartbeat (§2a), for the status bar.
  serverStatus = $state<ServerStatus | null>(null);

  // Peer registry & server identity (§2a/§3.2) — pushed live, never polled.
  peers = $state<PeerInfo[]>([]);
  /** Our own peerId on this server (peer_list's `you`; null on older servers). */
  selfPeerId = $state<string | null>(null);
  serverIdentity = $state<string | null>(null);
  /** What the UI calls this server everywhere (lists, badges, avatars). */
  get label(): string {
    return this.serverIdentity ?? (this.connectionMode === "local" ? "Local" : "Remote");
  }
  /** A project's display name — qualified "server/project" for a remote,
   * since the sidebar and palette list every server's projects together. */
  projectLabel(path: string): string {
    const name = this.projectName(path);
    return this.connectionMode === "local" ? name : `${this.label}/${name}`;
  }
  /** Just the project's own name (a local rename, else its folder name). */
  projectName(path: string): string {
    return this.projectLabels[path] ?? path.split(/[/\\]/).filter(Boolean).pop() ?? path;
  }
  // Last-known state of the optional TCP listener, from this connection's own
  // set_remote_access calls (there's no "get current state" event in the
  // wire protocol — see remote_access_set in §3.2).
  remoteAccessEnabled = $state<boolean | null>(null);

  // Same push-only pattern as remoteAccessEnabled: no "get current state"
  // call, just whatever auto_generate_title (§3.2) last pushed.
  autoGenerateTitleEnabled = $state<boolean | null>(null);
  // Per-person tokens (§3.1) — local-socket-only, populated by list_tokens on
  // connect and kept live by token_registered/token_removed. `justRegistered`
  // holds the one-time raw token from token_registered so Settings can show
  // a "copy this now" reveal — cleared once acknowledged, never persisted.
  tokens = $state<TokenInfo[]>([]);
  justRegisteredToken = $state<{ name: string; token: string; caPem?: string } | null>(null);

  // Set while a session's transcript is being refetched from the server
  // (get_session_history, ipc.ts's openChatSession) — the chat view grays
  // out and blocks input for that session until session_history lands, so
  // stale cached content can't be edited/sent-to underneath an in-flight
  // resync. Cleared on session_history, and wholesale on disconnect since no
  // response is coming for any of them any more.
  syncingSessions = $state<Record<string, boolean>>({});

  // Projects (§4b): a server process can have many open at once. `projects`
  // is what the server has told us is live this run (`project_list`, though
  // nothing currently reads this field separately from `recentProjects`).
  // `recentProjects` is the actual project switcher/picker list — a thin,
  // capped (20-entry) local cache reconciled against the server's own
  // persisted `projects.json` (§4b) on every `project_list` response, not an
  // independent source of truth: the server is now the durable memory of
  // "which projects exist" (so a second device sees a project this one
  // added), this is just what paints instantly before that round-trip lands.
  // Both loaded lazily once serverId is known (see hydrateFromServerId) —
  // there's nothing to load before then.
  projects = $state<string[]>([]);
  recentProjects = $state<string[]>([]);
  currentProjectPath = $state<string | null>(null);

  sessionsByProject = $state<Record<string, SessionSummary[]>>({});
  // Sessions are cached client-side (see messagesBySession/saveChatHistory), so
  // a re-fetch never needs to blank the list — the sidebar just dims whatever
  // it already has until the fresh session_list lands (see ProjectGroup.svelte).
  refreshingProjects = $state<Record<string, boolean>>({});
  projectBySession = $state<Record<string, string>>({});
  filesByProject = $state<Record<string, string[]>>({});

  currentSessionId = $state<string | null>(null);
  /** The one chat shown in the right sidebar, if any — set via the "open in
   * side panel" button on a session row (Sidebar.svelte / ProjectGroup.svelte),
   * cleared by closing it from the panel's own header. Independent of
   * `currentSessionId`. */
  sidebarSessionId = $state<string | null>(null);
  // Each chat's own terminal drawer, independent of every other chat's — see
  // ChatPanel.svelte. Not persisted to localStorage the way most toggles
  // here are.
  terminalOpenBySession = $state<Record<string, boolean>>({});
  // Built-in terminal (SPEC.md §3.1/§3.2 terminal_*) — see TerminalPanel.svelte/
  // TerminalView.svelte. `terminalsBySession` is tab order (client-side only,
  // drag-reorderable — the wire protocol has no ordering concept),
  // `terminalById` the metadata each tab chip renders off. The pty bytes
  // themselves never live here — see terminalBus.ts.
  terminalsBySession = $state<Record<string, string[]>>({});
  terminalById = $state<Record<string, TerminalTab>>({});
  // Set once terminal_list has actually answered for a session — lets
  // TerminalPanel tell "no terminals yet" from "haven't heard back yet" so
  // opening the drawer right after opening a chat doesn't spawn a redundant
  // tab on top of ones the session already had.
  terminalsListedBySession = $state<Record<string, boolean>>({});
  activeTerminalBySession = $state<Record<string, string | undefined>>({});
  // Split view (requirement 2): a second pane showing a second tab alongside
  // the active one. `terminalSplitBySession` is the on/off toggle;
  // `splitTerminalBySession` which tab fills that second pane. Not the same
  // tab as `activeTerminalBySession` for that session — see
  // setActiveTerminalTab/setSplitTerminalTab, which swap rather than
  // duplicate if the user picks the tab already showing in the other pane.
  terminalSplitBySession = $state<Record<string, boolean>>({});
  splitTerminalBySession = $state<Record<string, string | undefined>>({});
  // Each chat's own right-edge panel — NOT the same thing as `sidebarSessionId`
  // (a second, independent linked *chat* shown side by side). This is a
  // single chat's own auxiliary view onto itself: its plan, file previews,
  // diffs, snapshots. See ChatSidebar.svelte. Also not persisted, same
  // reasoning as terminalOpenBySession above.
  chatSidebarOpenBySession = $state<Record<string, boolean>>({});
  messagesBySession = $state<Record<string, ChatMessage[]>>({});
  activeTurnBySession = $state<Record<string, string | undefined>>({});
  takenOverSessions = $state<Record<string, boolean>>({});
  // A turn that completed while its session wasn't the open one — cleared the
  // moment that session is opened, so the sidebar's "finished" state means
  // "done, and you haven't looked yet."
  finishedSessions = $state<Record<string, boolean>>({});

  providers = $state<ProviderInfo[]>([]);
  cliAvailability = $state<Partial<Record<CliKind, boolean>>>({});
  providerBySession = $state<Record<string, string | undefined>>({});
  modelBySession = $state<Record<string, string | undefined>>({});
  // Set when a turn comes back with finishReason "no_provider" (the selected
  // provider became unavailable between being picked and the turn actually
  // running — removed by another peer, credential revoked, etc.) — blocks
  // ModelPicker's own "adopt lastUsedProvider automatically" convenience
  // from immediately re-selecting the same now-broken provider. Cleared the
  // moment the user (re)confirms a provider via provider_set.
  providerBlockedBySession = $state<Record<string, boolean>>({});
  // Text PromptInput should restore into its composer — either a message
  // "unsent" by a no_provider rejection (see the turn_completed case) or, via
  // ipc.startEditingMessage, a message's old content while the user edits it.
  restoredDraftBySession = $state<Record<string, string>>({});
  // Set by ipc.startEditingMessage while the composer holds a message's old
  // content for editing — PromptInput's submit() calls editMessage instead of
  // sendPrompt while this is set for its session, and clears it afterward.
  editingMessageId = $state<Record<string, string | undefined>>({});
  // Reasoning effort / thinking budget / context-window override, per
  // session (§3.1 set_model_options). model_options_set only echoes what
  // that particular request changed — a left-unchanged field comes back
  // zero/empty, not the value still in effect — so the handler merges in
  // only the non-empty fields rather than overwriting this wholesale.
  modelOptionsBySession = $state<Record<string, ModelOptions>>({});
  // Fetched lazily per provider (list_models, §3.1) rather than up front —
  // never hardcode a model list, the whole point is it reflects whatever the
  // upstream account currently has access to.
  modelsByProvider = $state<Record<string, ModelInfo[]>>({});
  // Whatever provider/model/mode last got confirmed active on *any* session
  // on THIS server — new sessions default to this (see ModelPicker.svelte,
  // ensureSession below) instead of always landing on "Provider…" and making
  // the user reselect every chat. Per-server because a provider name only
  // means something within the registry it was registered against.
  lastUsedProvider = $state<string | null>(null);
  lastUsedModel = $state<string | null>(null);
  lastUsedMode = $state<ChatMode | null>(null);
  modeBySession = $state<Record<string, ChatMode>>({});
  // Project-scoped web_search/web_fetch toggle (§3.1 set_web_tools_enabled) —
  // independent of mode, persisted server-side.
  webToolsEnabledByProject = $state<Record<string, boolean>>({});
  // write_plan's output (§4c) — one plan file per session, keyed by session so
  // a re-write lands "in place" rather than stacking. openPlanSessionId is
  // which one (if any) the side panel is currently showing.
  planBySession = $state<Record<string, { path: string; content: string; updatedAt: number }>>({});
  openPlanSessionId = $state<string | null>(null);

  // Every unanswered permission/question ask on this server, oldest first —
  // across all sessions, including ones this client never subscribed to.
  // Replaced wholesale by each pending_asks snapshot (§3.2, sent on connect
  // and after every change); the live permission_request/
  // ask_user_question_requested events only append for instant feedback.
  pendingAsks = $state<PendingAsk[]>([]);
  // git_status (§3.2), per project. A project that never gets one isn't a
  // git repo (or the server has no git) — absence means "no git".
  gitStatusByProject = $state<Record<string, GitStatus>>({});

  // --- Sidebar-only local state, persisted per server (see saveSidebarPrefs).
  pinnedSessions = $state<string[]>([]);
  collapsedProjects = $state<Record<string, boolean>>({});
  // Manual drag order; projects not in it sort by most recent activity.
  projectOrder = $state<string[]>([]);
  // Local display names — never sent to the server.
  projectLabels = $state<Record<string, string>>({});
  // The session's server `updatedAt` as of the last time it was open here —
  // a later updatedAt means something happened while you weren't looking.
  // Server timestamps on both sides, so client clock skew can't matter.
  lastViewedBySession = $state<Record<string, string>>({});
  // Unsent composer text per chat (memory only) — PromptInput saves/restores
  // it across chat switches, and the sidebar marks chats that have one.
  composerDraftBySession = $state<Record<string, string>>({});

  private saveSidebarPrefs() {
    if (!this.serverId) return;
    saveServerString(
      this.serverId,
      "sidebar",
      JSON.stringify({
        pinned: this.pinnedSessions,
        collapsed: this.collapsedProjects,
        order: this.projectOrder,
        labels: this.projectLabels,
        lastViewed: this.lastViewedBySession,
      }),
    );
  }

  private loadSidebarPrefs(serverId: string) {
    try {
      const p = JSON.parse(loadServerString(serverId, "sidebar") ?? "{}");
      this.pinnedSessions = [...new Set([...(p.pinned ?? []), ...this.pinnedSessions])];
      this.collapsedProjects = { ...p.collapsed, ...this.collapsedProjects };
      this.projectOrder = this.projectOrder.length ? this.projectOrder : (p.order ?? []);
      this.projectLabels = { ...p.labels, ...this.projectLabels };
      this.lastViewedBySession = { ...p.lastViewed, ...this.lastViewedBySession };
    } catch {
      // corrupt prefs — start fresh
    }
  }

  togglePin(sessionId: string) {
    this.pinnedSessions = this.pinnedSessions.includes(sessionId)
      ? this.pinnedSessions.filter((id) => id !== sessionId)
      : [...this.pinnedSessions, sessionId];
    this.saveSidebarPrefs();
  }

  setProjectCollapsed(path: string, collapsed: boolean) {
    if (collapsed) this.collapsedProjects = { ...this.collapsedProjects, [path]: true };
    else {
      const { [path]: _, ...rest } = this.collapsedProjects;
      this.collapsedProjects = rest;
    }
    this.saveSidebarPrefs();
  }

  setProjectOrder(paths: string[]) {
    this.projectOrder = paths;
    this.saveSidebarPrefs();
  }

  setProjectLabel(path: string, label: string) {
    const { [path]: _, ...rest } = this.projectLabels;
    this.projectLabels = label.trim() ? { ...rest, [path]: label.trim() } : rest;
    this.saveSidebarPrefs();
  }

  /** Records `updatedAt` as seen — called for the open chat, and to seed
   * chats seen for the first time (so a fresh install isn't all unread). */
  markViewed(sessionId: string, updatedAt: string | undefined, save = true) {
    if (!updatedAt || this.lastViewedBySession[sessionId] === updatedAt) return;
    this.lastViewedBySession[sessionId] = updatedAt;
    if (save) this.saveSidebarPrefs();
  }

  isUnread(s: SessionSummary): boolean {
    if (s.sessionId === this.currentSessionId || this.activeTurnBySession[s.sessionId]) return false;
    const seen = this.lastViewedBySession[s.sessionId];
    return !!seen && Date.parse(s.updatedAt) > Date.parse(seen);
  }

  asksFor(sessionId: string): PendingAsk[] {
    return this.pendingAsks.filter((a) => a.sessionId === sessionId);
  }

  removeAsk(toolCallId: string) {
    this.pendingAsks = this.pendingAsks.filter((a) => a.toolCallId !== toolCallId);
  }

  private addAsk(ask: PendingAsk) {
    if (this.pendingAsks.some((a) => a.toolCallId === ask.toolCallId)) return;
    this.pendingAsks = [...this.pendingAsks, ask];
  }

  // --- Chat history navigation (the titlebar island's back/forward arrows).
  // Two plain stacks, pushed by ipc.ts's openChatSession — the one funnel every
  // *user-initiated* session switch goes through — so opening a chat from the
  // sidebar, a split row or the side panel all land in the same history, while
  // the automatic opens (restoreLastSession on startup, selectProject's
  // clearing of the current session) deliberately don't.
  navBack = $state<string[]>([]);
  navForward = $state<string[]>([]);

  constructor(connectionId: ConnectionId, app: AppState, connectParams: ConnectParams) {
    this.connectionId = connectionId;
    this.app = app;
    this.connectParams = connectParams;
    this.connectionMode = connectParams.mode;
  }

  /** Every known session, keyed by id, regardless of project — splits can
   * pair sessions from different sidebar sections (a running task with a
   * regular one), so pairing lookups need to search across all of them.
   * `$derived` rather than a plain getter so it's computed once per change
   * to `sessionsByProject`, not rebuilt from scratch on every access — this
   * is read inside sidebar `{#each}` loops, once per row. */
  sessionById: Map<string, SessionSummary> = $derived.by(() => {
    const m = new Map<string, SessionSummary>();
    for (const list of Object.values(this.sessionsByProject)) {
      for (const s of list) m.set(s.sessionId, s);
    }
    return m;
  });

  /** The partner half of any pairing whose anchor also currently exists —
   * hidden from its own natural spot in the sidebar (Running section or its
   * project's list) since it renders stacked under its anchor instead (see
   * splitPartnerFor). The anchor (whichever session carries
   * `linkedSessionId`) always keeps its natural position; the partner just
   * tags along, regardless of its own timestamp or running state. Driven by
   * the session's own server-persisted `linkedSessionId` (SPEC.md §3.1
   * set_session_layout) rather than separate client-only state. Also
   * `$derived` for the same reason as `sessionById` above. */
  hiddenSplitSessionIds: Set<string> = $derived.by(() => {
    const byId = this.sessionById;
    const hidden = new Set<string>();
    for (const s of byId.values()) {
      if (s.linkedSessionId && byId.has(s.linkedSessionId)) hidden.add(s.linkedSessionId);
    }
    return hidden;
  });

  /** For `sessionId` acting as a pairing's anchor, the partner session to
   * render stacked beneath it, if any. */
  splitPartnerFor(sessionId: string): SessionSummary | null {
    const linkedId = this.sessionById.get(sessionId)?.linkedSessionId;
    return linkedId ? (this.sessionById.get(linkedId) ?? null) : null;
  }

  /** Whether the current main chat can anchor a split: not an unstarted
   * draft (nothing to persist the pairing on) and not archived — same
   * archived rule as the sidebar's (explicit flag or auto-archive age). */
  get canSplitCurrent(): boolean {
    const id = this.currentSessionId;
    if (!id || !(this.messagesBySession[id] ?? []).length) return false;
    const s = this.sessionById.get(id);
    if (!s) return false;
    return !s.archived && this.app.now - new Date(s.updatedAt).getTime() <= this.app.settings.autoArchiveDays * 86400000;
  }

  get currentSessions(): SessionSummary[] {
    if (!this.currentProjectPath) return [];
    return this.sessionsByProject[this.currentProjectPath] ?? [];
  }

  get currentMessages(): ChatMessage[] {
    if (!this.currentSessionId) return [];
    return this.messagesBySession[this.currentSessionId] ?? [];
  }

  get isCurrentTurnActive(): boolean {
    if (!this.currentSessionId) return false;
    return !!this.activeTurnBySession[this.currentSessionId];
  }

  get canGoBack(): boolean {
    return this.navBack.length > 0;
  }

  get canGoForward(): boolean {
    return this.navForward.length > 0;
  }

  sessionStatus(sessionId: string): "working" | "action" | "finished" | "idle" {
    if (this.takenOverSessions[sessionId]) return "idle";
    if (this.pendingAsks.some((a) => a.sessionId === sessionId)) return "action";
    if (this.activeTurnBySession[sessionId]) return "working";
    if (this.finishedSessions[sessionId]) return "finished";
    return "idle";
  }

  setSessionSyncing(sessionId: string, syncing: boolean) {
    if (syncing) this.syncingSessions[sessionId] = true;
    else delete this.syncingSessions[sessionId];
    this.syncingSessions = { ...this.syncingSessions };
  }

  clearAllSessionSyncing() {
    this.syncingSessions = {};
  }

  /** Chats otherwise live only in memory (§ messagesBySession) and vanish on
   * restart even though the server-side session survives — mirror them to
   * localStorage the same way recentProjects already is. No-ops until
   * serverId is known (nowhere durable to file it yet — see
   * hydrateFromServerId, which re-derives everything from disk once it is,
   * so nothing written before that point needs a retroactive flush). */
  private saveChatHistory() {
    if (!this.serverId) return;
    saveServerChatHistory(this.serverId, {
      messagesBySession: this.messagesBySession,
      projectBySession: this.projectBySession,
      sessionsByProject: this.sessionsByProject,
    });
  }

  /** Records "we're leaving `sessionId`" just before a switch. Any forward
   * history is dropped, since the branch it led to is no longer reachable. */
  pushNavHistory(sessionId: string | null) {
    if (!sessionId) return;
    this.navBack = [...this.navBack, sessionId];
    this.navForward = [];
  }

  /** Drops entries whose session is gone — deleted from the sidebar while it
   * sat in the stack — so a step can't land on a phantom chat. Membership is
   * tested against the two maps a real (or locally started) session always has
   * an entry in and a deleted one has had removed (see the session_deleted
   * case, which clears both). */
  private pruneNav(stack: string[]): string[] {
    return stack.filter((id) => id in this.messagesBySession || id in this.projectBySession);
  }

  /** Moves one step back through the history and returns the session to open,
   * or null at the end of it. Only the stack is touched here — opening is the
   * caller's (ipc.ts's navigateSessionHistory), which also has to refetch. */
  stepBack(): string | null {
    this.navBack = this.pruneNav(this.navBack);
    this.navForward = this.pruneNav(this.navForward);
    const target = this.navBack[this.navBack.length - 1];
    if (!target) return null;
    this.navBack = this.navBack.slice(0, -1);
    if (this.currentSessionId) this.navForward = [this.currentSessionId, ...this.navForward];
    return target;
  }

  stepForward(): string | null {
    this.navBack = this.pruneNav(this.navBack);
    this.navForward = this.pruneNav(this.navForward);
    const [target, ...rest] = this.navForward;
    if (!target) return null;
    this.navForward = rest;
    if (this.currentSessionId) this.navBack = [...this.navBack, this.currentSessionId];
    return target;
  }

  /** Optimistically flips one model's `isFavorite` so the star responds
   * instantly — the server round-trip (`set_favorite_models`, sent by the
   * caller) is the actual source of truth and corrects this on
   * `favorite_models_set` if it disagrees. */
  setModelFavorite(providerName: string, model: string, isFavorite: boolean) {
    const models = this.modelsByProvider[providerName];
    if (!models) return;
    this.modelsByProvider = {
      ...this.modelsByProvider,
      [providerName]: models.map((m) => (m.id === model ? { ...m, isFavorite } : m)),
    };
  }

  ensureSession(sessionId: string) {
    if (!this.messagesBySession[sessionId]) {
      this.messagesBySession[sessionId] = [];
    }
    if (!this.modeBySession[sessionId]) {
      const lastMode = this.lastUsedMode;
      this.modeBySession[sessionId] = isChatMode(lastMode) ? lastMode : "read_write";
    }
  }

  /** Persists the last mode a user picked on this server, so the next new
   * chat starts there instead of always defaulting back to Read-Write (see
   * ensureSession). */
  setLastUsedMode(mode: ChatMode) {
    this.lastUsedMode = mode;
    if (this.serverId) saveServerString(this.serverId, "lastUsedMode", mode);
  }

  rememberProject(path: string) {
    if (!this.projects.includes(path)) this.projects = [...this.projects, path];
    const withoutIt = this.recentProjects.filter((p) => p !== path);
    this.recentProjects = [path, ...withoutIt].slice(0, 20);
    if (this.serverId) saveServerRecentProjects(this.serverId, this.recentProjects);
  }

  /** Removes a saved path from the picker (Settings > Projects). Purely
   * the local half — the caller also sends remove_project so the server
   * stops re-adding it via the next project_list (see ipc.removeProject).
   * Also drops its sessions from sessionsByProject/projectBySession —
   * otherwise they keep showing in the sidebar's cross-project Active/
   * Archive lists (see sessionById) and reopening one rebinds
   * currentProjectPath to the "removed" path, which resurrects it server-side
   * (Resolve -> Get -> Upsert) on that session's next request. */
  forgetProject(path: string) {
    this.projects = this.projects.filter((p) => p !== path);
    this.recentProjects = this.recentProjects.filter((p) => p !== path);
    if (this.serverId) saveServerRecentProjects(this.serverId, this.recentProjects);
    // Falls back to whatever's next in the list rather than going empty —
    // same idiom as restoreLastSession's own recentProjects[0] fallback. A
    // project stays selected whenever one is still available; null only
    // when this really was the last one.
    if (this.currentProjectPath === path) this.currentProjectPath = this.recentProjects[0] ?? null;
    delete this.gitStatusByProject[path];
    const orphaned = this.sessionsByProject[path] ?? [];
    delete this.sessionsByProject[path];
    for (const s of orphaned) {
      delete this.projectBySession[s.sessionId];
      if (this.currentSessionId === s.sessionId) this.currentSessionId = null;
    }
    this.saveChatHistory();
  }

  selectProject(path: string) {
    this.currentProjectPath = path;
    this.currentSessionId = null;
  }

  /** Reopens whichever session last had a message, so a restart drops the
   * user back where they left off instead of the picker — "remember the
   * project of the latest session." Falls back to the most recently used
   * project (no session bound yet) when there's no chat history at all. */
  restoreLastSession() {
    if (this.currentSessionId) return;
    let latestId: string | null = null;
    let latestTime = -Infinity;
    for (const [sessionId, msgs] of Object.entries(this.messagesBySession)) {
      const last = msgs[msgs.length - 1];
      if (last && last.createdAt > latestTime) {
        latestTime = last.createdAt;
        latestId = sessionId;
      }
    }
    if (latestId) {
      this.openSession(latestId);
    } else if (this.recentProjects[0]) {
      this.currentProjectPath = this.recentProjects[0];
    }
  }

  /** The chat view never shows an empty placeholder screen (§ ChatPanel) —
   * there's always a session to render, even before a project is picked.
   * The composer itself disables sending until a project is bound
   * (PromptInput's `projectPath` check) rather than hiding the whole UI. */
  ensureCurrentSession() {
    if (this.currentSessionId) return;
    if (this.currentProjectPath) {
      this.newSessionInProject(this.currentProjectPath);
    } else {
      const id = `session-${crypto.randomUUID().slice(0, 8)}`;
      this.ensureSession(id);
      this.currentSessionId = id;
    }
  }

  /** Opens `sessionId` as the main chat. If it has a server-persisted
   * `linkedSessionId` (SPEC.md §3.1 set_session_layout), its partner reopens
   * with it in the side panel — a saved pairing *is* the saved layout,
   * there's no separate open/closed flag to check. A plain session with no
   * pairing clears the side panel, same as switching away from any split. */
  openSession(sessionId: string) {
    this.ensureSession(sessionId);
    this.currentSessionId = sessionId;
    app.showUsage = false;
    const partner = this.splitPartnerFor(sessionId);
    if (partner) {
      this.ensureSession(partner.sessionId);
      this.sidebarSessionId = partner.sessionId;
      this.app.rightSidebarCollapsed = false;
    } else {
      this.sidebarSessionId = null;
    }
    this.takenOverSessions[sessionId] = false;
    if (this.finishedSessions[sessionId]) {
      delete this.finishedSessions[sessionId];
      this.finishedSessions = { ...this.finishedSessions };
    }
    const project = this.projectBySession[sessionId];
    if (project) this.currentProjectPath = project;
    this.markViewed(sessionId, this.sessionById.get(sessionId)?.updatedAt);
  }

  /** Shows `sessionId` in the right sidebar, un-collapsing it if needed —
   * pure UI state. Creating/persisting the pairing itself is ipc.ts's
   * `openInSidePanel` (it needs to reach the server, §3.1 set_session_layout,
   * which this module can't import without a circular dependency on ipc.ts). */
  showInSidePanel(sessionId: string) {
    this.sidebarSessionId = sessionId;
    this.app.rightSidebarCollapsed = false;
  }

  closeSidePanel() {
    this.sidebarSessionId = null;
  }

  toggleTerminal(sessionId: string) {
    this.terminalOpenBySession[sessionId] = !this.terminalOpenBySession[sessionId];
  }

  // ---- Built-in terminal (SPEC.md §3.1/§3.2 terminal_*) ----

  /** Registers a brand-new tab optimistically, before the server confirms it
   * via terminal_snapshot — TerminalView.svelte calls this the moment it
   * mints a fresh terminalId, so the chip renders instantly instead of
   * waiting a round trip. A tab discovered via terminal_list (opened by this
   * client earlier, or another peer) is registered by that handler instead
   * (handleEvent's "terminal_list" case) — this is only for the "+ New Tab"
   * path. */
  registerTerminalTab(sessionId: string, terminalId: string) {
    if (!this.terminalById[terminalId]) {
      this.terminalById = {
        ...this.terminalById,
        [terminalId]: { terminalId, sessionId, cols: 80, rows: 24, status: "starting", label: "shell", sequence: 0 },
      };
    }
    if (!this.terminalsBySession[sessionId]?.includes(terminalId)) {
      this.terminalsBySession[sessionId] = [...(this.terminalsBySession[sessionId] ?? []), terminalId];
    }
    if (!this.activeTerminalBySession[sessionId]) this.activeTerminalBySession[sessionId] = terminalId;
  }

  /** Focuses `terminalId` in the main pane. If it's currently filling the
   * split pane instead, swap the two rather than showing the same tab
   * twice. */
  setActiveTerminalTab(sessionId: string, terminalId: string) {
    if (this.splitTerminalBySession[sessionId] === terminalId) {
      this.splitTerminalBySession[sessionId] = this.activeTerminalBySession[sessionId];
    }
    this.activeTerminalBySession[sessionId] = terminalId;
  }

  /** Same swap-not-duplicate rule as setActiveTerminalTab, for the split
   * pane. */
  setSplitTerminalTab(sessionId: string, terminalId: string) {
    if (this.activeTerminalBySession[sessionId] === terminalId) {
      this.activeTerminalBySession[sessionId] = this.splitTerminalBySession[sessionId];
    }
    this.splitTerminalBySession[sessionId] = terminalId;
  }

  /** Requirement 2: an option to have two split terminals. Turning it on
   * defaults the second pane to whichever other tab is open, if any —
   * turning it back off just hides that pane, it doesn't close the tab in
   * it. */
  toggleTerminalSplit(sessionId: string) {
    const on = !this.terminalSplitBySession[sessionId];
    this.terminalSplitBySession[sessionId] = on;
    if (on && !this.splitTerminalBySession[sessionId]) {
      const tabs = this.terminalsBySession[sessionId] ?? [];
      const other = tabs.find((id) => id !== this.activeTerminalBySession[sessionId]);
      this.splitTerminalBySession[sessionId] = other ?? this.activeTerminalBySession[sessionId];
    }
  }

  /** Drag-to-reorder (requirement 4) — purely a local arrangement, the wire
   * protocol has no ordering concept for tabs. Moves `fromId` to sit where
   * `toId` currently is. */
  reorderTerminalTabs(sessionId: string, fromId: string, toId: string) {
    const tabs = [...(this.terminalsBySession[sessionId] ?? [])];
    const from = tabs.indexOf(fromId);
    const to = tabs.indexOf(toId);
    if (from === -1 || to === -1 || from === to) return;
    tabs.splice(to, 0, ...tabs.splice(from, 1));
    this.terminalsBySession[sessionId] = tabs;
  }

  /** Drops a tab from local bookkeeping — only ever called from
   * handleEvent's "terminal_closed" case (no optimistic removal: closing a
   * terminal isn't reversible, same precedent as delete_session). Picks a
   * replacement for whichever pane(s) were showing it, if any remain. */
  private forgetTerminalTab(terminalId: string) {
    const tab = this.terminalById[terminalId];
    if (!tab) return;
    const { [terminalId]: _removed, ...rest } = this.terminalById;
    this.terminalById = rest;
    const sessionId = tab.sessionId;
    const remaining = (this.terminalsBySession[sessionId] ?? []).filter((id) => id !== terminalId);
    this.terminalsBySession[sessionId] = remaining;
    if (this.activeTerminalBySession[sessionId] === terminalId) {
      this.activeTerminalBySession[sessionId] = remaining.find((id) => id !== this.splitTerminalBySession[sessionId]);
    }
    if (this.splitTerminalBySession[sessionId] === terminalId) {
      this.splitTerminalBySession[sessionId] = remaining.find((id) => id !== this.activeTerminalBySession[sessionId]);
    }
  }

  toggleChatSidebar(sessionId: string) {
    this.chatSidebarOpenBySession[sessionId] = !this.chatSidebarOpenBySession[sessionId];
  }

  /** Repaints a session's transcript from `session_history` (§3.2) — the
   * server's persisted truth, fetched via get_session_history whenever a
   * session is opened (ipc.ts's openChatSession). `messagesBySession` is
   * otherwise just a client-side cache (built from turns *this* client has
   * streamed), so this is what makes a session opened cold — a second
   * device, a fresh install, a session another peer added to while this
   * client was offline — actually show its history instead of nothing.
   * Skipped while a turn is actively streaming in this session, so a
   * same-session history response (e.g. from a reconnect mid-turn) can't
   * clobber live-streaming state. */
  applySessionHistory(
    sessionId: string,
    messages: {
      id?: string;
      alternateIds?: string[];
      role: "user" | "assistant" | "tool";
      content: string;
      author?: string;
      authorAvatar?: string;
      attachments?: string[];
      reasoning?: string;
      toolCalls?: HistoryToolCall[];
      toolCallId?: string;
      diffs?: FileDiff[];
      error?: string;
      provider?: string;
      model?: string;
      createdAt?: string;
      generationMs?: number;
      usage?: { inputTokens: number; outputTokens: number; costUsd: number };
    }[],
  ) {
    if (this.activeTurnBySession[sessionId]) return;
    const toolResults = new Map<string, { content: string; diffs?: FileDiff[]; error?: string }>();
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId) toolResults.set(m.toolCallId, { content: m.content, diffs: m.diffs, error: m.error });
    }

    const base = Date.now();
    let turnIndex = 0;
    const out: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === "tool") continue;
      turnIndex++;
      // The server's own createdAt (§3.2) is authoritative when present —
      // fall back to the old evenly-spaced synthetic timestamp only for a
      // message stored before that field existed.
      const stored = m.createdAt ? Date.parse(m.createdAt) : NaN;
      const createdAt = Number.isFinite(stored) ? stored : base - (messages.length - turnIndex) * 1000;
      if (m.role === "user") {
        // A user message with no stored author predates the server persisting
        // who sent one (§3.2), or came from a client that doesn't report it.
        // For those, fall back to this client's own profile — that's what the
        // live bubble showed for its own messages before the reload, so the
        // repaint matches instead of dropping the name and picture. A message
        // that does carry an author keeps exactly what's stored, so another
        // person's message never picks up this client's identity.
        const storedAuthor = m.author;
        out.push({
          // The server's own id (§3.2) when present — empty/absent means a
          // message persisted before that field existed and never migrated
          // (SPEC.md: "treat absence as 'not addressable'"), so it falls back
          // to the old synthetic key rather than something edit/retry/
          // switch_branch could be sent for.
          id: m.id || `${sessionId}-hist-${turnIndex}`,
          alternateIds: m.alternateIds,
          role: "user",
          text: m.content ?? "",
          toolCalls: [],
          streaming: false,
          createdAt,
          author: storedAuthor ?? (this.app.settings.profileName || undefined),
          authorAvatar: storedAuthor
            ? m.authorAvatar
            : this.app.settings.profileAvatar || undefined,
          attachments: m.attachments,
        });
      } else {
        // A turn with tool calls makes one round-trip per assistant entry
        // here (§3.2), but the live stream accumulates all of them into a
        // single message keyed by turnId (see findAssistantMessage/
        // tool_call_requested below) — text and tool calls interleaved by
        // offset into one growing string. Reload must rebuild that same
        // shape, or each round-trip repaints as its own bubble with its own
        // footer and an uncollapsed tool group. There's no stored turnId to
        // group by, so consecutive assistant entries between two user
        // messages are assumed to be one turn.
        let cur = out[out.length - 1];
        if (!cur || cur.role !== "assistant") {
          cur = {
            id: `${sessionId}-hist-turn-${turnIndex}`,
            role: "assistant",
            text: "",
            toolCalls: [],
            streaming: false,
            createdAt,
          };
          out.push(cur);
        }
        // retryMessage's target can be any assistant message, including a
        // mid-turn round-trip that this client merges into one bubble
        // (id-per-round-trip mismatch, see the comment above) — v1 doesn't
        // build per-round-trip granularity in the UI, so "Retry" on a merged
        // bubble targets its *last* round-trip's id, which is also the id a
        // fresh switch_branch's alternateIds most recently came with.
        cur.id = m.id || cur.id;
        cur.alternateIds = m.alternateIds ?? cur.alternateIds;

        // The backend has been observed persisting the same toolCallId twice
        // (see the live tool_call_requested handler below) — dedupe here too,
        // or a duplicate key crashes the keyed {#each} over toolCalls.
        // A round-trip's text and reasoning stream *before* its tool calls,
        // so append them first — the calls' offsets then land after them,
        // matching the live render (text → call → result → text).
        cur.text += m.content ?? "";
        if (m.reasoning) cur.thinking = (cur.thinking ?? "") + m.reasoning;
        const seen = new Set(cur.toolCalls.map((t) => t.toolCallId));
        for (const tc of m.toolCalls ?? []) {
          if (seen.has(tc.id)) continue;
          seen.add(tc.id);
          const result = toolResults.get(tc.id);
          cur.toolCalls.push({
            toolCallId: tc.id,
            name: tc.name,
            args: tc.args ?? {},
            native: tc.native,
            title: tc.title,
            kind: tc.kind,
            locations: tc.locations,
            diffs: result?.diffs,
            status: result?.error ? (result.error.includes("permission denied") ? "denied" : "error") : "done",
            output: result?.content ?? "",
            error: result?.error || undefined,
            textOffset: cur.text.length,
            thinkingOffset: cur.thinking?.length ?? 0,
          });
        }
        // Provider/model/usage/duration are per round-trip; the merged
        // bubble's footer shows the turn's totals — provider/model as last
        // used (a mid-turn switch is the rare case), usage/duration summed.
        cur.provider = m.provider || cur.provider;
        cur.model = m.model || cur.model;
        cur.generationMs = (cur.generationMs ?? 0) + (m.generationMs ?? 0) || undefined;
        if (m.usage) {
          cur.usage = {
            inputTokens: m.usage.inputTokens,
            outputTokens: (cur.usage?.outputTokens ?? 0) + m.usage.outputTokens,
            costUsd: (cur.usage?.costUsd ?? 0) + m.usage.costUsd,
          };
        }
      }
    }
    this.messagesBySession[sessionId] = out;
    this.saveChatHistory();
  }

  /** A session with no server-confirmed messages yet — created locally, and
   * bound to `projectPath` the moment its first prompt goes out (§4b). */
  newSessionInProject(projectPath: string): string {
    const id = `session-${crypto.randomUUID().slice(0, 8)}`;
    this.ensureSession(id);
    this.projectBySession[id] = projectPath;
    const existing = this.sessionsByProject[projectPath] ?? [];
    this.sessionsByProject[projectPath] = [
      { sessionId: id, updatedAt: new Date().toISOString(), messageCount: 0 },
      ...existing,
    ];
    this.currentProjectPath = projectPath;
    this.currentSessionId = id;
    this.sidebarSessionId = null;
    app.showUsage = false;
    return id;
  }

  /** Every other map keyed by sessionId — shared by discardUnsentSession and
   * the session_deleted case below, both of which mean "this session no
   * longer exists, forget everything about it." A session id is a random
   * UUID that's never reused, so leaving any of these behind is pure
   * unbounded growth for the life of the app, not a display bug — but
   * ModelPicker's per-session auto-select effect and PromptInput's
   * `hasProvider` guard, plus the sidebar's status pips, all key off exactly
   * these, so a stale entry could in principle resurface against a later
   * session id that happens to collide (astronomically unlikely, but the
   * leak itself is the real problem regardless). */
  private forgetSessionState(sessionId: string) {
    delete this.projectBySession[sessionId];
    delete this.messagesBySession[sessionId];
    delete this.activeTurnBySession[sessionId];
    delete this.takenOverSessions[sessionId];
    delete this.finishedSessions[sessionId];
    delete this.providerBySession[sessionId];
    delete this.modelBySession[sessionId];
    delete this.providerBlockedBySession[sessionId];
    delete this.restoredDraftBySession[sessionId];
    delete this.editingMessageId[sessionId];
    delete this.modelOptionsBySession[sessionId];
    delete this.modeBySession[sessionId];
    delete this.planBySession[sessionId];
    delete this.syncingSessions[sessionId];
    delete this.composerDraftBySession[sessionId];
    if (sessionId in this.lastViewedBySession || this.pinnedSessions.includes(sessionId)) {
      delete this.lastViewedBySession[sessionId];
      this.pinnedSessions = this.pinnedSessions.filter((id) => id !== sessionId);
      this.saveSidebarPrefs();
    }
    if (this.currentSessionId === sessionId) this.currentSessionId = null;
    if (this.sidebarSessionId === sessionId) this.sidebarSessionId = null;
    if (this.openPlanSessionId === sessionId) this.openPlanSessionId = null;
    // delete_session kills every terminal the chat owned too (SPEC.md §3.1) —
    // terminal_closed arrives per tab, but drop the rest of this session's
    // own bookkeeping right away rather than waiting on all of them.
    for (const id of this.terminalsBySession[sessionId] ?? []) delete this.terminalById[id];
    delete this.terminalsBySession[sessionId];
    delete this.terminalsListedBySession[sessionId];
    delete this.activeTerminalBySession[sessionId];
    delete this.terminalSplitBySession[sessionId];
    delete this.splitTerminalBySession[sessionId];
    delete this.terminalOpenBySession[sessionId];
  }

  /** It never reached the server, so there's nothing to ask it to delete —
   * just forget it existed. Used when starting a new chat from one that was
   * never sent, so empty chats don't pile up (§4b). */
  discardUnsentSession(sessionId: string) {
    const project = this.projectBySession[sessionId];
    if (project && this.sessionsByProject[project]) {
      this.sessionsByProject[project] = this.sessionsByProject[project].filter(
        (s) => s.sessionId !== sessionId,
      );
    }
    this.forgetSessionState(sessionId);
  }

  addUserMessage(sessionId: string, turnId: string, text: string, attachments?: string[]) {
    this.ensureSession(sessionId);
    const msg: ChatMessage = {
      id: turnId,
      role: "user",
      turnId,
      text,
      attachments: attachments?.length ? attachments : undefined,
      toolCalls: [],
      streaming: false,
      createdAt: Date.now(),
      author: this.app.settings.profileName || undefined,
      authorAvatar: this.app.settings.profileAvatar || undefined,
    };
    this.messagesBySession[sessionId] = [...this.messagesBySession[sessionId], msg];
    this.activeTurnBySession[sessionId] = turnId;

    // Placeholder assistant message that streaming deltas fill in. Provider/
    // model are stamped now, not read back off turn_completed (which carries
    // neither, §3.2) — this is whatever the session is about to run with,
    // and stays correct as the message's own record even if the session's
    // selection changes before the next turn.
    const reply: ChatMessage = {
      id: `${turnId}-reply`,
      role: "assistant",
      turnId,
      text: "",
      toolCalls: [],
      streaming: true,
      createdAt: Date.now(),
      provider: this.providerBySession[sessionId],
      model: this.modelBySession[sessionId],
    };
    this.messagesBySession[sessionId] = [...this.messagesBySession[sessionId], reply];
    this.saveChatHistory();
  }

  /** Shared setup for edit_message/retry_message (SPEC.md §3.1/§4d) — both
   * are full turns like user_prompt, but resume history from a branch point
   * instead of appending to its end: everything from `fromIndex` onward is
   * cut locally (the server archives it, never deletes it — switch_branch is
   * how it comes back) before the fresh streaming placeholder goes on. */
  private beginBranchTurn(sessionId: string, turnId: string, fromIndex: number, replacement?: ChatMessage) {
    this.ensureSession(sessionId);
    const kept = (this.messagesBySession[sessionId] ?? []).slice(0, fromIndex);
    this.messagesBySession[sessionId] = replacement ? [...kept, replacement] : kept;
    this.activeTurnBySession[sessionId] = turnId;
    const reply: ChatMessage = {
      id: `${turnId}-reply`,
      role: "assistant",
      turnId,
      text: "",
      toolCalls: [],
      streaming: true,
      createdAt: Date.now(),
      provider: this.providerBySession[sessionId],
      model: this.modelBySession[sessionId],
    };
    this.messagesBySession[sessionId] = [...this.messagesBySession[sessionId], reply];
    this.saveChatHistory();
  }

  /** SPEC.md §3.1 edit_message — replaces `messageId`'s content in place and
   * discards everything generated after it, then starts a fresh turn. */
  beginEdit(sessionId: string, turnId: string, messageId: string, content: string) {
    delete this.editingMessageId[sessionId];
    const list = this.messagesBySession[sessionId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      // No local bubble to show the server's own "message not found" error
      // against (ipc.ts's editMessage still sends the request regardless —
      // this only skips the optimistic local update) — surface it here
      // instead of failing silently.
      this.app.log(`error: can't edit message ${messageId} — not found in this session's local history`);
      return;
    }
    // turnId (not the old message's own) so turn_completed's reconciliation
    // (below) can find this bubble by turnId and stamp in the real id the
    // server mints for the edited message — same as a brand-new user message.
    this.beginBranchTurn(sessionId, turnId, idx, { ...list[idx], text: content, turnId });
  }

  /** SPEC.md §3.1 retry_message — discards `messageId` (an assistant message,
   * possibly mid-turn after tool calls) and everything after it, then starts
   * a fresh turn. */
  beginRetry(sessionId: string, turnId: string, messageId: string) {
    const list = this.messagesBySession[sessionId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      this.app.log(`error: can't retry message ${messageId} — not found in this session's local history`);
      return;
    }
    this.beginBranchTurn(sessionId, turnId, idx);
  }

  private findAssistantMessage(sessionId: string, turnId: string | undefined): ChatMessage | undefined {
    if (!turnId) return undefined;
    const list = this.messagesBySession[sessionId];
    return list?.find((m) => m.turnId === turnId && m.role === "assistant");
  }

  /** Runs once, the first time this connection's serverId becomes known
   * (server_identity's first reply) — loads whatever this server's own
   * namespaced localStorage already has (a server this client has talked to
   * before), running the one-time legacy-flat-key migration first if this
   * turns out to be the very first serverId this client has ever seen. */
  private hydrateFromServerId(serverId: string) {
    migrateLegacyStateIfNeeded(serverId);

    // server_identity is a push that races connect: afterConnect's own calls
    // (and anything the user does) can create a session and land its first
    // message in memory before this ever runs. Merge disk-loaded state UNDER
    // whatever's already resident rather than overwriting it outright, or
    // that first chat gets wiped the instant serverId arrives — this is the
    // "first chat since the server starts isn't stored" bug: the message
    // reached the server fine, but the client's own in-memory copy of it got
    // clobbered here a moment later.
    this.recentProjects = [...new Set([...this.recentProjects, ...loadServerRecentProjects(serverId)])];
    const history = loadServerChatHistory(serverId);
    this.sessionsByProject = { ...history.sessionsByProject, ...this.sessionsByProject };
    this.projectBySession = { ...history.projectBySession, ...this.projectBySession };
    this.messagesBySession = { ...history.messagesBySession, ...this.messagesBySession };
    this.loadSidebarPrefs(serverId);
    this.lastUsedProvider = loadServerString(serverId, "lastUsedProvider");
    this.lastUsedModel = loadServerString(serverId, "lastUsedModel");
    const mode = loadServerString(serverId, "lastUsedMode");
    this.lastUsedMode = isChatMode(mode) ? mode : null;

    // The first time this particular server is seen under its real identity,
    // carry over a CA it was trusted under by address (see
    // AppSettings.trustedCaByHostPort's doc comment) — otherwise a client
    // that already paired this server's certificate would appear to have
    // forgotten it the moment serverId-based trust becomes authoritative.
    if (this.connectParams.mode === "remote") {
      const hostPortKey = `${this.connectParams.host}:${this.connectParams.port}`;
      const byHostPort = this.app.settings.trustedCaByHostPort[hostPortKey];
      if (byHostPort && !this.app.settings.trustedCaByServer[serverId]) {
        this.app.settings.trustedCaByServer[serverId] = byHostPort;
        this.app.applySettings();
      }
    }

    if (this.connectParams.mode === "remote") void storeServerToken(serverId, this.connectParams.token);
    upsertKnownServer({
      serverId,
      mode: this.connectionMode,
      host: this.connectParams.mode === "remote" ? this.connectParams.host : undefined,
      port: this.connectParams.mode === "remote" ? this.connectParams.port : undefined,
      socketPath: this.connectParams.mode === "local" ? this.connectParams.socketPath : undefined,
      label: this.serverIdentity ?? undefined,
    });

    // Was run unconditionally at app startup back when there was only ever
    // one server and its cache loaded synchronously at construction — now
    // that the cache is this server's own, loaded lazily right here, this is
    // the equivalent moment: the first point after connecting that there's
    // actually a session history to restore into.
    this.restoreLastSession();
  }

  /** Replaces sessionId's tabs with a server listing (terminal_list, or one
   * chat's slice of terminal_index). */
  private applyTerminalList(sid: string, terminals: TerminalSummary[]) {
    const ids: string[] = [];
    const nextById = { ...this.terminalById };
    for (const t of terminals) {
      ids.push(t.terminalId);
      const existing = nextById[t.terminalId];
      nextById[t.terminalId] = {
        terminalId: t.terminalId,
        sessionId: sid,
        cwd: t.cwd,
        status: t.status,
        label: t.label,
        title: existing?.title,
        cols: existing?.cols ?? 80,
        rows: existing?.rows ?? 24,
        sequence: existing?.sequence ?? 0,
        exitCode: t.status === "exited" ? (t.exitCode ?? existing?.exitCode) : undefined,
        pid: existing?.pid,
        sandboxTier: existing?.sandboxTier,
      };
    }
    this.terminalById = nextById;
    this.terminalsBySession[sid] = ids;
    this.terminalsListedBySession[sid] = true;
    const active = this.activeTerminalBySession[sid];
    if (!active || !ids.includes(active)) this.activeTerminalBySession[sid] = ids[0];
  }

  handleEvent(env: Envelope) {
    const sessionId = env.sessionId ?? this.currentSessionId ?? "";
    // A handful of event types are session-agnostic (peer_list, provider_*,
    // project_list, etc.) and are fine to process with no resolvable session
    // — but anything below that assumes a real session would otherwise
    // silently stand up a bogus "" session. Only bail for types that
    // actually need one.
    if (!sessionId && SESSION_SCOPED_EVENTS.has(env.type)) {
      this.app.log(`dropped ${env.type}: no resolvable sessionId`);
      return;
    }
    if (sessionId) this.ensureSession(sessionId);

    switch (env.type) {
      case "model_delta": {
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        const data = env.data as { content?: string; reasoning?: string };
        if (msg) {
          if (data?.reasoning) msg.thinking = (msg.thinking ?? "") + data.reasoning;
          else msg.text += String(data?.content ?? "");
        }
        break;
      }
      case "tool_call_requested": {
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        const data = env.data as unknown as ToolCallRequestedData;
        if (msg && env.toolCallId) {
          // The backend has been observed sending this event twice for the
          // same toolCallId — without a dedupe, the duplicate entry crashes
          // the {#each ... (call.toolCallId)} keyed block in ToolCallCard's
          // parent and freezes the whole message list mid-render.
          const existing = msg.toolCalls.find((t) => t.toolCallId === env.toolCallId);
          // Native calls (cli_* agents, §6b) carry title/kind/locations so
          // they render without knowing the agent's own tool names.
          const native = { native: data.native, title: data.title, kind: data.kind, locations: data.locations };
          if (existing) {
            existing.name = data.name;
            existing.args = data.args ?? {};
            Object.assign(existing, native);
          } else {
            const entry: ToolCallEntry = {
              toolCallId: env.toolCallId,
              name: data.name,
              args: data.args ?? {},
              ...native,
              status: "requested",
              textOffset: msg.text.length,
              thinkingOffset: msg.thinking?.length ?? 0,
            };
            msg.toolCalls = [...msg.toolCalls, entry];
          }
        }
        break;
      }
      case "permission_request": {
        const data = env.data as unknown as PermissionRequestData;
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        if (msg && env.toolCallId) {
          const entry = msg.toolCalls.find((t) => t.toolCallId === env.toolCallId);
          if (entry) {
            entry.status = "awaiting_permission";
            entry.permission = data;
            entry.diff = data.diff;
          }
        }
        if (env.toolCallId && env.turnId) {
          this.addAsk({
            ...data,
            kind: "permission",
            sessionId,
            projectPath: this.projectBySession[sessionId],
            turnId: env.turnId,
            toolCallId: env.toolCallId,
            createdAt: new Date().toISOString(),
          });
        }
        break;
      }
      case "ask_user_question_requested": {
        const data = env.data as unknown as AskUserQuestionData;
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        if (msg && env.toolCallId) {
          const entry = msg.toolCalls.find((t) => t.toolCallId === env.toolCallId);
          if (entry) {
            entry.status = "awaiting_answer";
            entry.question = data;
          }
        }
        if (env.toolCallId && env.turnId) {
          this.addAsk({
            ...data,
            kind: "question",
            sessionId,
            projectPath: this.projectBySession[sessionId],
            turnId: env.turnId,
            toolCallId: env.toolCallId,
            createdAt: new Date().toISOString(),
          });
        }
        break;
      }
      case "tool_result": {
        const data = env.data as unknown as ToolResultData;
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        if (msg && env.toolCallId) {
          const entry = msg.toolCalls.find((t) => t.toolCallId === env.toolCallId);
          if (entry) {
            entry.status = data.error ? (data.error.includes("permission denied") ? "denied" : "error") : "done";
            entry.output = data.output;
            entry.error = data.error;
            if (data.diffs?.length) entry.diffs = data.diffs;
          }
        }
        if (env.toolCallId) this.removeAsk(env.toolCallId);
        break;
      }
      case "turn_completed": {
        const data = env.data as unknown as TurnCompletedData;
        if (data.finishReason !== "no_provider") this.app.recordSpend(data.usage?.costUsd ?? 0);
        if (data.finishReason === "no_provider") {
          // The composer only lets you send with a provider selected, so
          // this should only be reachable if it became unavailable between
          // being picked and this turn actually running (removed by another
          // peer, credential revoked, ...). Rather than a normal completed
          // turn, "unsend" it: pull the prompt back into the composer and
          // clear the now-invalid provider selection so ModelPicker visibly
          // shows nothing chosen — which the composer's own send-guard then
          // blocks on until the user picks a provider again.
          const userMsg = this.messagesBySession[sessionId]?.find(
            (m) => m.turnId === env.turnId && m.role === "user",
          );
          if (userMsg) {
            this.restoredDraftBySession[sessionId] = userMsg.text;
            this.messagesBySession[sessionId] = this.messagesBySession[sessionId].filter(
              (m) => m.turnId !== env.turnId,
            );
          }
          delete this.providerBySession[sessionId];
          delete this.modelBySession[sessionId];
          this.providerBlockedBySession[sessionId] = true;
          delete this.activeTurnBySession[sessionId];
          this.activeTurnBySession = { ...this.activeTurnBySession };
          this.saveChatHistory();
          break;
        }
        const msg = this.findAssistantMessage(sessionId, env.turnId);
        if (msg) {
          msg.streaming = false;
          msg.finish = data;
        }
        // Swap this turn's own optimistic placeholder ids (turnId / `${turnId}-reply`,
        // see addUserMessage/beginBranchTurn) for the server's real ones the moment
        // they're known — this is what makes retry/edit work immediately after a turn
        // completes, without waiting on a session reopen to pick them up via
        // applySessionHistory. See SPEC.md v2.13's turn_completed.userMessageId/messageId.
        if (data.userMessageId) {
          const userMsg = this.messagesBySession[sessionId]?.find(
            (m) => m.turnId === env.turnId && m.role === "user",
          );
          if (userMsg) userMsg.id = data.userMessageId;
        }
        if (data.messageId && msg) {
          msg.id = data.messageId;
        }
        delete this.activeTurnBySession[sessionId];
        this.activeTurnBySession = { ...this.activeTurnBySession };
        if (sessionId !== this.currentSessionId) {
          this.finishedSessions[sessionId] = true;
          this.finishedSessions = { ...this.finishedSessions };
        }
        this.saveChatHistory();
        break;
      }
      case "session_taken_over": {
        this.takenOverSessions[sessionId] = true;
        delete this.activeTurnBySession[sessionId];
        this.activeTurnBySession = { ...this.activeTurnBySession };
        break;
      }
      case "provider_registered":
      case "provider_list": {
        const data = env.data as { providers?: ProviderInfo[]; name?: string };
        if (data.providers) this.providers = data.providers;
        break;
      }
      case "provider_removed": {
        const data = env.data as { name: string };
        this.providers = this.providers.filter((p) => p.name !== data.name);
        const { [data.name]: _removed, ...rest } = this.modelsByProvider;
        this.modelsByProvider = rest;
        break;
      }
      case "provider_set": {
        const data = env.data as { sessionId: string; providerName: string; model?: string };
        this.providerBySession[data.sessionId] = data.providerName;
        this.modelBySession[data.sessionId] = data.model;
        delete this.providerBlockedBySession[data.sessionId];
        this.lastUsedProvider = data.providerName;
        this.lastUsedModel = data.model ?? null;
        if (this.serverId) {
          saveServerString(this.serverId, "lastUsedProvider", data.providerName);
          if (data.model) saveServerString(this.serverId, "lastUsedModel", data.model);
        }
        break;
      }
      case "model_options_set": {
        const data = env.data as unknown as { sessionId: string } & ModelOptions;
        const current = this.modelOptionsBySession[data.sessionId] ?? {};
        const merged: ModelOptions = { ...current };
        if (data.reasoningEffort) merged.reasoningEffort = data.reasoningEffort;
        if (data.thinkingBudget) merged.thinkingBudget = data.thinkingBudget;
        if (data.contextWindow) merged.contextWindow = data.contextWindow;
        this.modelOptionsBySession = { ...this.modelOptionsBySession, [data.sessionId]: merged };
        break;
      }
      case "model_list": {
        const data = env.data as { providerName: string; models: ModelInfo[] };
        this.modelsByProvider = { ...this.modelsByProvider, [data.providerName]: data.models };
        break;
      }
      case "favorite_models_set": {
        const data = env.data as { providerName: string; models: string[] };
        const models = this.modelsByProvider[data.providerName];
        if (models) {
          this.modelsByProvider = {
            ...this.modelsByProvider,
            [data.providerName]: models.map((m) => ({ ...m, isFavorite: data.models.includes(m.id) })),
          };
        }
        break;
      }
      case "project_opened": {
        const data = env.data as { path: string; sandboxTier?: SandboxTier };
        // Always remember it (this is also the one place a path gets
        // upgraded from however it was raw-picked to the server's
        // canonical, symlink-resolved form — see ipc.selectProject) —
        // but only switch the active project if this open was meant to.
        this.rememberProject(data.path);
        if (this.nextProjectOpenSwitches) this.currentProjectPath = data.path;
        this.nextProjectOpenSwitches = true;
        if (data.sandboxTier) this.sandboxTierByProject[data.path] = data.sandboxTier;
        break;
      }
      case "project_list": {
        // Server-persisted and authoritative now (§4b projects.json), sorted
        // most-recently-opened first. rememberProject unshifts each path it's
        // given, so feeding it in server order would build the list
        // backwards — walk it in reverse so the end result matches.
        const data = env.data as { paths: string[] };
        const known = new Set(data.paths ?? []);
        for (const p of [...(data.paths ?? [])].reverse()) this.rememberProject(p);
        // As of backend v2.13 this can also arrive unprompted, pushed to
        // every other connection whenever one opens a project (see
        // project_removed's comment below for the same on removal) — prune
        // anything this connection still has locally that's no longer in
        // the authoritative list, the live-sync half of "deleted projects
        // still show up in the sidebar".
        for (const p of this.recentProjects.filter((p) => !known.has(p))) this.forgetProject(p);
        break;
      }
      case "project_removed": {
        // Server-confirmed removal — and, as of backend v2.13, also pushed
        // live to every other connection when removal happens elsewhere
        // (SPEC.md §3.1 remove_project), not just a direct response to this
        // connection's own removeProject call any more.
        const data = env.data as { path: string };
        this.forgetProject(data.path);
        break;
      }
      case "session_list": {
        const data = env.data as { projectPath?: string; sessions: SessionSummary[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) {
          const listed = new Set((data.sessions ?? []).map((x) => x.sessionId));
          // A chat that was never prompted doesn't exist server-side (even
          // after a mode change, §4b), so it's never listed. Keep the one
          // that's open locally until its first prompt; prune every other
          // unlisted, empty one — the ghosts older builds left in the cache.
          const keep: SessionSummary[] = [];
          for (const [id, p] of Object.entries(this.projectBySession)) {
            if (p !== project || listed.has(id) || (this.messagesBySession[id] ?? []).length > 0) continue;
            if (id === this.currentSessionId || id === this.sidebarSessionId || this.activeTurnBySession[id]) {
              const local = this.sessionsByProject[project]?.find((x) => x.sessionId === id);
              if (local) keep.push(local);
            } else {
              this.forgetSessionState(id);
            }
          }
          this.sessionsByProject[project] = [...keep, ...(data.sessions ?? [])];
          for (const s of data.sessions ?? []) {
            this.projectBySession[s.sessionId] = project;
            if (!this.lastViewedBySession[s.sessionId] || s.sessionId === this.currentSessionId) {
              this.markViewed(s.sessionId, s.updatedAt, false);
            }
          }
          this.saveSidebarPrefs();
          delete this.refreshingProjects[project];
          this.refreshingProjects = { ...this.refreshingProjects };
          this.saveChatHistory();
        }
        break;
      }
      case "session_updated": {
        const data = env.data as unknown as SessionSummary;
        const project = this.projectBySession[data.sessionId];
        if (project && this.sessionsByProject[project]) {
          this.sessionsByProject[project] = this.sessionsByProject[project].map((s) =>
            s.sessionId === data.sessionId ? { ...s, ...data } : s,
          );
          if (data.sessionId === this.currentSessionId) this.markViewed(data.sessionId, data.updatedAt);
          this.saveChatHistory();
        }
        break;
      }
      case "session_deleted": {
        const data = env.data as { sessionId: string };
        const project = this.projectBySession[data.sessionId];
        if (project && this.sessionsByProject[project]) {
          this.sessionsByProject[project] = this.sessionsByProject[project].filter(
            (s) => s.sessionId !== data.sessionId,
          );
        }
        this.forgetSessionState(data.sessionId);
        this.saveChatHistory();
        break;
      }
      case "snapshot_restored": {
        const data = env.data as { snapshotId: string };
        this.lastSnapshotRestored = { snapshotId: data.snapshotId, at: Date.now() };
        this.app.log(`snapshot restored: ${data.snapshotId}`);
        break;
      }
      case "snapshot_list": {
        const data = env.data as { projectPath?: string; snapshots: SnapshotInfo[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) this.snapshotsByProject[project] = data.snapshots ?? [];
        break;
      }
      case "directory_list": {
        // directoryListing stays global on AppState
        // (only one browse flow is ever open at once) — only apply this if
        // it's still this connection's browse in flight, so a late response
        // from an abandoned browse against a different server can't clobber
        // a newer one.
        if (this.app.browsingConnectionId === this.connectionId) {
          this.app.directoryListing = env.data as { path: string; entries: DirectoryEntry[]; error?: string };
        }
        break;
      }
      case "git_status": {
        const data = env.data as unknown as GitStatus;
        if (data?.projectPath) this.gitStatusByProject = { ...this.gitStatusByProject, [data.projectPath]: data };
        break;
      }
      case "pending_asks": {
        const data = env.data as { asks?: PendingAsk[] };
        this.pendingAsks = data?.asks ?? [];
        break;
      }
      case "cli_availability": {
        // `agents` covers every cli_* kind (§3.2); claude/codex booleans are
        // the pre-v2.15 shape, kept as a fallback for older servers.
        const data = env.data as { claude?: boolean; codex?: boolean; agents?: Partial<Record<CliKind, boolean>> };
        this.cliAvailability = data.agents ?? { cli_claude: !!data.claude, cli_codex: !!data.codex };
        break;
      }
      case "file_list": {
        const data = env.data as { projectPath?: string; files: string[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) this.filesByProject[project] = data.files ?? [];
        break;
      }
      case "notification": {
        const n = env.data as unknown as ServerNotification;
        this.notifications = [...this.notifications, n];
        this.unseenNotifications++;
        this.app.toast(this.connectionId, n);
        break;
      }
      case "notification_list": {
        const data = env.data as { notifications: ServerNotification[] };
        this.notifications = data.notifications ?? [];
        break;
      }
      case "notification_dismissed": {
        const { id } = (env.data ?? {}) as { id?: string };
        this.notifications = id ? this.notifications.filter((n) => n.id !== id) : [];
        if (!this.notifications.length) this.unseenNotifications = 0;
        break;
      }
      case "peer_list": {
        const data = env.data as { peers: PeerInfo[]; you?: string };
        this.peers = data.peers ?? [];
        this.selfPeerId = data.you ?? null;
        break;
      }
      case "server_identity": {
        const data = env.data as { identity: string; serverId?: string };
        this.serverIdentity = data.identity;
        if (data.serverId && this.serverId !== data.serverId) {
          this.serverId = data.serverId;
          this.hydrateFromServerId(data.serverId);
        }
        break;
      }
      case "remote_access_set": {
        const data = env.data as { enabled: boolean };
        this.remoteAccessEnabled = data.enabled;
        break;
      }
      case "auto_generate_title": {
        const data = env.data as { enabled: boolean };
        this.autoGenerateTitleEnabled = data.enabled;
        break;
      }
      case "session_history": {
        const data = env.data as {
          sessionId: string;
          mode?: ChatMode;
          messages: {
            id?: string;
            alternateIds?: string[];
            role: "user" | "assistant" | "tool";
            content: string;
            author?: string;
            authorAvatar?: string;
            reasoning?: string;
            toolCalls?: HistoryToolCall[];
            toolCallId?: string;
            diffs?: FileDiff[];
          }[];
        };
        this.applySessionHistory(data.sessionId, data.messages ?? []);
        // The server is the source of truth for mode (§4c) — adopt it here
        // rather than replaying a cached value via set_mode, which would race
        // a more-recently-set value from another peer.
        if (isChatMode(data.mode)) this.modeBySession[data.sessionId] = data.mode;
        this.setSessionSyncing(data.sessionId, false);
        break;
      }
      case "token_registered": {
        const data = env.data as { name: string; token: string; email?: string; caPem?: string };
        this.justRegisteredToken = { name: data.name, token: data.token, caPem: data.caPem };
        this.tokens = [...this.tokens.filter((t) => t.name !== data.name), { name: data.name, email: data.email, hasAvatar: false }];
        break;
      }
      case "token_list": {
        const data = env.data as { tokens: TokenInfo[] };
        this.tokens = data.tokens ?? [];
        break;
      }
      case "token_removed": {
        const data = env.data as { name: string };
        this.tokens = this.tokens.filter((t) => t.name !== data.name);
        break;
      }
      case "mode_set": {
        const data = env.data as { sessionId: string; mode: ChatMode };
        this.modeBySession[data.sessionId] = data.mode;
        this.lastUsedMode = data.mode;
        if (this.serverId) saveServerString(this.serverId, "lastUsedMode", data.mode);
        break;
      }
      case "web_tools_enabled_set": {
        const data = env.data as { projectPath: string; enabled: boolean };
        this.webToolsEnabledByProject = { ...this.webToolsEnabledByProject, [data.projectPath]: data.enabled };
        break;
      }
      case "plan_written": {
        const data = env.data as { path: string; content: string };
        this.planBySession = {
          ...this.planBySession,
          [sessionId]: { path: data.path, content: data.content ?? "", updatedAt: Date.now() },
        };
        if (sessionId === this.currentSessionId) this.openPlanSessionId = sessionId;
        break;
      }
      case "error": {
        const data = env.data as { message: string; fatal?: boolean; projectPath?: string };
        this.app.log(`error: ${data.message}`);
        if (data.projectPath && this.refreshingProjects[data.projectPath]) {
          delete this.refreshingProjects[data.projectPath];
          this.refreshingProjects = { ...this.refreshingProjects };
        }
        if (data.fatal) {
          this.connectionStatus = "error";
          this.connectionError = data.message;
        }
        // Some errors (e.g. a rejected project-binding conflict) arrive
        // instead of, not alongside, a turn_completed — without this the
        // composer would stay stuck on "Stop"/"turn in progress" forever.
        if (env.turnId && this.activeTurnBySession[sessionId] === env.turnId) {
          const msg = this.findAssistantMessage(sessionId, env.turnId);
          if (msg) {
            msg.streaming = false;
            // A cli_* agent that isn't logged in fails the turn with an
            // error (§6b) — say what to do instead of just echoing it.
            const note = /sign in|log ?in|not logged|unauthenticated|authenticat/i.test(data.message)
              ? `⚠ This agent isn't signed in on the server. Run it once in a terminal there and sign in, then retry.\n\n> ${data.message}`
              : `⚠ ${data.message}`;
            msg.text = msg.text ? `${msg.text}\n\n${note}` : note;
          }
          delete this.activeTurnBySession[sessionId];
          this.activeTurnBySession = { ...this.activeTurnBySession };
          this.saveChatHistory();
        }
        break;
      }
      // Terminal events (SPEC.md §3.2) — none of these carry a top-level or
      // `data.sessionId` (only terminal_list does), so they're routed by
      // `terminalId` against `terminalById` instead of the `sessionId`
      // resolved at the top of this method, which for these would just be
      // whatever chat happens to be open right now.
      case "terminal_list": {
        const data = env.data as { sessionId: string; terminals: TerminalSummary[] };
        if (data.sessionId) this.applyTerminalList(data.sessionId, data.terminals ?? []);
        break;
      }
      // Every terminal on the server (§3.2 terminal_index): a terminal_list
      // for every chat at once, so terminals opened from another device or
      // in a chat never opened here are known too.
      case "terminal_index": {
        const data = env.data as { terminals: (TerminalSummary & { sessionId: string })[] };
        const bySession: Record<string, TerminalSummary[]> = {};
        for (const t of data.terminals ?? []) {
          (bySession[t.sessionId] ??= []).push(t);
          // A chat in a project this client never listed: enough to open it.
          if (t.projectPath) this.projectBySession[t.sessionId] ??= t.projectPath;
        }
        for (const sid of Object.keys(this.terminalsBySession)) {
          if (!bySession[sid] && this.terminalsBySession[sid]?.length) bySession[sid] = [];
        }
        for (const [sid, ts] of Object.entries(bySession)) this.applyTerminalList(sid, ts);
        break;
      }
      case "terminal_snapshot": {
        const data = env.data as {
          terminalId: string;
          cwd?: string;
          cols: number;
          rows: number;
          status: TerminalStatus;
          pid?: number;
          history: string;
          sequence: number;
          label: string;
          sandboxTier?: SandboxTier;
          exitCode?: number;
        };
        const existing = this.terminalById[data.terminalId];
        // registerTerminalTab (a fresh "+ New Tab") or the "terminal_list"
        // case above always runs first for any terminalId this client knows
        // about, so `existing` should always be set here — but a snapshot
        // for an id we somehow never registered has no session to attach it
        // to, so it's dropped rather than guessed at.
        if (existing) {
          this.terminalById = {
            ...this.terminalById,
            [data.terminalId]: {
              ...existing,
              cwd: data.cwd,
              cols: data.cols,
              rows: data.rows,
              status: data.status,
              label: data.label,
              pid: data.pid,
              sequence: data.sequence,
              sandboxTier: data.sandboxTier,
              exitCode: data.exitCode,
            },
          };
        }
        if (data.history) publishTerminalSnapshot(data.terminalId, base64ToBytes(data.history));
        break;
      }
      case "terminal_output": {
        const data = env.data as { terminalId: string; data: string; sequence: number };
        const tab = this.terminalById[data.terminalId];
        if (tab) this.terminalById = { ...this.terminalById, [data.terminalId]: { ...tab, sequence: data.sequence } };
        publishTerminalChunk(data.terminalId, base64ToBytes(data.data));
        break;
      }
      case "terminal_exited": {
        const data = env.data as { terminalId: string; exitCode: number };
        const tab = this.terminalById[data.terminalId];
        if (tab) {
          this.terminalById = {
            ...this.terminalById,
            [data.terminalId]: { ...tab, status: "exited", exitCode: data.exitCode },
          };
        }
        break;
      }
      case "terminal_closed": {
        const data = env.data as { terminalId: string };
        this.forgetTerminalTab(data.terminalId);
        break;
      }
      case "terminal_error": {
        const data = env.data as { terminalId: string; message: string };
        const tab = this.terminalById[data.terminalId];
        if (tab) this.terminalById = { ...this.terminalById, [data.terminalId]: { ...tab, status: "error" } };
        this.app.log(`terminal ${data.terminalId}: ${data.message}`);
        break;
      }
      default:
        break;
    }
  }
}

class AppState {
  /** One entry per live connection (see the multi-server-connections plan).
   * Today's UI only ever creates one at a time — `active` is what every
   * component renders — but the data model itself already supports more. */
  servers = $state<Record<ConnectionId, ServerState>>({});
  activeConnectionId = $state<ConnectionId | null>(null);

  get active(): ServerState | null {
    return this.activeConnectionId ? (this.servers[this.activeConnectionId] ?? null) : null;
  }

  // Transient, global: tracks a connect attempt (CommandPalette connect page / autoConnect)
  // before any ServerState exists to hold it — there's no ConnectionId yet at
  // this point (the backend only mints one once connect_tcp/connect_unix actually
  // succeeds), so it can't live per-server the way a *lost* connection's
  // status can (see handleConnectionLost in ipc.ts, which updates an
  // existing ServerState directly). Reset back to "disconnected" the moment
  // a real ServerState is created.
  private pendingConnectStatus = $state<ConnectionStatus>("disconnected");
  private pendingConnectMode = $state<ConnectionMode>("local");
  private pendingConnectError = $state<string | null>(null);

  setPendingConnect(status: ConnectionStatus, mode?: ConnectionMode, error: string | null = null) {
    this.pendingConnectStatus = status;
    if (mode) this.pendingConnectMode = mode;
    this.pendingConnectError = error;
  }

  /** Back-compat convenience so every existing read site keeps working
   * unchanged: transparently reflects the active server's own connection
   * state once one exists, or the in-flight connect attempt before that. */
  get connectionStatus(): ConnectionStatus {
    return this.active?.connectionStatus ?? this.pendingConnectStatus;
  }
  get connectionMode(): ConnectionMode {
    return this.active?.connectionMode ?? this.pendingConnectMode;
  }
  get connectionError(): string | null {
    return this.active?.connectionError ?? this.pendingConnectError;
  }

  showSettings = $state(false);
  /** The usage page, shown in the chat panel's place (UsagePanel.svelte);
   * opening any chat closes it. */
  showUsage = $state(false);
  settingsTab = $state("appearance");

  /** Providers live under Settings now, not a standalone modal — this is the
   * one place that opens straight to that tab (e.g. "no provider" prompts). */
  openProviderSettings() {
    this.showSettings = true;
    this.settingsTab = "providers";
  }

  /** Adding a server is a form, so it lives in Settings → Servers rather
   * than the palette — the palette's "Add server…" lands here, optionally
   * prefilled with a remembered remote's address when it has to pair again
   * (see connectServerRow). SettingsPanel consumes and clears it. */
  addServerRequest = $state<{ host?: string; port?: number } | null>(null);
  openAddServer(host?: string, port?: number) {
    this.addServerRequest = { host, port };
    this.settingsTab = "servers";
    this.showSettings = true;
  }

  // Layout: both sidebars slide off-screen when collapsed rather than
  // shrinking — see Sidebar.svelte/RightSidebar.svelte. Their shared toggle
  // button is pinned top-left of the whole window (+page.svelte), outside
  // either sidebar, so it stays put across the collapse.
  sidebarCollapsed = $state(typeof localStorage !== "undefined" ? loadBool(SIDEBAR_COLLAPSED_KEY) : false);
  rightSidebarCollapsed = $state(
    typeof localStorage !== "undefined" ? loadBool(RIGHT_SIDEBAR_COLLAPSED_KEY) : false,
  );
  // Shared with the top bar so its left segment can line up with the
  // sidebar's actual (resizable) width instead of guessing at it.
  sidebarWidth = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 250 : 250,
  );
  // A fraction (0–0.5) of the space next to the (fixed-width) left sidebar,
  // not a pixel value — RightSidebar.svelte turns it into a live width with
  // a plain CSS `clamp()` against `.content-row`, so the actual rendered
  // width stays proportional across window resizes and left-sidebar
  // width/collapse changes with no JS keeping the two in sync.
  rightSidebarRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(RIGHT_SIDEBAR_RATIO_KEY)) || 0.22 : 0.22,
  );
  // Same idea as rightSidebarRatio, but for the two per-chat embedded panels
  // (TerminalPanel.svelte, ChatSidebar.svelte) — one shared size each across
  // every chat rather than per-session, matching how rightSidebarRatio is one
  // shared size rather than per-pairing. Terminal's is a fraction of the
  // chat's own height (capped at 0.5), the chat sidebar's a fraction of its
  // width (also capped at 0.5) — see each component's own resize handle.
  terminalHeightRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(TERMINAL_HEIGHT_RATIO_KEY)) || 0.35 : 0.35,
  );
  chatSidebarWidthRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(CHAT_SIDEBAR_WIDTH_RATIO_KEY)) || 0.32 : 0.32,
  );

  // Live, unpersisted: true while the corresponding ratio above is actively
  // being dragged, by that panel's own resize handle or by the corner handle
  // where the right sidebar and terminal meet (+page.svelte) — either one
  // sets the same flag, so that edge's accent highlight lights up regardless
  // of which handle is driving it.
  rightSidebarResizing = $state(false);
  terminalResizing = $state(false);

  settings = $state<AppSettings>(typeof localStorage !== "undefined" ? loadSettings() : { ...DEFAULT_SETTINGS });

  // Only one directory-browse flow (§3.1 list_directory) is ever open at
  // once, so these stay global rather than duplicated per server —
  // `browsingConnectionId` names which connection's browse is currently in
  // flight, so a late directory_list from an abandoned browse can't clobber
  // a newer one against a different server (see ServerState.handleEvent's
  // directory_list case).
  directoryListing = $state<{ path: string; entries: DirectoryEntry[]; error?: string } | null>(null);
  browsingConnectionId = $state<ConnectionId | null>(null);

  // Ctrl+K command palette (CommandPalette.svelte). Each openPalette() is a
  // fresh request: it opens on that page, or pushes it if already open; the
  // palette keeps its own back-stack from there.
  paletteOpen = $state(false);
  paletteRequest = $state<{ page: "root" | "projects" | "browse" | "servers"; at: number }>({ page: "root", at: 0 });
  openPalette(page: "root" | "projects" | "browse" | "servers" = "root") {
    this.paletteRequest = { page, at: performance.now() };
    this.paletteOpen = true;
  }

  // ModelPicker instances watch this to open themselves on request (the
  // palette's "Open model picker"): one picker per visible chat, so the
  // request names which chat's.
  modelPickerRequest = $state<{ sessionId: string; at: number } | null>(null);

  notificationsOpen = $state(false);
  // Transient pop-ups for live notifications, bottom-right. Only the active
  // server's, and not for the chat the user is already looking at.
  // Spend across every server today, tallied from the turn_completed events
  // this app sees (any peer's turns on a connected server). Resets at local
  // midnight; kept in localStorage so a restart doesn't zero it.
  spendToday = $state<{ day: string; usd: number }>(loadSpendToday());
  recordSpend(usd: number) {
    if (!usd) return;
    const day = new Date().toDateString();
    this.spendToday = { day, usd: (this.spendToday.day === day ? this.spendToday.usd : 0) + usd };
    try {
      localStorage.setItem(SPEND_TODAY_KEY, JSON.stringify(this.spendToday));
    } catch {
      // best-effort only
    }
  }

  toasts = $state<(ServerNotification & { connectionId: ConnectionId; action?: { label: string; run: () => void } })[]>([]);
  /** A client-side toast with an action button (e.g. "Archived — Undo"). */
  toastAction(connectionId: ConnectionId, title: string, action: { label: string; run: () => void }) {
    const id = `local-${Date.now()}`;
    this.toasts = [
      ...this.toasts.slice(-2),
      { id, level: "info", kind: "local", title, createdAt: new Date().toISOString(), connectionId, action },
    ];
    setTimeout(() => this.dropToast(id), 6_000);
  }

  // Ticks once a minute so relative times ("3m") re-render instead of
  // freezing at whatever they were when their row last rendered.
  now = $state(Date.now());
  private nowTimer = typeof window !== "undefined" ? setInterval(() => (this.now = Date.now()), 30_000) : undefined;
  toast(connectionId: ConnectionId, n: ServerNotification) {
    if (connectionId !== this.activeConnectionId || this.notificationsOpen) return;
    if (n.sessionId && n.sessionId === this.active?.currentSessionId && document.hasFocus()) return;
    this.toasts = [...this.toasts.slice(-2), { ...n, connectionId }];
    setTimeout(() => this.dropToast(n.id), n.level === "error" || n.level === "warning" ? 10_000 : 5_000);
  }
  dropToast(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  logs = $state<string[]>([]);

  log(line: string) {
    this.logs.push(line);
    if (this.logs.length > 500) this.logs.shift();
  }

  toggleSidebar() {
    this.setSidebarCollapsed(!this.sidebarCollapsed);
  }

  /** Sets (rather than flips) the sidebar's collapsed state, persisting it the
   * same way the toggle does. Sidebar.svelte's drag-to-collapse uses this to
   * track the pointer live — collapsing past the threshold and re-expanding
   * when it comes back out — so it can't go through toggleSidebar. */
  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    saveBool(SIDEBAR_COLLAPSED_KEY, collapsed);
  }

  /** Sets (rather than flips) the right sidebar's collapsed state, persisted
   * the same way every other layout toggle here is — RightSidebar.svelte's
   * drag-to-collapse uses this to track the pointer live, same reason
   * Sidebar.svelte's setSidebarCollapsed exists. */
  setRightSidebarCollapsed(collapsed: boolean) {
    this.rightSidebarCollapsed = collapsed;
    saveBool(RIGHT_SIDEBAR_COLLAPSED_KEY, collapsed);
  }

  setSidebarWidth(width: number) {
    this.sidebarWidth = width;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // best-effort only
    }
  }

  /** Persists a new proportion for the right sidebar (0–0.5, a fraction of
   * the space next to the left sidebar) — the actual live pixel width is
   * entirely CSS's job (RightSidebar.svelte's `clamp()`, sized against
   * `.content-row`), so it reflows in real time with the left sidebar's own
   * width/collapse changes and window resizes with no JS synchronization. */
  setRightSidebarRatio(ratio: number) {
    this.rightSidebarRatio = Math.min(0.5, Math.max(0, ratio));
    try {
      localStorage.setItem(RIGHT_SIDEBAR_RATIO_KEY, String(this.rightSidebarRatio));
    } catch {
      // best-effort only
    }
  }

  /** Same idea as setRightSidebarRatio, for TerminalPanel.svelte's own
   * resize handle (a fraction of the chat panel's height, capped at 0.5). */
  setTerminalHeightRatio(ratio: number) {
    this.terminalHeightRatio = Math.min(0.5, Math.max(0, ratio));
    try {
      localStorage.setItem(TERMINAL_HEIGHT_RATIO_KEY, String(this.terminalHeightRatio));
    } catch {
      // best-effort only
    }
  }

  /** Same idea as setRightSidebarRatio, for ChatSidebar.svelte's own resize
   * handle (a fraction of the chat panel's width, capped at 0.5). */
  setChatSidebarWidthRatio(ratio: number) {
    this.chatSidebarWidthRatio = Math.min(0.5, Math.max(0, ratio));
    try {
      localStorage.setItem(CHAT_SIDEBAR_WIDTH_RATIO_KEY, String(this.chatSidebarWidthRatio));
    } catch {
      // best-effort only
    }
  }

  /** "system" resolved against the OS's live preference; "dark"/"light" pass
   * straight through. Every consumer that needs an actual paintable mode
   * (colorScheme, deriveTheme) goes through this instead of `settings.theme`
   * directly. */
  get resolvedTheme(): "dark" | "light" {
    if (this.settings.theme !== "system") return this.settings.theme;
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  /** Persists `settings` and pushes it onto the document as CSS custom
   * properties / a `data-theme` attribute — call after any mutation made
   * through the Settings UI, and once at startup. */
  applySettings() {
    if (typeof document === "undefined") return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // best-effort only
    }
    const root = document.documentElement;
    const resolved = this.resolvedTheme;
    root.style.colorScheme = resolved;
    // Every surface token, not just --accent — a color scheme (predefined or
    // custom) recolors the whole UI, derived from one hue (see theme.ts).
    const tokens = deriveTheme(this.settings.accent, resolved);
    root.style.setProperty("--bg", tokens.bg);
    root.style.setProperty("--panel-bg", tokens.panelBg);
    root.style.setProperty("--panel-border", tokens.panelBorder);
    root.style.setProperty("--panel-border-top", tokens.panelBorderTop);
    root.style.setProperty("--panel-border-bottom", tokens.panelBorderBottom);
    root.style.setProperty("--sidebar-fg", tokens.sidebarFg);
    root.style.setProperty("--sidebar-fg-dim", tokens.sidebarFgDim);
    root.style.setProperty("--sidebar-hover", tokens.sidebarHover);
    root.style.setProperty("--sidebar-active", tokens.sidebarActive);
    root.style.setProperty("--text", tokens.text);
    root.style.setProperty("--text-dim", tokens.textDim);
    root.style.setProperty("--accent", tokens.accent);
    root.style.setProperty("--bubble-user-bg", tokens.bubbleUserBg);
    root.style.setProperty("--bubble-border", tokens.bubbleBorder);
    root.style.setProperty("--statusbar-bg", tokens.statusbarBg);
    root.style.setProperty("--statusbar-fg", tokens.statusbarFg);
    root.style.setProperty("--ui-font-size", `${this.settings.uiFontSize}px`);
    root.style.setProperty("--code-font-size", `${this.settings.codeFontSize}px`);
    root.style.setProperty("--ui-font-family", this.settings.uiFontFamily);
    root.style.setProperty("--code-font-family", this.settings.codeFontFamily);
    root.style.setProperty("--anim-speed", String(this.settings.animationSpeed));
    root.style.setProperty("--code-wrap", this.settings.codeWrapLines ? "pre-wrap" : "pre");
    // Code blocks borrow the terminal palette's ANSI slots for token colors
    // (see Markdown.svelte's .hljs-* rules).
    const code =
      (!this.settings.codeUseAppTheme && TERMINAL_THEME_PRESETS.find((p) => p.id === this.settings.codeColorTheme)?.colors) ||
      deriveTerminalTheme(this.settings.accent, resolved);
    root.style.setProperty("--code-bg", code.background);
    root.style.setProperty("--code-fg", code.foreground);
    root.style.setProperty("--syn-comment", code.brightBlack);
    root.style.setProperty("--syn-keyword", code.magenta);
    root.style.setProperty("--syn-string", code.green);
    root.style.setProperty("--syn-number", code.yellow);
    root.style.setProperty("--syn-function", code.blue);
    root.style.setProperty("--syn-type", code.cyan);
    root.style.setProperty("--syn-variable", code.red);
    // The frosted/opaque switch is entirely CSS — the --float-* tokens hang off
    // this attribute, so nothing else here has to know about it.
    root.dataset.surface = this.settings.surface;
    root.dataset.main = this.settings.mainArea;
    this.applyWindowChrome();
    syncNativeChrome();
  }

  /** Separate from applySettings so +page.svelte can run it before the first render. */
  applyWindowChrome() {
    const root = document.documentElement;
    if (windowChromeKind && this.settings.windowChrome) root.dataset.windowChrome = windowChromeKind;
    else delete root.dataset.windowChrome;
    root.style.setProperty("--traffic-lights-w", `${trafficLightsWidth}px`);
    void setWindowChrome(this.settings.windowChrome);
  }
}

export const app = new AppState();

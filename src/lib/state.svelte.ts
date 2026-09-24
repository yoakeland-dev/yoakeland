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

export type ConnectionMode = "local" | "remote";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// Client-minted (electron/backend.js), not yoakeland's own serverId (ServerState.serverId below),
// which isn't known until server_identity's first reply. Keys `AppState.servers`.
export type ConnectionId = string;

/** Captured at connect time so a reconnect (ipc.ts's scheduleReconnect) can redial the exact
 * same target under a fresh ConnectionId (never the token itself, see KnownServer). */
export type ConnectParams =
  | { mode: "local"; socketPath: string; binPath: string }
  | { mode: "remote"; host: string; port: number; token: string; caPem?: string };

const RECENT_PROJECTS_KEY = "yoake.recentProjects";
const CHAT_HISTORY_KEY = "yoake.chatHistory";
const LAST_USED_PROVIDER_KEY = "yoake.lastUsedProvider";
const LAST_USED_MODEL_KEY = "yoake.lastUsedModel";
const LAST_USED_MODE_KEY = "yoake.lastUsedMode";

// Event types whose handleEvent case reads the resolved top-level `sessionId`; an envelope of
// one of these with neither `sessionId` nor a current session is dropped, not processed against "".
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

// Catches a path handler passed straight to `onclick`: it receives the DOM event instead of
// its string argument, and `String(event)` stringifies to this.
function looksLikePath(p: unknown): p is string {
  return typeof p === "string" && !/^\[object \w+\]$/.test(p);
}

/** A pre-upgrade install may have "ask"/"auto" persisted here; treated as invalid rather than
 * migrated, since ensureSession's "read_write" fallback is a cosmetic default, not data loss. */
function isChatMode(m: unknown): m is ChatMode {
  return m === "read_only" || m === "read_write" || m === "autonomous" || m === "plan";
}

interface ChatHistory {
  messagesBySession: Record<string, ChatMessage[]>;
  projectBySession: Record<string, string>;
  sessionsByProject: Record<string, SessionSummary[]>;
}

const EMPTY_CHAT_HISTORY: ChatHistory = { messagesBySession: {}, projectBySession: {}, sessionsByProject: {} };

/** Every render path reads `message.text`/`toolCalls` unconditionally since `ChatMessage`
 * declares both required, but localStorage is a JSON blob that outlives whatever shape wrote
 * it, so an older/corrupted message can come back without one. Patch it here, the one entry
 * point for untrusted data, instead of defensive-checking every render site. */
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

// --- Per-server persistence, namespaced by yoakeland's stable serverId (§3.2 server_identity),
// not ConnectionId, which is fresh every connect and would orphan saved state on reconnect. ---

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

/** Runs once: migrates flat, pre-multi-server localStorage keys to the first serverId this
 * client ever sees, since a pre-upgrade install only ever talked to one server. */
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
    // best-effort, worst case this re-attempts on a later launch
  }
}

// --- Known servers: everything needed to reconnect on startup (ipc.ts's autoConnect) except
// a remote's token, which lives in the backend's owner-only credentials file. ---

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

/** Read by the server lists in CommandPalette.svelte and SettingsPanel.svelte;
 * everything else about known servers stays internal to this module. */
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

/** Drops one entry from the remembered-servers list: the other half of upsertKnownServer. */
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

/** Stable key for a (provider, model) pair, used as a Svelte `#each` key. */
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

// Appearance/profile preferences: entirely per-device, client-only. Custom themes are just
// `accent` overridden at runtime; derived colors use CSS color-mix() (app.css).
export interface AppSettings {
  /** "system" follows the OS's prefers-color-scheme, re-applied live. */
  theme: "dark" | "light" | "system";
  accent: string;
  /** Root font size in px; the UI presents it as an interface scale (14px = 100%). */
  uiFontSize: number;
  codeFontSize: number;
  uiFontFamily: string;
  codeFontFamily: string;
  codeWrapLines: boolean;
  /** Code block syntax colors: same choice as the terminal's. See highlight.ts. */
  codeUseAppTheme: boolean;
  codeColorTheme: string;
  animationSpeed: number;
  /** "floating": inset rounded card. "flat": fills its space edge to edge, see [data-main] in app.css. */
  mainArea: "floating" | "flat";
  profileName: string;
  /** Emoji glyph or uploaded 96x96 photo data URL (avatar.ts); one identity shared across every server. */
  profileAvatar: string;
  wallpaper: string;
  /** Shader treatment applied to the new-chat wallpaper, see wallpaperGL.ts. */
  wallpaperStyle: "dither" | "scanlines" | "ascii" | "dotmatrix" | "gameboy";
  /** "opaque": plain panel fill. "frosted": floating surfaces (composer, popups, dialogs, window
   * chrome) go translucent over a blur; pure CSS via `data-surface` (app.css). */
  surface: "opaque" | "frosted";
  /** Window controls and the drag strip. */
  windowChrome: boolean;
  /** Keep the accent in sync with the wallpaper, re-derived whenever it changes. */
  accentFromWallpaper: boolean;
  /** Sessions untouched this many days show as archived in the sidebar without the server-side flag set. */
  autoArchiveDays: number;
  /** Trusted CA cert (PEM) per "host:port", keyed by address since it must be looked up before a
   * connection succeeds (no serverId yet). See trustedCaByServer for the identity-keyed counterpart. */
  trustedCaByHostPort: Record<string, string>;
  /** Same pairing re-keyed by serverId once known: authoritative for trust once a server's identity
   * is known, since its address can change while its identity doesn't. */
  trustedCaByServer: Record<string, string>;
  /** true (default): terminal colors track the app's accent/mode. false: use a TERMINAL_THEME_PRESETS id. */
  terminalUseAppTheme: boolean;
  /** Preset id from TERMINAL_THEME_PRESETS, only consulted when terminalUseAppTheme is false. */
  terminalColorTheme: string;
  /** xterm.js's smoothScrollDuration: 0 is instant; TerminalView.svelte maps true to a fixed duration. */
  terminalSmoothScroll: boolean;
  /** Padding inside the terminal pane, split horizontal/vertical since it was already asymmetric. */
  terminalMarginX: number;
  terminalMarginY: number;
  /** Which provider the status bar's usage widget shows collapsed, as "<serverId>:<kind>". "" = most-used. */
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
    // Older settings may have neither field as an object; guard against `map[key] = ...` throwing on undefined.
    if (!loaded.trustedCaByHostPort) loaded.trustedCaByHostPort = {};
    if (!loaded.trustedCaByServer) loaded.trustedCaByServer = {};
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Everything scoped to one connection: one server, whichever projects and sessions live on it.
 * `AppState.servers` holds one of these per live connection. Reaches through `this.app` for
 * the handful of things that are genuinely global rather than per-server. */
export class ServerState {
  // Not readonly: ipc.ts's redial() re-keys this same instance into app.servers under a fresh
  // id on reconnect, preserving in-memory state instead of starting a fresh ServerState.
  connectionId: ConnectionId;
  private readonly app: AppState;
  connectParams: ConnectParams;

  /** Null until server_identity's first reply lands on this connection. */
  serverId = $state<string | null>(null);
  connectionMode: ConnectionMode;
  connectionStatus = $state<ConnectionStatus>("connected");
  connectionError = $state<string | null>(null);

  // Not UI-bound, so a plain field: whether the *next* project_opened response should switch
  // currentProjectPath. A client-side decision per open_project call; defaults true.
  nextProjectOpenSwitches = true;

  sandboxTierByProject = $state<Record<string, SandboxTier>>({});
  snapshotsByProject = $state<Record<string, SnapshotInfo[]>>({});
  showSnapshots = $state(false);
  // Set on snapshot_restored (§3.2) so SnapshotDialog can confirm the restore completed instead of closing optimistically.
  lastSnapshotRestored = $state<{ snapshotId: string; at: number } | null>(null);

  // Replayed by list_notifications on connect, then kept live by pushes.
  notifications = $state<ServerNotification[]>([]);
  unseenNotifications = $state(0);
  // Last status snapshot from the heartbeat (§2a), for the status bar.
  serverStatus = $state<ServerStatus | null>(null);

  // Peer registry & server identity (§2a/§3.2): pushed live, never polled.
  peers = $state<PeerInfo[]>([]);
  /** Our own peerId on this server (peer_list's `you`; null on older servers). */
  selfPeerId = $state<string | null>(null);
  serverIdentity = $state<string | null>(null);
  /** What the UI calls this server everywhere (lists, badges, avatars). */
  get label(): string {
    return this.serverIdentity ?? (this.connectionMode === "local" ? "Local" : "Remote");
  }
  /** A project's display name: qualified "server/project" for a remote,
   * since the sidebar and palette list every server's projects together. */
  projectLabel(path: string): string {
    const name = this.projectName(path);
    return this.connectionMode === "local" ? name : `${this.label}/${name}`;
  }
  /** Just the project's own name (a local rename, else its folder name). */
  projectName(path: string): string {
    return this.projectLabels[path] ?? path.split(/[/\\]/).filter(Boolean).pop() ?? path;
  }
  // Last-known state of the optional TCP listener; no "get current state" event exists (§3.2).
  remoteAccessEnabled = $state<boolean | null>(null);

  // Same push-only pattern as remoteAccessEnabled.
  autoGenerateTitleEnabled = $state<boolean | null>(null);
  // `justRegisteredToken` holds the one-time raw token so Settings can show a "copy this now" reveal.
  tokens = $state<TokenInfo[]>([]);
  justRegisteredToken = $state<{ name: string; token: string; caPem?: string } | null>(null);

  // Set while a session's transcript is being refetched; the chat view grays out and blocks
  // input until session_history lands. Cleared wholesale on disconnect too.
  syncingSessions = $state<Record<string, boolean>>({});

  // `recentProjects` is the project switcher/picker list, a capped (20-entry) local cache
  // reconciled against the server's persisted `projects.json` (§4b) on every `project_list`,
  // painting instantly before that round-trip lands. Both loaded lazily once serverId is known.
  projects = $state<string[]>([]);
  recentProjects = $state<string[]>([]);
  currentProjectPath = $state<string | null>(null);

  sessionsByProject = $state<Record<string, SessionSummary[]>>({});
  // A re-fetch never blanks the list; the sidebar just dims what it has until fresh data lands.
  refreshingProjects = $state<Record<string, boolean>>({});
  projectBySession = $state<Record<string, string>>({});
  filesByProject = $state<Record<string, string[]>>({});

  currentSessionId = $state<string | null>(null);
  /** The one chat shown in the right sidebar, if any. Independent of `currentSessionId`. */
  sidebarSessionId = $state<string | null>(null);
  // Each chat's own terminal drawer, independent of every other chat's. Not persisted.
  terminalOpenBySession = $state<Record<string, boolean>>({});
  // `terminalsBySession` is tab order (client-side only, drag-reorderable), `terminalById` the
  // metadata each tab chip renders off. The pty bytes never live here, see terminalBus.ts.
  terminalsBySession = $state<Record<string, string[]>>({});
  terminalById = $state<Record<string, TerminalTab>>({});
  // Set once terminal_list has answered for a session, so opening the drawer right after
  // opening a chat doesn't spawn a redundant tab on top of ones it already had.
  terminalsListedBySession = $state<Record<string, boolean>>({});
  activeTerminalBySession = $state<Record<string, string | undefined>>({});
  // Split view: `terminalSplitBySession` is the on/off toggle, `splitTerminalBySession` which
  // tab fills the second pane; setActiveTerminalTab/setSplitTerminalTab swap rather than duplicate.
  terminalSplitBySession = $state<Record<string, boolean>>({});
  splitTerminalBySession = $state<Record<string, string | undefined>>({});
  // A single chat's own auxiliary view onto itself (plan, file previews, diffs, snapshots) --
  // NOT `sidebarSessionId`, which is a second linked chat. Also not persisted.
  chatSidebarOpenBySession = $state<Record<string, boolean>>({});
  messagesBySession = $state<Record<string, ChatMessage[]>>({});
  activeTurnBySession = $state<Record<string, string | undefined>>({});
  takenOverSessions = $state<Record<string, boolean>>({});
  // Cleared the moment its session is opened, so "finished" means "done, and you haven't looked yet."
  finishedSessions = $state<Record<string, boolean>>({});

  providers = $state<ProviderInfo[]>([]);
  cliAvailability = $state<Partial<Record<CliKind, boolean>>>({});
  providerBySession = $state<Record<string, string | undefined>>({});
  modelBySession = $state<Record<string, string | undefined>>({});
  // Set on a "no_provider" turn (provider became unavailable meanwhile): blocks ModelPicker's
  // auto-adopt-lastUsedProvider convenience from re-selecting the same broken one.
  providerBlockedBySession = $state<Record<string, boolean>>({});
  // Text to restore into the composer: a message unsent by a no_provider rejection, or (via
  // ipc.startEditingMessage) a message's old content while being edited.
  restoredDraftBySession = $state<Record<string, string>>({});
  // Set by ipc.startEditingMessage; PromptInput's submit() calls editMessage instead of sendPrompt while set.
  editingMessageId = $state<Record<string, string | undefined>>({});
  // model_options_set only echoes what changed: a left-unchanged field comes back zero/empty,
  // so the handler merges in only non-empty fields rather than overwriting wholesale.
  modelOptionsBySession = $state<Record<string, ModelOptions>>({});
  // Fetched lazily per provider rather than up front: never hardcode a model list.
  modelsByProvider = $state<Record<string, ModelInfo[]>>({});
  // Whatever provider/model/mode last got confirmed on ANY session on this server; new sessions
  // default to this instead of landing on "Provider...". Per-server since names are registry-scoped.
  lastUsedProvider = $state<string | null>(null);
  lastUsedModel = $state<string | null>(null);
  lastUsedMode = $state<ChatMode | null>(null);
  modeBySession = $state<Record<string, ChatMode>>({});
  webToolsEnabledByProject = $state<Record<string, boolean>>({});
  // write_plan's output (§4c), keyed by session so a re-write lands in place rather than stacking.
  planBySession = $state<Record<string, { path: string; content: string; updatedAt: number }>>({});
  openPlanSessionId = $state<string | null>(null);

  // Every unanswered ask across all sessions, replaced wholesale by each pending_asks snapshot
  // (§3.2); live permission_request/ask_user_question_requested events only append for instant feedback.
  pendingAsks = $state<PendingAsk[]>([]);
  // A project that never gets a git_status isn't a git repo (or the server has no git).
  gitStatusByProject = $state<Record<string, GitStatus>>({});

  // --- Sidebar-only local state, persisted per server (see saveSidebarPrefs).
  pinnedSessions = $state<string[]>([]);
  collapsedProjects = $state<Record<string, boolean>>({});
  // Manual drag order; projects not in it sort by most recent activity.
  projectOrder = $state<string[]>([]);
  // Local display names, never sent to the server.
  projectLabels = $state<Record<string, string>>({});
  // The session's server `updatedAt` last seen here; server timestamps on both sides, so client clock skew can't matter.
  lastViewedBySession = $state<Record<string, string>>({});
  // Unsent composer text per chat (memory only): PromptInput saves/restores it across chat switches.
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
      // corrupt prefs, start fresh
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

  /** Records `updatedAt` as seen: called for the open chat, and to seed
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

  // --- Chat history navigation. Pushed by ipc.ts's openChatSession, the one funnel every
  // user-initiated session switch goes through; automatic opens deliberately don't push.
  navBack = $state<string[]>([]);
  navForward = $state<string[]>([]);

  constructor(connectionId: ConnectionId, app: AppState, connectParams: ConnectParams) {
    this.connectionId = connectionId;
    this.app = app;
    this.connectParams = connectParams;
    this.connectionMode = connectParams.mode;
  }

  /** Every known session, keyed by id, regardless of project, since splits can pair sessions from
   * different sidebar sections. `$derived` so it's computed once per change, not per sidebar row. */
  sessionById: Map<string, SessionSummary> = $derived.by(() => {
    const m = new Map<string, SessionSummary>();
    for (const list of Object.values(this.sessionsByProject)) {
      for (const s of list) m.set(s.sessionId, s);
    }
    return m;
  });

  /** The partner half of any pairing whose anchor also exists, hidden from its own sidebar
   * spot since it renders stacked under its anchor instead (see splitPartnerFor). Driven by
   * the server-persisted `linkedSessionId` (§3.1), not separate client-only state. */
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
   * draft (nothing to persist the pairing on) and not archived, same
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

  /** Chats otherwise live only in memory and vanish on restart even though the server-side
   * session survives; mirrors them to localStorage. No-ops until serverId is known. */
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

  /** Drops entries whose session is gone (deleted while it sat in the stack) so a step can't
   * land on a phantom chat. */
  private pruneNav(stack: string[]): string[] {
    return stack.filter((id) => id in this.messagesBySession || id in this.projectBySession);
  }

  /** Moves one step back and returns the session to open, or null at the end. Only the stack
   * is touched here; opening/refetching is the caller's (ipc.ts's navigateSessionHistory). */
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

  /** Optimistically flips one model's `isFavorite`; `favorite_models_set` corrects it if the server disagrees. */
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

  /** Persists the last mode picked, so the next new chat starts there instead of defaulting to Read-Write. */
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

  /** Local half only; the caller also sends remove_project (ipc.removeProject). Also drops
   * its sessions, otherwise they'd resurrect the project server-side on their next request. */
  forgetProject(path: string) {
    this.projects = this.projects.filter((p) => p !== path);
    this.recentProjects = this.recentProjects.filter((p) => p !== path);
    if (this.serverId) saveServerRecentProjects(this.serverId, this.recentProjects);
    // Falls back to the next project in the list; null only when this really was the last one.
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

  /** Reopens whichever session last had a message, so a restart drops the user back where they
   * left off. Falls back to the most recently used project when there's no chat history at all. */
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

  /** The chat view always has a session to render, even before a project is picked; the
   * composer disables sending until one's bound (PromptInput's `projectPath` check). */
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

  /** Opens `sessionId` as the main chat. If it has a persisted `linkedSessionId` (§3.1), its
   * partner reopens in the side panel; a plain session clears the side panel. */
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

  /** Shows `sessionId` in the right sidebar; pure UI state. Persisting the pairing itself is
   * ipc.ts's `openInSidePanel`, which this module can't import (circular dependency). */
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

  /** Registers a brand-new tab optimistically, before terminal_snapshot confirms it, so the
   * chip renders instantly. Only for "+ New Tab"; a discovered tab is registered by terminal_list's handler. */
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

  /** Same swap-not-duplicate rule as setActiveTerminalTab, for the split pane. */
  setSplitTerminalTab(sessionId: string, terminalId: string) {
    if (this.activeTerminalBySession[sessionId] === terminalId) {
      this.activeTerminalBySession[sessionId] = this.splitTerminalBySession[sessionId];
    }
    this.splitTerminalBySession[sessionId] = terminalId;
  }

  /** Turning it on defaults the second pane to whichever other tab is open; turning it off
   * just hides that pane, it doesn't close the tab in it. */
  toggleTerminalSplit(sessionId: string) {
    const on = !this.terminalSplitBySession[sessionId];
    this.terminalSplitBySession[sessionId] = on;
    if (on && !this.splitTerminalBySession[sessionId]) {
      const tabs = this.terminalsBySession[sessionId] ?? [];
      const other = tabs.find((id) => id !== this.activeTerminalBySession[sessionId]);
      this.splitTerminalBySession[sessionId] = other ?? this.activeTerminalBySession[sessionId];
    }
  }

  /** Purely local: the wire protocol has no ordering concept for tabs. Moves `fromId` to sit where `toId` is. */
  reorderTerminalTabs(sessionId: string, fromId: string, toId: string) {
    const tabs = [...(this.terminalsBySession[sessionId] ?? [])];
    const from = tabs.indexOf(fromId);
    const to = tabs.indexOf(toId);
    if (from === -1 || to === -1 || from === to) return;
    tabs.splice(to, 0, ...tabs.splice(from, 1));
    this.terminalsBySession[sessionId] = tabs;
  }

  /** Drops a tab from local bookkeeping; only from "terminal_closed" (no optimistic removal,
   * closing isn't reversible). Picks a replacement for whichever pane(s) were showing it. */
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

  /** Repaints a session's transcript from `session_history` (§3.2), the server's persisted
   * truth: `messagesBySession` is otherwise just a cache of turns this client has streamed,
   * so this is what shows history for a session opened cold. Skipped mid-stream so a reconnect
   * response can't clobber live-streaming state. */
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
      // Server's own createdAt (§3.2) is authoritative; fall back to a synthetic timestamp for older messages.
      const stored = m.createdAt ? Date.parse(m.createdAt) : NaN;
      const createdAt = Number.isFinite(stored) ? stored : base - (messages.length - turnIndex) * 1000;
      if (m.role === "user") {
        // No stored author means it predates the server persisting one, or came from a client
        // that doesn't send it; fall back to this client's own profile to match the live bubble.
        const storedAuthor = m.author;
        out.push({
          // Falls back to a synthetic key for a message persisted before ids existed (§3.2:
          // "treat absence as not addressable"), rather than something edit/retry could target.
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
        // A turn with tool calls makes one round-trip per assistant entry here, but the live
        // stream merges them into one message keyed by turnId. There's no stored turnId to
        // group by on reload, so consecutive assistant entries between two user messages are assumed one turn.
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
        // "Retry" on a merged bubble targets its *last* round-trip's id, matching alternateIds.
        cur.id = m.id || cur.id;
        cur.alternateIds = m.alternateIds ?? cur.alternateIds;

        // The backend has been observed persisting the same toolCallId twice; dedupe here too,
        // or a duplicate key crashes the keyed {#each}. Text/reasoning append before tool calls
        // so their offsets land after, matching the live render order.
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
        // Provider/model/usage are per round-trip; the merged bubble's footer shows totals.
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

  /** A session with no server-confirmed messages yet, bound to `projectPath` once its first prompt goes out (§4b). */
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

  /** Every map keyed by sessionId, shared by discardUnsentSession and session_deleted: "this
   * session no longer exists, forget everything about it." A UUID is never reused, so leaving
   * these behind is unbounded growth, not just a display bug. */
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
    // delete_session kills every terminal the chat owned too (SPEC.md §3.1);
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

  /** It never reached the server, so there's nothing to ask it to delete,
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

    // Placeholder assistant message streaming deltas fill in. Provider/model stamped now
    // (turn_completed carries neither, §3.2) so it stays correct even if selection changes later.
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

  /** Shared setup for edit_message/retry_message (§3.1/§4d): both resume history from a branch
   * point. `fromIndex` onward is cut locally; the server archives it (switch_branch brings it back). */
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

  /** SPEC.md §3.1 edit_message: replaces `messageId`'s content in place and
   * discards everything generated after it, then starts a fresh turn. */
  beginEdit(sessionId: string, turnId: string, messageId: string, content: string) {
    delete this.editingMessageId[sessionId];
    const list = this.messagesBySession[sessionId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      this.app.log(`error: can't edit message ${messageId} — not found in this session's local history`);
      return;
    }
    // turnId (not the old message's own) so turn_completed's reconciliation can find this
    // bubble and stamp in the real id the server mints, same as a brand-new user message.
    this.beginBranchTurn(sessionId, turnId, idx, { ...list[idx], text: content, turnId });
  }

  /** SPEC.md §3.1 retry_message: discards `messageId` (an assistant message,
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

  /** Runs once, the first time serverId becomes known: loads this server's namespaced
   * localStorage, running the legacy-flat-key migration first if needed. */
  private hydrateFromServerId(serverId: string) {
    migrateLegacyStateIfNeeded(serverId);

    // server_identity races connect: a session/message can already be in memory before this
    // runs. Merge disk-loaded state UNDER what's resident, or that first chat gets wiped.
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

    // Carry over a CA trusted by address (trustedCaByHostPort), or a client that already
    // paired this server would appear to have forgotten it once serverId-based trust takes over.
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
    // Session-agnostic event types (peer_list, provider_*, project_list) are fine with no
    // resolvable session; only bail for types that actually need one.
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
          // The backend has been observed sending this event twice for the same toolCallId;
          // without a dedupe the duplicate crashes the keyed {#each} and freezes the message list.
          const existing = msg.toolCalls.find((t) => t.toolCallId === env.toolCallId);
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
          // Reachable if the provider became unavailable between being picked and the turn
          // running. "Unsend" it: pull the prompt back and clear the selection so the composer blocks again.
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
        // Swap the optimistic placeholder ids for the server's real ones as soon as known, so
        // retry/edit work immediately without waiting on a reopen (v2.13 userMessageId/messageId).
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
        // Always remember it (also where a raw-picked path gets upgraded to the server's
        // canonical form, see ipc.selectProject), but only switch if this open was meant to.
        this.rememberProject(data.path);
        if (this.nextProjectOpenSwitches) this.currentProjectPath = data.path;
        this.nextProjectOpenSwitches = true;
        if (data.sandboxTier) this.sandboxTierByProject[data.path] = data.sandboxTier;
        break;
      }
      case "project_list": {
        // Server-authoritative (§4b), most-recently-opened first. rememberProject unshifts,
        // so walk in reverse to match server order.
        const data = env.data as { paths: string[] };
        const known = new Set(data.paths ?? []);
        for (const p of [...(data.paths ?? [])].reverse()) this.rememberProject(p);
        // Can arrive unprompted (v2.13, pushed to every connection); prune anything local
        // that's no longer in the authoritative list.
        for (const p of this.recentProjects.filter((p) => !known.has(p))) this.forgetProject(p);
        break;
      }
      case "project_removed": {
        // Also pushed live to every other connection when removal happens elsewhere (v2.13, §3.1).
        const data = env.data as { path: string };
        this.forgetProject(data.path);
        break;
      }
      case "session_list": {
        const data = env.data as { projectPath?: string; sessions: SessionSummary[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) {
          const listed = new Set((data.sessions ?? []).map((x) => x.sessionId));
          // A never-prompted chat doesn't exist server-side, so it's never listed. Keep the
          // one open locally; prune every other unlisted, empty one (ghosts older builds left).
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
        // Only apply if it's still this connection's browse in flight, so a late response
        // from an abandoned browse can't clobber a newer one.
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
        // claude/codex booleans are the pre-v2.15 shape, kept as a fallback for older servers.
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
        // Server is the source of truth for mode (§4c): adopt it, don't replay a cached value.
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
        // Some errors arrive instead of, not alongside, turn_completed: without this the
        // composer would stay stuck on "Stop" forever.
        if (env.turnId && this.activeTurnBySession[sessionId] === env.turnId) {
          const msg = this.findAssistantMessage(sessionId, env.turnId);
          if (msg) {
            msg.streaming = false;
            // A cli_* agent that isn't logged in fails with an error (§6b): say what to do instead of just echoing it.
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
      // Terminal events (§3.2): none but terminal_list carry `sessionId`, so they route by
      // `terminalId` against `terminalById` instead.
      case "terminal_list": {
        const data = env.data as { sessionId: string; terminals: TerminalSummary[] };
        if (data.sessionId) this.applyTerminalList(data.sessionId, data.terminals ?? []);
        break;
      }
      // Every terminal on the server at once (§3.2), so terminals from another device
      // or a chat never opened here are known too.
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
        // A snapshot for an id we never registered has no session to attach to; drop it rather than guess.
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
  /** One entry per live connection. `active` is what every component renders. */
  servers = $state<Record<ConnectionId, ServerState>>({});
  activeConnectionId = $state<ConnectionId | null>(null);

  get active(): ServerState | null {
    return this.activeConnectionId ? (this.servers[this.activeConnectionId] ?? null) : null;
  }

  // Tracks a connect attempt before any ServerState exists (no ConnectionId until
  // connect_tcp/connect_unix succeeds). Reset to "disconnected" once a real ServerState exists.
  private pendingConnectStatus = $state<ConnectionStatus>("disconnected");
  private pendingConnectMode = $state<ConnectionMode>("local");
  private pendingConnectError = $state<string | null>(null);

  setPendingConnect(status: ConnectionStatus, mode?: ConnectionMode, error: string | null = null) {
    this.pendingConnectStatus = status;
    if (mode) this.pendingConnectMode = mode;
    this.pendingConnectError = error;
  }

  /** Reflects the active server's own connection state once one exists, or the in-flight attempt before that. */
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

  /** Opens straight to Settings > Providers (e.g. "no provider" prompts). */
  openProviderSettings() {
    this.showSettings = true;
    this.settingsTab = "providers";
  }

  /** The palette's "Add server..." lands here, optionally prefilled to re-pair (connectServerRow). */
  addServerRequest = $state<{ host?: string; port?: number } | null>(null);
  openAddServer(host?: string, port?: number) {
    this.addServerRequest = { host, port };
    this.settingsTab = "servers";
    this.showSettings = true;
  }

  // Both sidebars slide off-screen when collapsed rather than shrinking; their shared toggle
  // button is pinned top-left of the window, outside either sidebar.
  sidebarCollapsed = $state(typeof localStorage !== "undefined" ? loadBool(SIDEBAR_COLLAPSED_KEY) : false);
  rightSidebarCollapsed = $state(
    typeof localStorage !== "undefined" ? loadBool(RIGHT_SIDEBAR_COLLAPSED_KEY) : false,
  );
  sidebarWidth = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 250 : 250,
  );
  // A fraction (0-0.5), not a pixel value: RightSidebar.svelte turns it into a live width via
  // CSS `clamp()`, staying proportional across resizes with no JS syncing.
  rightSidebarRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(RIGHT_SIDEBAR_RATIO_KEY)) || 0.22 : 0.22,
  );
  // Same idea as rightSidebarRatio, for the two per-chat embedded panels: one shared size
  // across every chat, not per-session. Both capped at 0.5, see each component's resize handle.
  terminalHeightRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(TERMINAL_HEIGHT_RATIO_KEY)) || 0.35 : 0.35,
  );
  chatSidebarWidthRatio = $state(
    typeof localStorage !== "undefined" ? Number(localStorage.getItem(CHAT_SIDEBAR_WIDTH_RATIO_KEY)) || 0.32 : 0.32,
  );

  // Live, unpersisted: true while the corresponding ratio is being dragged, by that panel's
  // own handle or the corner handle where sidebar and terminal meet; either lights up the same accent.
  rightSidebarResizing = $state(false);
  terminalResizing = $state(false);

  settings = $state<AppSettings>(typeof localStorage !== "undefined" ? loadSettings() : { ...DEFAULT_SETTINGS });

  // Only one directory-browse flow (§3.1) is ever open at once, so these stay global rather
  // than per-server; `browsingConnectionId` guards against a late response from an abandoned browse.
  directoryListing = $state<{ path: string; entries: DirectoryEntry[]; error?: string } | null>(null);
  browsingConnectionId = $state<ConnectionId | null>(null);

  // Each openPalette() is a fresh request: opens on that page, or pushes it if already open.
  paletteOpen = $state(false);
  paletteRequest = $state<{ page: "root" | "projects" | "browse" | "servers"; at: number }>({ page: "root", at: 0 });
  openPalette(page: "root" | "projects" | "browse" | "servers" = "root") {
    this.paletteRequest = { page, at: performance.now() };
    this.paletteOpen = true;
  }

  // ModelPicker instances watch this to open on request; names which chat's picker.
  modelPickerRequest = $state<{ sessionId: string; at: number } | null>(null);

  notificationsOpen = $state(false);
  // Spend across every server today, tallied from turn_completed events. Resets at local
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
  /** A client-side toast with an action button (e.g. "Archived, Undo"). */
  toastAction(connectionId: ConnectionId, title: string, action: { label: string; run: () => void }) {
    const id = `local-${Date.now()}`;
    this.toasts = [
      ...this.toasts.slice(-2),
      { id, level: "info", kind: "local", title, createdAt: new Date().toISOString(), connectionId, action },
    ];
    setTimeout(() => this.dropToast(id), 6_000);
  }

  // Ticks periodically so relative times ("3m") re-render instead of freezing.
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

  /** Sets (rather than flips) collapsed state; drag-to-collapse tracks the pointer live via this. */
  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    saveBool(SIDEBAR_COLLAPSED_KEY, collapsed);
  }

  /** Same reason setSidebarCollapsed exists, for the right sidebar's drag-to-collapse. */
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

  /** Persists a new proportion (0-0.5); the live pixel width is entirely CSS's job (`clamp()`). */
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

  /** "system" resolved against the OS's live preference; "dark"/"light" pass straight through. */
  get resolvedTheme(): "dark" | "light" {
    if (this.settings.theme !== "system") return this.settings.theme;
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  /** Persists `settings` and pushes it onto the document as CSS custom
   * properties / a `data-theme` attribute: call after any mutation made
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
    // Code blocks borrow the terminal palette's ANSI slots for token colors.
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
    // The frosted/opaque switch is entirely CSS via the --float-* tokens hanging off this attribute.
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

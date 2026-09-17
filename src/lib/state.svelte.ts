import type {
  ChatMessage,
  ChatMode,
  DirectoryEntry,
  Envelope,
  PeerInfo,
  ModelInfo,
  ModelOptions,
  PermissionRequestData,
  ProviderInfo,
  SandboxTier,
  SessionSummary,
  SnapshotInfo,
  TokenInfo,
  ToolCallEntry,
  ToolCallRequestedData,
  ToolResultData,
  TurnCompletedData,
} from "./types";
import { deriveTheme } from "./theme";

// Transport is Unix socket (local) or TCP+token (remote) per §2a — this only
// tracks which one we're on, for display purposes.
export type ConnectionMode = "local" | "remote";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

const RECENT_PROJECTS_KEY = "yoake.recentProjects";
const CHAT_HISTORY_KEY = "yoake.chatHistory";

// Event types whose handleEvent case reads the resolved top-level `sessionId`
// (as opposed to a project-scoped or self-contained payload) — an envelope
// of one of these with neither `sessionId` nor a current session is dropped
// rather than processed against a bogus "" session.
const SESSION_SCOPED_EVENTS = new Set([
  "model_delta",
  "tool_call_requested",
  "permission_request",
  "tool_result",
  "turn_completed",
  "session_taken_over",
]);

function loadRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentProjects(paths: string[]) {
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(paths.slice(0, 20)));
  } catch {
    // best-effort only
  }
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
  return { ...history, messagesBySession };
}

function loadChatHistory(): ChatHistory {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return { ...EMPTY_CHAT_HISTORY };
    return sanitizeChatHistory({ ...EMPTY_CHAT_HISTORY, ...(JSON.parse(raw) as ChatHistory) });
  } catch {
    return { ...EMPTY_CHAT_HISTORY };
  }
}

const SIDEBAR_COLLAPSED_KEY = "yoake.sidebarCollapsed";
const RIGHT_SIDEBAR_COLLAPSED_KEY = "yoake.rightSidebarCollapsed";
const SIDEBAR_WIDTH_KEY = "yoake.sidebarWidth";
const RIGHT_SIDEBAR_RATIO_KEY = "yoake.rightSidebarRatio";
const TERMINAL_OPEN_KEY = "yoake.terminalOpen";
const SETTINGS_KEY = "yoake.settings";
const LAST_USED_PROVIDER_KEY = "yoake.lastUsedProvider";
const LAST_USED_MODEL_KEY = "yoake.lastUsedModel";
const LAST_USED_MODE_KEY = "yoake.lastUsedMode";

/** Stable key for a (provider, model) pair — used as a Svelte `#each` key in
 * ModelPicker.svelte. Favorites themselves are server-persisted per provider
 * (SPEC.md §6b `set_favorite_models`), not tracked client-side any more. */
export function modelKey(providerName: string, model: string): string {
  return `${providerName}::${model}`;
}

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const RIGHT_SIDEBAR_MIN_WIDTH = 220;

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

// Appearance/profile preferences — entirely per-device, client-only (no
// protocol involvement). "Custom color themes" is just `accent` overridden at
// runtime; everything derived from it uses CSS color-mix() (see app.css) so
// it stays correct without recomputing per theme.
export interface AppSettings {
  /** "system" follows the OS's prefers-color-scheme, re-applied live when it
   * changes (listener registered once in +page.svelte). */
  theme: "dark" | "light" | "system";
  accent: string;
  uiFontSize: number;
  codeFontSize: number;
  uiFontFamily: string;
  codeFontFamily: string;
  codeWrapLines: boolean;
  animationSpeed: number;
  profileName: string;
  /** Either an emoji glyph or an uploaded 96x96 photo as a data URL — see
   * avatar.ts. Sent to the server when identifying (§2a `auth`). */
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
  /** Keep the accent in sync with the wallpaper instead of picking one by
   * hand — re-derived whenever the wallpaper changes. */
  accentFromWallpaper: boolean;
  /** Sessions untouched this many days are treated as archived in the
   * sidebar's Archive tab even without the `archived` flag set — a display
   * categorization only, never mutates the server-side flag on its own. */
  autoArchiveDays: number;
  /** One trusted CA certificate (PEM) per "host:port" a remote server was
   * paired with (§2a) — yoakeland's TCP listener is TLS-only, either via its
   * own auto-managed CA (the normal case, paired by importing its ca.pem
   * once) or an operator-supplied real certificate (left unpaired here, and
   * verified against the OS trust store instead). */
  trustedCaByServer: Record<string, string>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accent: "#7c9bff",
  uiFontSize: 14,
  codeFontSize: 12.5,
  uiFontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  codeFontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  codeWrapLines: true,
  animationSpeed: 1,
  profileName: "",
  profileAvatar: "🐣",
  wallpaper: "",
  wallpaperStyle: "dither",
  surface: "opaque",
  accentFromWallpaper: false,
  autoArchiveDays: 14,
  trustedCaByServer: {},
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

class AppState {
  connectionStatus = $state<ConnectionStatus>("disconnected");
  connectionMode = $state<ConnectionMode>("local");
  connectionError = $state<string | null>(null);
  // The connect flow is a dismissible overlay, not a gate — the UI underneath
  // is fully explorable without ever connecting. Starts closed: connecting
  // is automatic (see autoConnect in ipc.ts), and this only opens itself if
  // that fails with nowhere else to fall back to.
  showConnectModal = $state(false);
  showSettings = $state(false);
  settingsTab = $state("appearance");

  /** Providers live under Settings now, not a standalone modal — this is the
   * one place that opens straight to that tab (e.g. "no provider" prompts). */
  openProviderSettings() {
    this.showSettings = true;
    this.settingsTab = "providers";
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
  /** The one chat shown in the right sidebar, if any — set via the "open in
   * side panel" button on a session row (Sidebar.svelte / ProjectGroup.svelte),
   * cleared by closing it from the panel's own header. Independent of
   * `currentSessionId`. */
  sidebarSessionId = $state<string | null>(null);
  /** Bottom drawer, currently just a placeholder for an integrated terminal —
   * toggled from StatusBar. */
  terminalOpen = $state(
    typeof localStorage !== "undefined" ? loadBool(TERMINAL_OPEN_KEY) : false,
  );

  settings = $state<AppSettings>(typeof localStorage !== "undefined" ? loadSettings() : { ...DEFAULT_SETTINGS });

  sandboxTierByProject = $state<Record<string, SandboxTier>>({});
  snapshotsByProject = $state<Record<string, SnapshotInfo[]>>({});
  directoryListing = $state<{ path: string; entries: DirectoryEntry[] } | null>(null);
  showDirectoryBrowser = $state(false);
  showSnapshots = $state(false);
  // Set on snapshot_restored (§3.2) so SnapshotDialog can confirm the
  // in-flight restore actually completed instead of closing optimistically.
  lastSnapshotRestored = $state<{ snapshotId: string; at: number } | null>(null);

  // Peer registry & server identity (§2a/§3.2) — pushed live, never polled.
  peers = $state<PeerInfo[]>([]);
  serverIdentity = $state<string | null>(null);
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
  justRegisteredToken = $state<{ name: string; token: string } | null>(null);

  // Set while a session's transcript is being refetched from the server
  // (get_session_history, ipc.ts's openChatSession) — the chat view grays
  // out and blocks input for that session until session_history lands, so
  // stale cached content can't be edited/sent-to underneath an in-flight
  // resync. Cleared on session_history, and wholesale on disconnect since no
  // response is coming for any of them any more.
  syncingSessions = $state<Record<string, boolean>>({});

  setSessionSyncing(sessionId: string, syncing: boolean) {
    if (syncing) this.syncingSessions[sessionId] = true;
    else delete this.syncingSessions[sessionId];
    this.syncingSessions = { ...this.syncingSessions };
  }

  clearAllSessionSyncing() {
    this.syncingSessions = {};
  }

  // Projects (§4b): a server process can have many open at once. `projects`
  // is what the server has told us it's opened this run (`project_list`);
  // `recentProjects` is *our own* memory of folders worth offering again —
  // the spec is explicit that the server has no persisted memory of this,
  // the client is the source of truth for "recently opened folders."
  projects = $state<string[]>([]);
  recentProjects = $state<string[]>(typeof localStorage !== "undefined" ? loadRecentProjects() : []);
  currentProjectPath = $state<string | null>(null);

  sessionsByProject = $state<Record<string, SessionSummary[]>>(
    typeof localStorage !== "undefined" ? loadChatHistory().sessionsByProject : {},
  );
  // Sessions are cached client-side (see messagesBySession/saveChatHistory), so
  // a re-fetch never needs to blank the list — the sidebar just dims whatever
  // it already has until the fresh session_list lands (see ProjectGroup.svelte).
  refreshingProjects = $state<Record<string, boolean>>({});
  projectBySession = $state<Record<string, string>>(
    typeof localStorage !== "undefined" ? loadChatHistory().projectBySession : {},
  );
  filesByProject = $state<Record<string, string[]>>({});

  currentSessionId = $state<string | null>(null);
  messagesBySession = $state<Record<string, ChatMessage[]>>(
    typeof localStorage !== "undefined" ? loadChatHistory().messagesBySession : {},
  );
  activeTurnBySession = $state<Record<string, string | undefined>>({});
  takenOverSessions = $state<Record<string, boolean>>({});
  // A turn that completed while its session wasn't the open one — cleared the
  // moment that session is opened, so the sidebar's "finished" state means
  // "done, and you haven't looked yet."
  finishedSessions = $state<Record<string, boolean>>({});

  providers = $state<ProviderInfo[]>([]);
  cliAvailability = $state<{ claude: boolean; codex: boolean }>({ claude: false, codex: false });
  providerBySession = $state<Record<string, string | undefined>>({});
  modelBySession = $state<Record<string, string | undefined>>({});
  // Set when a turn comes back with finishReason "no_provider" (the selected
  // provider became unavailable between being picked and the turn actually
  // running — removed by another peer, credential revoked, etc.) — blocks
  // ModelPicker's own "adopt lastUsedProvider automatically" convenience
  // from immediately re-selecting the same now-broken provider. Cleared the
  // moment the user (re)confirms a provider via provider_set.
  providerBlockedBySession = $state<Record<string, boolean>>({});
  // The prompt text of a message "unsent" by a no_provider rejection, for
  // PromptInput to restore into its composer — see the turn_completed case.
  restoredDraftBySession = $state<Record<string, string>>({});
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
  // Whatever provider/model last got confirmed active on *any* session — new
  // sessions default to this (see ModelPicker.svelte) instead of always
  // landing on "Provider…" and making the user reselect every chat.
  lastUsedProvider = $state<string | null>(
    typeof localStorage !== "undefined" ? localStorage.getItem(LAST_USED_PROVIDER_KEY) : null,
  );
  lastUsedModel = $state<string | null>(
    typeof localStorage !== "undefined" ? localStorage.getItem(LAST_USED_MODEL_KEY) : null,
  );
  modeBySession = $state<Record<string, ChatMode>>({});
  // Server-confirmed plan-mode state (§4c) — distinct from modeBySession,
  // which is optimistic UI state set the moment the user clicks "Plan".
  planModeBySession = $state<Record<string, boolean>>({});

  pendingPermission = $state<
    | (PermissionRequestData & { sessionId: string; turnId: string; toolCallId: string })
    | null
  >(null);

  logs = $state<string[]>([]);

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

  sessionStatus(sessionId: string): "working" | "action" | "finished" | "idle" {
    if (this.takenOverSessions[sessionId]) return "idle";
    if (this.pendingPermission?.sessionId === sessionId) return "action";
    if (this.activeTurnBySession[sessionId]) return "working";
    if (this.finishedSessions[sessionId]) return "finished";
    return "idle";
  }

  /** Chats otherwise live only in memory (§ messagesBySession) and vanish on
   * restart even though the server-side session survives — mirror them to
   * localStorage the same way recentProjects already is. */
  private saveChatHistory() {
    try {
      const history: ChatHistory = {
        messagesBySession: this.messagesBySession,
        projectBySession: this.projectBySession,
        sessionsByProject: this.sessionsByProject,
      };
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // best-effort only
    }
  }

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

  // --- Chat history navigation (the titlebar island's back/forward arrows).
  // Two plain stacks, pushed by ipc.ts's openChatSession — the one funnel every
  // *user-initiated* session switch goes through — so opening a chat from the
  // sidebar, a split row or the side panel all land in the same history, while
  // the automatic opens (restoreLastSession on startup, selectProject's
  // clearing of the current session) deliberately don't.
  navBack = $state<string[]>([]);
  navForward = $state<string[]>([]);

  get canGoBack(): boolean {
    return this.navBack.length > 0;
  }

  get canGoForward(): boolean {
    return this.navForward.length > 0;
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
    return stack.filter(
      (id) => id in this.messagesBySession || id in this.projectBySession,
    );
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

  // Bumped only by an explicit, manual open/close of the right sidebar — see
  // RightSidebar.svelte's widthAnimating effect. ipc.ts's openInSidePanel and
  // openSession's own split-partner auto-open also flip
  // `rightSidebarCollapsed` as a side effect of switching chats; those
  // should snap instantly, not ease, so they don't touch this.
  rightSidebarAnimateTick = $state(0);

  toggleRightSidebar() {
    this.rightSidebarCollapsed = !this.rightSidebarCollapsed;
    this.rightSidebarAnimateTick++;
    saveBool(RIGHT_SIDEBAR_COLLAPSED_KEY, this.rightSidebarCollapsed);
  }

  /** Sets (rather than flips) the right sidebar's collapsed state, persisting
   * it the same way the toggle does but without bumping
   * `rightSidebarAnimateTick` — RightSidebar.svelte's drag-to-collapse uses
   * this to track the pointer live, same reason Sidebar.svelte's
   * setSidebarCollapsed exists. */
  setRightSidebarCollapsed(collapsed: boolean) {
    this.rightSidebarCollapsed = collapsed;
    saveBool(RIGHT_SIDEBAR_COLLAPSED_KEY, collapsed);
  }

  /** Shows `sessionId` in the right sidebar, un-collapsing it if needed —
   * pure UI state. Creating/persisting the pairing itself is ipc.ts's
   * `openInSidePanel` (it needs to reach the server, §3.1 set_session_layout,
   * which this module can't import without a circular dependency on ipc.ts). */
  showInSidePanel(sessionId: string) {
    this.sidebarSessionId = sessionId;
    this.rightSidebarCollapsed = false;
  }

  closeSidePanel() {
    this.sidebarSessionId = null;
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

  toggleTerminal() {
    this.terminalOpen = !this.terminalOpen;
    saveBool(TERMINAL_OPEN_KEY, this.terminalOpen);
  }

  /** Persists `settings` and pushes it onto the document as CSS custom
   * properties / a `data-theme` attribute — call after any mutation made
   * through the Settings UI, and once at startup. */
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
    // The frosted/opaque switch is entirely CSS — the --float-* tokens hang off
    // this attribute, so nothing else here has to know about it.
    root.dataset.surface = this.settings.surface;
  }

  ensureSession(sessionId: string) {
    if (!this.messagesBySession[sessionId]) {
      this.messagesBySession[sessionId] = [];
    }
    if (!this.modeBySession[sessionId]) {
      const lastMode = typeof localStorage !== "undefined" ? localStorage.getItem(LAST_USED_MODE_KEY) : null;
      this.modeBySession[sessionId] =
        lastMode === "ask" || lastMode === "auto" || lastMode === "plan" ? lastMode : "auto";
    }
  }

  /** Persists the last mode a user picked, so the next new chat starts there
   * instead of always defaulting back to Auto (see ensureSession). */
  setLastUsedMode(mode: ChatMode) {
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_USED_MODE_KEY, mode);
  }

  rememberProject(path: string) {
    if (!this.projects.includes(path)) this.projects = [...this.projects, path];
    const withoutIt = this.recentProjects.filter((p) => p !== path);
    this.recentProjects = [path, ...withoutIt].slice(0, 20);
    saveRecentProjects(this.recentProjects);
  }

  /** Removes a saved path from the picker (Settings > Connections) — doesn't
   * touch anything server-side, this is purely "stop offering it locally." */
  forgetProject(path: string) {
    this.recentProjects = this.recentProjects.filter((p) => p !== path);
    saveRecentProjects(this.recentProjects);
    if (this.currentProjectPath === path) this.currentProjectPath = null;
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
    const partner = this.splitPartnerFor(sessionId);
    if (partner) {
      this.ensureSession(partner.sessionId);
      this.sidebarSessionId = partner.sessionId;
      this.rightSidebarCollapsed = false;
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
    messages: { role: "user" | "assistant" | "tool"; content: string; author?: string; authorAvatar?: string; reasoning?: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]; toolCallId?: string }[],
  ) {
    if (this.activeTurnBySession[sessionId]) return;
    const toolResults = new Map<string, string>();
    for (const m of messages) if (m.role === "tool" && m.toolCallId) toolResults.set(m.toolCallId, m.content);

    const base = Date.now();
    let turnIndex = 0;
    const out: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === "tool") continue;
      turnIndex++;
      const createdAt = base - (messages.length - turnIndex) * 1000;
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
          id: `${sessionId}-hist-${turnIndex}`,
          role: "user",
          text: m.content ?? "",
          toolCalls: [],
          streaming: false,
          createdAt,
          author: storedAuthor ?? (this.settings.profileName || undefined),
          authorAvatar: storedAuthor
            ? m.authorAvatar
            : this.settings.profileAvatar || undefined,
        });
      } else {
        const toolCalls: ToolCallEntry[] = (m.toolCalls ?? []).map((tc) => ({
          toolCallId: tc.id,
          name: tc.name,
          args: tc.args ?? {},
          status: "done",
          output: toolResults.get(tc.id) ?? "",
        }));
        out.push({
          id: `${sessionId}-hist-${turnIndex}`,
          role: "assistant",
          text: m.content ?? "",
          thinking: m.reasoning || undefined,
          toolCalls,
          streaming: false,
          createdAt,
        });
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
    delete this.modelOptionsBySession[sessionId];
    delete this.modeBySession[sessionId];
    delete this.planModeBySession[sessionId];
    delete this.syncingSessions[sessionId];
    if (this.currentSessionId === sessionId) this.currentSessionId = null;
    if (this.sidebarSessionId === sessionId) this.sidebarSessionId = null;
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

  addUserMessage(sessionId: string, turnId: string, text: string) {
    this.ensureSession(sessionId);
    const msg: ChatMessage = {
      id: turnId,
      role: "user",
      turnId,
      text,
      toolCalls: [],
      streaming: false,
      createdAt: Date.now(),
      author: this.settings.profileName || undefined,
      authorAvatar: this.settings.profileAvatar || undefined,
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

  private findAssistantMessage(sessionId: string, turnId: string | undefined): ChatMessage | undefined {
    if (!turnId) return undefined;
    const list = this.messagesBySession[sessionId];
    return list?.find((m) => m.turnId === turnId && m.role === "assistant");
  }

  handleEvent(env: Envelope) {
    const sessionId = env.sessionId ?? this.currentSessionId ?? "";
    // A handful of event types are session-agnostic (peer_list, provider_*,
    // project_list, etc.) and are fine to process with no resolvable session
    // — but anything below that assumes a real session would otherwise
    // silently stand up a bogus "" session. Only bail for types that
    // actually need one.
    if (!sessionId && SESSION_SCOPED_EVENTS.has(env.type)) {
      this.log(`dropped ${env.type}: no resolvable sessionId`);
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
          if (existing) {
            existing.name = data.name;
            existing.args = data.args ?? {};
          } else {
            const entry: ToolCallEntry = {
              toolCallId: env.toolCallId,
              name: data.name,
              args: data.args ?? {},
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
          this.pendingPermission = { ...data, sessionId, turnId: env.turnId, toolCallId: env.toolCallId };
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
          }
        }
        if (this.pendingPermission?.toolCallId === env.toolCallId) {
          this.pendingPermission = null;
        }
        break;
      }
      case "turn_completed": {
        const data = env.data as unknown as TurnCompletedData;
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
        try {
          localStorage.setItem(LAST_USED_PROVIDER_KEY, data.providerName);
          if (data.model) localStorage.setItem(LAST_USED_MODEL_KEY, data.model);
        } catch {
          // best-effort only
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
        this.rememberProject(data.path);
        this.currentProjectPath = data.path;
        if (data.sandboxTier) this.sandboxTierByProject[data.path] = data.sandboxTier;
        break;
      }
      case "project_list": {
        const data = env.data as { paths: string[] };
        for (const p of data.paths ?? []) this.rememberProject(p);
        break;
      }
      case "session_list": {
        const data = env.data as { projectPath?: string; sessions: SessionSummary[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) {
          this.sessionsByProject[project] = data.sessions ?? [];
          for (const s of data.sessions ?? []) this.projectBySession[s.sessionId] = project;
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
        this.log(`snapshot restored: ${data.snapshotId}`);
        break;
      }
      case "snapshot_list": {
        const data = env.data as { projectPath?: string; snapshots: SnapshotInfo[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) this.snapshotsByProject[project] = data.snapshots ?? [];
        break;
      }
      case "directory_list": {
        this.directoryListing = env.data as { path: string; entries: DirectoryEntry[] };
        break;
      }
      case "cli_availability": {
        this.cliAvailability = env.data as { claude: boolean; codex: boolean };
        break;
      }
      case "file_list": {
        const data = env.data as { projectPath?: string; files: string[] };
        const project = data.projectPath || this.currentProjectPath;
        if (project) this.filesByProject[project] = data.files ?? [];
        break;
      }
      case "peer_list": {
        const data = env.data as { peers: PeerInfo[] };
        this.peers = data.peers ?? [];
        break;
      }
      case "server_identity": {
        const data = env.data as { identity: string };
        this.serverIdentity = data.identity;
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
          messages: { role: "user" | "assistant" | "tool"; content: string; author?: string; authorAvatar?: string; reasoning?: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]; toolCallId?: string }[];
        };
        this.applySessionHistory(data.sessionId, data.messages ?? []);
        this.setSessionSyncing(data.sessionId, false);
        break;
      }
      case "token_registered": {
        const data = env.data as { name: string; token: string; email?: string };
        this.justRegisteredToken = { name: data.name, token: data.token };
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
      case "plan_mode_set": {
        const data = env.data as { sessionId: string; enabled: boolean };
        this.planModeBySession[data.sessionId] = data.enabled;
        break;
      }
      case "error": {
        const data = env.data as { message: string; fatal?: boolean; projectPath?: string };
        this.log(`error: ${data.message}`);
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
            msg.text = msg.text || `⚠ ${data.message}`;
          }
          delete this.activeTurnBySession[sessionId];
          this.activeTurnBySession = { ...this.activeTurnBySession };
          this.saveChatHistory();
        }
        break;
      }
      default:
        break;
    }
  }
}

export const app = new AppState();

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Envelope } from "./types";
import { app } from "./state.svelte";
import { outgoingAvatarDataUrl } from "./avatar";
import { isDesktop } from "./platform";

let wired = false;

// --- Liveness (§2a "Keeping a connection alive") ---
// The backend pings roughly every 30s and drops a connection after ~90s of
// silence. A dead network path (wifi drop, a laptop sleeping, a NAT timeout)
// often produces no read error at all — the socket just goes quiet forever
// with no exception to react to — so rather than only reacting to a socket
// close, track the last time we heard *anything* from the backend (any
// envelope counts, not just its ping) and treat prolonged silence as dead.
// The client doesn't send its own ping — the backend's heartbeat is the
// thing being strengthened server-side instead.
const LIVENESS_TIMEOUT_MS = 60_000; // comfortably < the backend's own ~90s cutoff
const WATCHDOG_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let lastActivityAt = Date.now();
let watchdogTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;

function startLiveness() {
  lastActivityAt = Date.now();
  reconnectAttempt = 0;
  clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (app.connectionStatus === "connected" && Date.now() - lastActivityAt > LIVENESS_TIMEOUT_MS) {
      void invoke("disconnect").catch(() => {
        // best-effort — we're about to treat the connection as dead either way
      });
      handleConnectionLost("no response from server");
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopLiveness() {
  clearInterval(watchdogTimer);
  clearTimeout(reconnectTimer);
  watchdogTimer = undefined;
  reconnectTimer = undefined;
}

/** Only the local unix socket is safe to retry unattended — a remote/TCP
 * connection's host/port/token were entered by hand and aren't persisted
 * (storing a bare auth token client-side without real OS credential storage
 * isn't something to do silently), so a dropped remote connection surfaces
 * as an error and waits for the user to reconnect via the Connect screen
 * instead of guessing at credentials to retry with. */
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    if (app.connectionStatus === "connected" || app.connectionStatus === "connecting") return;
    app.log(`reconnecting to local socket (attempt ${reconnectAttempt})…`);
    void autoConnect();
  }, delay);
}

function handleConnectionLost(reason: string) {
  const mode = app.connectionMode;
  stopLiveness();
  app.connectionStatus = "disconnected";
  app.connectionError = reason;
  app.log(`disconnected: ${reason}`);
  app.clearAllSessionSyncing();
  if (mode === "local") scheduleReconnect();
}

export function wireEvents() {
  if (wired || !isDesktop) return;
  wired = true;

  listen<Envelope>("yoake-event", (e) => {
    lastActivityAt = Date.now();
    const env = e.payload;
    if (env.type === "ping") {
      // Backend liveness check (§2a) — echo the nonce straight back.
      void send({ type: "pong", data: { nonce: (env.data as { nonce?: string })?.nonce } });
      return;
    }
    app.handleEvent(env);

    // provider_registered only carries {name} (§3.2), not the full roster —
    // refetch so a just-added provider actually shows up in the picker.
    if (env.type === "provider_registered") {
      listProviders();
    }

    // "Auto" mode is a client-side convenience the wire protocol has no
    // concept of: skip the modal and immediately approve, same as clicking
    // "Allow Once" ourselves.
    if (env.type === "permission_request" && env.sessionId && env.turnId && env.toolCallId) {
      if (app.modeBySession[env.sessionId] === "auto") {
        respondPermission(env.sessionId, env.turnId, env.toolCallId, true, false);
        app.pendingPermission = null;
      }
    }

  });

  listen<string>("yoake-log", (e) => app.log(e.payload));

  listen<{ reason: string }>("yoake-disconnected", (e) => {
    handleConnectionLost(e.payload.reason);
  });
}

export async function send(envelope: Envelope) {
  try {
    await invoke("send_envelope", { envelope });
  } catch (err) {
    // Most callers fire-and-forget (`void send(...)`) — a rejection here
    // (e.g. a stray pong racing a disconnect) would otherwise surface as an
    // unhandled promise rejection instead of a normal, logged failure.
    app.log(`send failed: ${err}`);
  }
}

export async function probeTcp(host: string, port: number): Promise<boolean> {
  return invoke("probe_tcp", { host, port });
}

export async function probeUnix(path: string): Promise<boolean> {
  return invoke("probe_unix", { path });
}

export interface SpawnServerOpts {
  binPath: string;
  host: string;
  port: number;
  token: string;
}

async function spawnDetachedServer(opts: SpawnServerOpts) {
  await invoke("spawn_detached_server", {
    binPath: opts.binPath,
    host: opts.host,
    port: opts.port,
    token: opts.token,
  });
}

export interface SpawnUnixServerOpts {
  binPath: string;
  socketPath: string;
}

async function spawnDetachedUnixServer(opts: SpawnUnixServerOpts) {
  await invoke("spawn_detached_unix_server", {
    binPath: opts.binPath,
    socketPath: opts.socketPath,
  });
}

function afterConnect() {
  startLiveness();
  listProjects();
  listProviders();
  detectCli();
  // The sidebar's Active/Archive lists are grouped across every saved
  // project, not just whichever one is currently open — so every one of
  // them needs its own list_sessions, not just currentProjectPath's.
  void listSessionsForProjects(app.recentProjects);
  if (app.currentProjectPath) listFiles(app.currentProjectPath);
  if (app.connectionMode === "local") listTokens();
  // Reconcile whatever session was open (restored from the local cache
  // before this connection existed) against the server's own history, so a
  // reconnect after being offline picks up anything that changed meanwhile.
  if (app.currentSessionId) getSessionHistory(app.currentSessionId);
}

/** Self-reported identity sent on the opt-in `auth` frame (§2a) — same shape
 * for the unix-socket and TCP paths, sourced from Settings > Profile. */
function peerIdentity() {
  return {
    name: app.settings.profileName || undefined,
    deviceType: "desktop" as const,
    avatar: app.settings.profileAvatar ? outgoingAvatarDataUrl(app.settings.profileAvatar) : undefined,
  };
}

/** Key `app.settings.trustedCaByServer` is stored under for a given remote. */
export function caServerKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/** Reads a CA certificate file (e.g. a copy of the server's own
 * `<-state-dir>/tls/ca.pem`, §2a) via the file picker + the one narrow
 * filesystem read this app has (backend.rs's read_text_file) — no general fs
 * plugin needed for this single use. */
export async function importCaCertFile(): Promise<string | null> {
  const path = await open({ multiple: false, title: "Locate the server's ca.pem" });
  if (typeof path !== "string") return null;
  return invoke<string>("read_text_file", { path });
}

export async function connectTcp(host: string, port: number, token: string, caPem?: string) {
  app.connectionStatus = "connecting";
  app.connectionError = null;
  try {
    await invoke("connect_tcp", { host, port, token, caPem: caPem || undefined, ...peerIdentity() });
    app.connectionMode = "remote";
    app.connectionStatus = "connected";
    if (caPem) {
      app.settings.trustedCaByServer[caServerKey(host, port)] = caPem;
      app.applySettings();
    }
    afterConnect();
  } catch (err) {
    app.connectionStatus = "error";
    app.connectionError = String(err);
    throw err;
  }
}

/**
 * The "local" flow: never assume the UI owns the server's lifecycle. If
 * something is already listening on the socket path, just connect to it —
 * no token to manage, since a Unix domain socket (§2a) is a filesystem
 * object the OS already restricts to this user account. Only if nothing
 * answers do we launch one ourselves — detached, so it keeps running
 * independently of this app — and connect once it's up. No project is
 * opened here: the server isn't bound to one (§4b), that happens per session
 * via openProjectAndStartSession/open_project.
 */
export async function connectLocalUnix(opts: SpawnUnixServerOpts) {
  app.connectionStatus = "connecting";
  app.connectionError = null;
  try {
    const alreadyRunning = await probeUnix(opts.socketPath);
    if (!alreadyRunning) {
      app.log(`no server on ${opts.socketPath}, launching one`);
      await spawnDetachedUnixServer(opts);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        if (await probeUnix(opts.socketPath)) break;
      }
    }
    await invoke("connect_unix", { path: opts.socketPath, ...peerIdentity() });
    app.connectionMode = "local";
    app.connectionStatus = "connected";
    afterConnect();
  } catch (err) {
    app.connectionStatus = "error";
    app.connectionError = String(err);
    throw err;
  }
}

/** Fallback shown before the real default resolves (see `getDefaultSocketPath`). */
export const FALLBACK_SOCKET_PATH = "~/.yoake/yoakeland.sock";

/**
 * Mirrors yoakeland's own default listen-socket resolution:
 * `$XDG_RUNTIME_DIR/yoake/yoakeland.sock`, then (macOS)
 * `$TMPDIR/yoake/yoakeland.sock`, else `~/.yoake/yoakeland.sock`. Computed
 * Rust-side (`default_socket_path`) since those env vars aren't available to
 * the webview.
 */
export async function getDefaultSocketPath(): Promise<string> {
  try {
    return await invoke<string>("default_socket_path");
  } catch {
    return FALLBACK_SOCKET_PATH;
  }
}

/**
 * Called once on startup: connecting should be automatic, not something the
 * user has to click through. Tries the default local socket first (spawning
 * a server there if nothing's listening yet, same as connectLocalUnix always
 * has) — the connect modal only opens itself if that fails, since at that
 * point there's no other connection this app can reach on its own and a
 * remote server's host/token can only ever come from the user anyway.
 */
export async function autoConnect() {
  try {
    const socketPath = await getDefaultSocketPath();
    await connectLocalUnix({ binPath: "yoakeland", socketPath });
  } catch {
    app.showConnectModal = true;
  }
}

export async function disconnect() {
  stopLiveness();
  await invoke("disconnect");
  app.connectionStatus = "disconnected";
  app.clearAllSessionSyncing();
}

// ---- Convenience wrappers for outbound events (§3.1) ----

export function sendPrompt(sessionId: string, prompt: string): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  app.addUserMessage(sessionId, turnId, prompt);
  // Always included, not just on first use: a session is permanently bound
  // to one project on our side too, so this never conflicts (§4b) and saves
  // tracking "have we sent it yet" separately.
  const projectPath = app.projectBySession[sessionId];
  if (app.sessionById.get(sessionId)?.archived) setSessionArchived(sessionId, false);
  void send({
    type: "user_prompt",
    sessionId,
    turnId,
    data: {
      prompt,
      sessionId,
      projectPath,
      // Who wrote this, persisted with the message so it still renders after a
      // reload repaints the transcript from server history (§3.2) — the avatar
      // has no other source once this client's settings aren't in the picture.
      // Sent raw rather than through outgoingAvatarDataUrl: this is exactly what
      // the live bubble renders, so the stored copy and the live one can't
      // disagree, and the default emoji stays a few bytes instead of becoming a
      // PNG on every message.
      authorName: app.settings.profileName || undefined,
      authorAvatar: app.settings.profileAvatar || undefined,
    },
  });
  // No client-side title anymore: the backend races its own generated title
  // against a fallback on this first turn and pushes whichever wins as an
  // unprompted session_updated (SPEC.md §3.1 "Auto-generated titles") — we
  // just wait for it instead of overwriting it with a local guess.
  return turnId;
}

/** Fetches a session's server-persisted transcript (§3.2 get_session_history)
 * — chat history is server state, not client state, so this is the one call
 * that repaints a session from truth rather than from the local cache. Fine
 * to call unconditionally on open: an id with no persisted history yet just
 * comes back with an empty `messages` list, not an error. */
export function getSessionHistory(sessionId: string) {
  app.setSessionSyncing(sessionId, true);
  // projectPath for the same reason every other session-scoped call sends it
  // (see setProvider): the session→project binding lives in server memory
  // (§4b) and a restarted server has forgotten it, so without this a chat in
  // any project other than the server's default resolves against the default
  // project and comes back with an empty history — which this client then
  // repaints over the transcript, making a perfectly saved chat look gone.
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "get_session_history", data: { sessionId, projectPath } });
}

/** Re-sends a resumed session's own provider/model and plan-mode choice from
 * this client's cache (`providerBySession`/`planModeBySession`) if it has
 * one. These are server-memory-only (SPEC.md §4b) — lost across a server
 * restart or a `remove_project` teardown, with no push telling the client it
 * happened — so a resumed session's next turn would otherwise silently run
 * on the registry's default provider instead of what the user picked. This
 * is the client-side half of that documented recovery contract: the same
 * cache that already renders the picker's current selection is replayed
 * back to the server, not just displayed. No-op if nothing's cached (a
 * session that never had `set_provider`/`set_plan_mode` called on it, or a
 * fresh app launch that never populated the cache to begin with — this
 * can't recover state the client itself no longer remembers). */
function reassertSessionSettings(sessionId: string) {
  const providerName = app.providerBySession[sessionId];
  if (providerName) setProvider(sessionId, providerName, app.modelBySession[sessionId]);
  const planMode = app.planModeBySession[sessionId];
  if (planMode !== undefined) setPlanMode(sessionId, planMode);
}

/** Opens `sessionId` as the main chat and refreshes it from the server so a
 * session opened cold — a second device, a fresh install, a reconnect after
 * being offline — shows its actual history instead of whatever (or nothing)
 * this client happens to have cached locally. Use this instead of calling
 * `app.openSession` directly.
 *
 * This is also the single funnel that feeds the titlebar's back/forward
 * history (see app.pushNavHistory): every user-initiated switch goes through
 * here, so clicking between chats in the sidebar and stepping through them
 * with the arrows walk the same list. Re-clicking the already-open session
 * records nothing, so it can't fill the stack with duplicates of itself. */
export function openChatSession(sessionId: string) {
  if (sessionId !== app.currentSessionId) app.pushNavHistory(app.currentSessionId);
  app.openSession(sessionId);
  if (app.connectionStatus === "connected") {
    getSessionHistory(sessionId);
    reassertSessionSettings(sessionId);
  }
}

/** The titlebar island's back/forward arrows — same open-and-refresh path as
 * clicking a session in the sidebar, so a stepped-to chat resyncs from the
 * server exactly like a clicked one. No-op at either end of the history (the
 * buttons are disabled there, but a keyboard/rapid double-click can still get
 * here). */
export function navigateSessionHistory(direction: "back" | "forward") {
  const target = direction === "back" ? app.stepBack() : app.stepForward();
  if (!target) return;
  app.openSession(target);
  if (app.connectionStatus === "connected") {
    getSessionHistory(target);
    reassertSessionSettings(target);
  }
}

export function cancelTurn(sessionId: string, turnId: string) {
  void send({ type: "cancel_turn", sessionId, turnId, data: { sessionId, turnId } });
}

export function respondPermission(
  sessionId: string,
  turnId: string,
  toolCallId: string,
  allowed: boolean,
  remember: boolean,
  feedback?: string,
) {
  void send({
    type: "permission_response",
    sessionId,
    turnId,
    toolCallId,
    data: { allowed, remember, ...(feedback ? { feedback } : {}) },
  });
}

/** Rejects a pending permission with an optional note on *why* — fed to the
 * model as part of this same turn's denial message (SPEC.md §3.1's
 * permission_response.feedback), so it can course-correct immediately rather
 * than needing a follow-up prompt. This is the composer's "reject and tell it
 * what you want instead" action. */
export function denyPermissionWithFeedback(
  sessionId: string,
  turnId: string,
  toolCallId: string,
  feedback: string,
) {
  respondPermission(sessionId, turnId, toolCallId, false, false, feedback.trim() || undefined);
  app.pendingPermission = null;
}

export function restoreSnapshot(sessionId: string, snapshotId: string) {
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "restore_snapshot", sessionId, turnId: "", data: { snapshotId, projectPath } });
}

export function listSnapshots(projectPath: string) {
  void send({ type: "list_snapshots", data: { projectPath } });
}

/** Derives a title from a session's first prompt (truncated/whitespace-
 * collapsed) and pushes it via set_session_title — the backend never
 * generates one itself (SPEC.md §3.1). Only meaningful the first time a
 * session gets a message; harmless to call again; the server just overwrites. */
export function setSessionTitle(sessionId: string, title: string) {
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "set_session_title", data: { sessionId, title, projectPath } });
}

/** Optimistic: without this, the archive button in the chat list appeared to
 * do nothing until the server's session_updated (§3.2) round-tripped back —
 * this applies the flag locally right away, same shape as that handler in
 * state.svelte.ts, which still applies when the real response lands. */
export function setSessionArchived(sessionId: string, archived: boolean) {
  const project = app.projectBySession[sessionId];
  if (project && app.sessionsByProject[project]) {
    app.sessionsByProject[project] = app.sessionsByProject[project].map((s) =>
      s.sessionId === sessionId ? { ...s, archived } : s,
    );
  }
  void send({ type: "set_session_archived", data: { sessionId, archived, projectPath: project } });
}

/** Pairs (or, with `null`, unpairs) `sessionId`'s split/sidebar layout
 * (§3.1 set_session_layout) — server-persisted so it survives a reload or
 * shows up on another device, unlike the plain UI state in
 * app.showInSidePanel. Optimistic, same pattern as setSessionArchived. */
export function setSessionLayout(sessionId: string, linkedSessionId: string | null) {
  const project = app.projectBySession[sessionId];
  if (project && app.sessionsByProject[project]) {
    app.sessionsByProject[project] = app.sessionsByProject[project].map((s) =>
      s.sessionId === sessionId ? { ...s, linkedSessionId: linkedSessionId ?? undefined } : s,
    );
  }
  void send({ type: "set_session_layout", data: { sessionId, linkedSessionId, projectPath: project } });
}

/** Permanently deletes a persisted session (§3.1 delete_session) — unlike
 * setSessionArchived this isn't reversible, so no optimistic local removal:
 * wait for the server's `session_deleted` (state.svelte.ts) before dropping
 * it from the UI. */
export function deleteSession(sessionId: string) {
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "delete_session", data: { sessionId, projectPath } });
}

/** Opens `sessionId` in the right sidebar (button on a session row — see
 * Sidebar.svelte / ProjectGroup.svelte) and, the first time these two
 * sessions are shown together, saves the pairing server-side (§3.1
 * set_session_layout) so it's still there — and auto-reopens (see
 * app.openSession) — after a reload or from another device. */
export function openInSidePanel(sessionId: string) {
  const main = app.currentSessionId;
  if (main && main !== sessionId && app.splitPartnerFor(main)?.sessionId !== sessionId) {
    setSessionLayout(main, sessionId);
  }
  app.ensureSession(sessionId);
  app.showInSidePanel(sessionId);
  if (app.connectionStatus === "connected") {
    getSessionHistory(sessionId);
    reassertSessionSettings(sessionId);
  }
}

/** Browses the *backend's* filesystem (§3.1) — the only correct way to pick a
 * project folder over a remote/TCP connection, where a native OS dialog on
 * this machine would browse the wrong disk entirely. */
export function listDirectory(path?: string) {
  void send({ type: "list_directory", data: { path: path ?? "" } });
}

/** Opens (or reuses) a project on the server without starting a turn — e.g.
 * to validate a folder and list its threads before creating a new one. */
export function openProject(path: string) {
  void send({ type: "open_project", data: { path } });
}

/** Selects `path` as the current project everywhere in the UI and, if
 * connected, opens it server-side and fetches its threads. The server now
 * persists the known-projects list itself (§4b `projects.json`) and echoes
 * back the canonical (symlink-resolved) form of whatever path was sent — so
 * when connected, `rememberProject` is only called once, from that
 * `project_opened` response (state.svelte.ts), not here with the raw picked
 * path too. Calling it both places used to leave two differently-spelled
 * entries in `recentProjects` for the same real folder whenever the raw pick
 * wasn't already exactly absolute/clean. When *not* connected there's no
 * round-trip to canonicalize/confirm this against, so it's remembered
 * locally as a best guess — reconciled the next time list_projects (or this
 * same open_project) succeeds. */
export function selectProject(path: string) {
  app.selectProject(path);
  if (app.connectionStatus === "connected") {
    openProject(path);
    listSessionsForProject(path);
    listFiles(path);
  } else {
    app.rememberProject(path);
  }
}

let directoryBrowserResolve: ((path: string | null) => void) | null = null;

/** Opens the in-app folder browser (§3.1 `list_directory`), the only correct
 * way to pick a project folder over a remote/TCP connection — the backend's
 * filesystem isn't necessarily this machine's. Resolves with the chosen
 * path, or null if cancelled. */
export function browseRemoteDirectory(): Promise<string | null> {
  return new Promise((resolve) => {
    directoryBrowserResolve = resolve;
    app.directoryListing = null;
    listDirectory();
    app.showDirectoryBrowser = true;
  });
}

/** Called by DirectoryBrowser.svelte when the user confirms or cancels. */
export function resolveDirectoryBrowser(path: string | null) {
  app.showDirectoryBrowser = false;
  directoryBrowserResolve?.(path);
  directoryBrowserResolve = null;
}

/** A native OS dialog only reflects the right filesystem for a local
 * unix-socket connection (§3.1 `list_directory`); anything else falls back
 * to browsing the backend's own filesystem in-app. */
function pickFolder(title: string): Promise<string | null> {
  if (app.connectionStatus === "connected" && app.connectionMode === "remote") {
    return browseRemoteDirectory();
  }
  return open({ directory: true, multiple: false, title }).then((dir) => (typeof dir === "string" ? dir : null));
}

/** Browse for a folder and select it. Returns the chosen path, or null if
 * the user cancelled. */
export async function pickProjectFolder(): Promise<string | null> {
  const dir = await pickFolder("Open project folder");
  if (!dir) return null;
  selectProject(dir);
  return dir;
}

/** The one remaining native-dialog entry point — Settings > Connections'
 * "Browse…", for adding a new path from scratch without switching to it
 * (daily selection goes through the sidebar's dropdown instead). Must still
 * reach the server via `open_project` when connected — the known-projects
 * list is server-persisted now (§4b), so a path only ever remembered
 * locally here would never make it into `projects.json` and so would never
 * show up for another device, or survive this client forgetting its own
 * localStorage. Same connected/offline split as `selectProject`. */
export async function browseAndAddProject(): Promise<string | null> {
  const dir = await pickFolder("Add a project folder");
  if (!dir) return null;
  if (app.connectionStatus === "connected") {
    app.nextProjectOpenSwitches = false; // "adds without switching to it" — see state.svelte.ts's project_opened handler
    openProject(dir);
  } else {
    app.rememberProject(dir);
  }
  return dir;
}

export function listProjects() {
  void send({ type: "list_projects", data: {} });
}

/** Drops a path from the server's persisted known-projects list (so it stops
 * coming back on the next list_projects) and cancels/evicts any session
 * still live in it server-side — real teardown, not just a client-side
 * "hide it" (SPEC.md §3.1 remove_project). Paired with the user removing it
 * locally (Settings > Connections) — see app.forgetProject. */
export function removeProject(path: string) {
  void send({ type: "remove_project", data: { path } });
}

export function listSessionsForProject(projectPath: string) {
  app.refreshingProjects[projectPath] = true;
  void send({ type: "list_sessions", data: { projectPath } });
}

export function listSessionsForProjects(paths: string[]) {
  for (const path of paths) listSessionsForProject(path);
}

/** Fetches the project's file list (§3.1) for @file mention autocomplete. */
export function listFiles(projectPath: string) {
  void send({ type: "list_files", data: { projectPath } });
}

export function listProviders() {
  void send({ type: "list_providers", data: {} });
}

export function detectCli() {
  void send({ type: "detect_cli", data: {} });
}

export function setProvider(sessionId: string, providerName: string, model?: string) {
  // `projectPath` is included for the same reason setSessionTitle and friends
  // send it: a brand-new chat's session isn't bound to its project yet, and
  // the server keeps a *separate* session registry per project (§4b). Omitting
  // it lets the server resolve the session against its default-project
  // fallback, so the provider lands on a different registry than the one the
  // first `user_prompt` (which *does* carry projectPath) later binds to — the
  // turn then runs on an unconfigured session and comes back `no_provider`,
  // clearing this very selection. Sending the session's own project path
  // resolves set_provider into the same registry the prompt will use.
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "set_provider", sessionId, data: { providerName, model, projectPath } });
}

/** Tunes the current provider's request shape for a session's next turn
 * (§3.1) — reasoning effort / thinking budget / context-window override.
 * All three fields are optional; a zero/empty one is left unchanged
 * server-side, not reset, so callers only need to pass what they're
 * actually changing. */
export function setModelOptions(
  sessionId: string,
  options: { reasoningEffort?: string; thinkingBudget?: number; contextWindow?: number },
) {
  // projectPath for the same reason setProvider sends it — see there.
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "set_model_options", sessionId, data: { sessionId, ...options, projectPath } });
}

/** Fetches one provider's available models (§3.1) — the model picker's per-
 * provider tabs call this lazily rather than resolving every provider up
 * front. */
export function listModels(providerName: string) {
  void send({ type: "list_models", data: { providerName } });
}

/** Replaces one provider's server-persisted favorite-model list (§3.1) — a
 * full replacement, not a single toggle, so callers must send the whole
 * updated set. */
export function setFavoriteModels(providerName: string, models: string[]) {
  void send({ type: "set_favorite_models", data: { providerName, models } });
}

export function setPlanMode(sessionId: string, enabled: boolean) {
  // projectPath for the same reason setProvider sends it — see there.
  const projectPath = app.projectBySession[sessionId];
  void send({ type: "set_plan_mode", sessionId, data: { sessionId, enabled, projectPath } });
}

export function registerProvider(data: Record<string, unknown>) {
  void send({ type: "register_provider", data });
}

export function removeProvider(name: string) {
  void send({ type: "remove_provider", data: { name } });
}

// ---- Peer registry & server settings (§2a/§3.1) ----

/** Pushes this connection's own display name live — every peer (including us)
 * sees it on the next `peer_list` push, so Profile settings and our own
 * roster row stay driven by the same underlying state. */
export function setPeerName(name: string) {
  void send({ type: "set_peer_name", data: { name } });
}

/** Same live-push shape as setPeerName, for the profile picture — `avatar` is
 * either an emoji glyph or an already-96x96 uploaded photo (state.svelte.ts's
 * `profileAvatar`); outgoingAvatarDataUrl (avatar.ts) normalizes either into
 * the 96x96 data URL the wire protocol expects, since the backend does no
 * image processing at all. */
export function setPeerAvatar(avatar: string) {
  void send({ type: "set_peer_avatar", data: { avatar: outgoingAvatarDataUrl(avatar) } });
}

/** Force-closes another live connection. Any peer may disconnect any other
 * (§2a) — the confirm step belongs in the UI, not here. */
export function disconnectPeer(peerId: string) {
  void send({ type: "disconnect_peer", data: { peerId } });
}

/** Opens or closes the optional TCP listener live. Local-socket-only — the
 * server rejects this over TCP (§3.1). */
export function setRemoteAccess(enabled: boolean) {
  void send({ type: "set_remote_access", data: { enabled } });
}

/** Server-wide default for a first `user_prompt` that omits its own
 * `autoGenerateTitle` (§3.1 set_auto_generate_title). Broadcast back to every
 * peer as `auto_generate_title`, same push-only pattern as remote access. */
export function setAutoGenerateTitle(enabled: boolean) {
  void send({ type: "set_auto_generate_title", data: { enabled } });
}

/** Rotates the TCP listener's shared auth token. Local-socket-only. */
export function setRemotePassword(password: string) {
  void send({ type: "set_remote_password", data: { password } });
}

/** Sets the server's own display name, broadcast to every peer immediately —
 * not a security boundary, so this works over any transport. */
export function setServerIdentity(name: string) {
  void send({ type: "set_server_identity", data: { name } });
}

// ---- Per-person tokens (§3.1) — local-socket-only, like remote-access ----

/** Mints a new named TCP auth credential. Response (`token_registered`)
 * carries the raw token — shown once, per SPEC.md §3.2. */
export function registerToken(name: string, email?: string) {
  void send({ type: "register_token", data: { name, email: email || undefined } });
}

export function listTokens() {
  void send({ type: "list_tokens", data: {} });
}

export function removeToken(name: string) {
  void send({ type: "remove_token", data: { name } });
}

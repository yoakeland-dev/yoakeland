import type { ChatMode, Envelope, ServerStatus } from "./types";
import {
  app,
  ServerState,
  forgetKnownServer,
  loadKnownServers,
  loadServerToken,
  type ConnectionId,
  type KnownServer,
} from "./state.svelte";
import { outgoingAvatarDataUrl } from "./avatar";
import { isDesktop, invoke, listen, pickFiles } from "./platform";
import { bytesToBase64 } from "./base64";

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
//
// Phase 3 (multi-server): this is keyed per connection now, not a lone set
// of module-level variables — each live connection watches and retries
// independently of every other one.
const LIVENESS_TIMEOUT_MS = 60_000; // comfortably < the backend's own ~90s cutoff
const WATCHDOG_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface LivenessState {
  lastActivityAt: number;
  watchdogTimer?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectAttempt: number;
}

const liveness = new Map<ConnectionId, LivenessState>();

function startLiveness(connectionId: ConnectionId) {
  stopLiveness(connectionId);
  const state: LivenessState = { lastActivityAt: Date.now(), reconnectAttempt: 0 };
  liveness.set(connectionId, state);
  state.watchdogTimer = setInterval(() => {
    const server = app.servers[connectionId];
    if (server?.connectionStatus === "connected" && Date.now() - state.lastActivityAt > LIVENESS_TIMEOUT_MS) {
      void invoke("disconnect", { connectionId }).catch(() => {
        // best-effort — we're about to treat the connection as dead either way
      });
      handleConnectionLost(connectionId, "no response from server");
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopLiveness(connectionId: ConnectionId) {
  const state = liveness.get(connectionId);
  if (!state) return;
  clearInterval(state.watchdogTimer);
  clearTimeout(state.reconnectTimer);
  liveness.delete(connectionId);
}

function touchActivity(connectionId: ConnectionId) {
  const state = liveness.get(connectionId);
  if (state) state.lastActivityAt = Date.now();
}

/** Retries a dropped connection with backoff — local and remote alike: a
 * remote's host/port/token are all in its in-memory ConnectParams (and the
 * token is remembered across restarts, see storeServerToken). */
function scheduleReconnect(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (!server) return;
  let state = liveness.get(connectionId);
  if (!state) {
    state = { lastActivityAt: Date.now(), reconnectAttempt: 0 };
    liveness.set(connectionId, state);
  }
  clearTimeout(state.reconnectTimer);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** state.reconnectAttempt, RECONNECT_MAX_MS);
  state.reconnectAttempt++;
  state.reconnectTimer = setTimeout(() => {
    const s = app.servers[connectionId];
    if (!s || s.connectionStatus === "connected" || s.connectionStatus === "connecting") return;
    app.log(`reconnecting to ${s.label} (attempt ${state.reconnectAttempt})…`);
    void redial(connectionId);
  }, delay);
}

function handleConnectionLost(connectionId: ConnectionId, reason: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  stopLiveness(connectionId);
  server.connectionStatus = "disconnected";
  server.connectionError = reason;
  app.log(`disconnected: ${reason}`);
  server.clearAllSessionSyncing();
  server.pendingAsks = [];
  for (const w of uploadWaiters.values()) {
    if (w.connectionId === connectionId) w.resolve({ error: "connection lost" });
  }
  scheduleReconnect(connectionId);
}

/** Redials a dropped connection — automatically for local ones (see
 * scheduleReconnect), or on request for either mode (reconnectServer, from
 * the palette/Settings server lists; a remote's token is still in its
 * in-memory ConnectParams). Rust mints a brand-new ConnectionId
 * per connect_unix call — there's no way to ask for the old one back — so a
 * naive reconnect would mean dropping this server's ServerState (current
 * session/project, nav history, caches) and starting a fresh one, which
 * would be a real regression from today's single-connection behavior, where
 * a brief drop-and-reconnect just quietly resyncs without resetting
 * anything the user can see. Instead, re-key the *same* ServerState instance
 * under the new id once the redial succeeds. */
async function redial(oldConnectionId: ConnectionId) {
  const server = app.servers[oldConnectionId];
  if (!server) return;
  const params = server.connectParams;
  server.connectionStatus = "connecting";
  try {
    const newConnectionId =
      params.mode === "local"
        ? await invoke<string>("connect_unix", { path: params.socketPath, ...peerIdentity() })
        : await invoke<string>("connect_tcp", {
            host: params.host,
            port: params.port,
            token: params.token,
            caPem: params.caPem || undefined,
            ...peerIdentity(),
          });
    delete app.servers[oldConnectionId];
    stopLiveness(oldConnectionId); // oldConnectionId is retired — afterConnect(newConnectionId) starts fresh tracking
    server.connectionId = newConnectionId;
    server.connectionStatus = "connected";
    server.connectionError = null;
    app.servers[newConnectionId] = server;
    if (app.activeConnectionId === oldConnectionId) app.activeConnectionId = newConnectionId;
    afterConnect(newConnectionId);
  } catch (err) {
    server.connectionStatus = "error";
    server.connectionError = String(err);
    scheduleReconnect(oldConnectionId);
  }
}

export const reconnectServer = redial;

export function wireEvents() {
  if (wired || !isDesktop) return;
  wired = true;

  // Every payload carries the ConnectionId backend.rs's reader task tagged
  // it with (see backend.rs's module doc) — this is the one dispatch point
  // that routes each event to the right ServerState, rather than assuming
  // "the one connection" the way pre-multi-server code did.
  listen<{ connectionId: string; envelope: Envelope }>("yoake-event", (payload) => {
    const { connectionId, envelope: env } = payload;
    const server = app.servers[connectionId];
    if (!server) return; // stale event from a connection we no longer track
    touchActivity(connectionId);
    if (env.type === "ping") {
      // Backend liveness check (§2a) — echo the nonce straight back. A
      // server-sent ping also carries the status bar's server snapshot.
      const data = env.data as { nonce?: string; status?: ServerStatus } | undefined;
      if (data?.status) server.serverStatus = data.status;
      void send(connectionId, { type: "pong", data: { nonce: data?.nonce } });
      return;
    }
    if (env.type === "upload_progress" || env.type === "upload_done") {
      const data = env.data as unknown as UploadReply & { uploadId: string };
      uploadWaiters.get(data.uploadId)?.resolve(data);
      return;
    }
    server.handleEvent(env);

    // provider_registered only carries {name} (§3.2), not the full roster —
    // refetch so a just-added provider actually shows up in the picker.
    if (env.type === "provider_registered") {
      listProviders(connectionId);
    }
  });

  listen<{ connectionId: string; message: string }>("yoake-log", (p) => app.log(p.message));

  listen<{ connectionId: string; reason: string }>("yoake-disconnected", (p) => {
    handleConnectionLost(p.connectionId, p.reason);
  });
}

export async function send(connectionId: ConnectionId, envelope: Envelope) {
  try {
    await invoke("send_envelope", { connectionId, envelope });
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

function afterConnect(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (!server) return;
  startLiveness(connectionId);
  listProjects(connectionId);
  listProviders(connectionId);
  detectCli(connectionId);
  listNotifications(connectionId);
  // The sidebar's Active/Archive lists are grouped across every saved
  // project, not just whichever one is currently open — so every one of
  // them needs its own list_sessions, not just currentProjectPath's.
  void listSessionsForProjects(connectionId, server.recentProjects);
  if (server.currentProjectPath) listFiles(connectionId, server.currentProjectPath);
  if (server.connectionMode === "local") listTokens(connectionId);
  // Reconcile whatever session was open (restored from the local cache
  // before this connection existed) against the server's own history, so a
  // reconnect after being offline picks up anything that changed meanwhile.
  if (server.currentSessionId) {
    getSessionHistory(connectionId, server.currentSessionId);
    listTerminals(connectionId, server.currentSessionId);
  }
}

/** Self-reported identity sent on the opt-in `auth` frame (§2a) — same shape
 * for the unix-socket and TCP paths, sourced from Settings > Profile. One
 * identity, shared across every server this client connects to — not a
 * per-connection setting, so this doesn't take a connectionId. */
function peerIdentity() {
  return {
    name: app.settings.profileName || undefined,
    deviceType: "desktop" as const,
    avatar: app.settings.profileAvatar ? outgoingAvatarDataUrl(app.settings.profileAvatar) : undefined,
    deviceId: thisDeviceId(),
  };
}

/** This install's stable id (§2a auth `deviceId`), made once and sent to
 * every server, so they (and our own peer widget) can tell devices apart. */
export function thisDeviceId(): string {
  const KEY = "yoake.deviceId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** Key `app.settings.trustedCaByHostPort` is stored under for a given remote. */
export function caServerKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/** Reads a CA certificate file (e.g. a copy of the server's own
 * `<-state-dir>/tls/ca.pem`, §2a) via the file picker + the one narrow
 * filesystem read this app has (backend.rs's read_text_file) — no general fs
 * plugin needed for this single use. */
export async function importCaCertFile(): Promise<string | null> {
  const [path] = await pickFiles({ title: "Locate the server's ca.pem" });
  if (!path) return null;
  return invoke<string>("read_text_file", { path });
}

export async function connectTcp(host: string, port: number, token: string, caPem?: string): Promise<ConnectionId> {
  app.setPendingConnect("connecting", "remote");
  try {
    const connectionId = await invoke<string>("connect_tcp", {
      host,
      port,
      token,
      caPem: caPem || undefined,
      ...peerIdentity(),
    });
    const server = new ServerState(connectionId, app, { mode: "remote", host, port, token, caPem });
    app.servers[connectionId] = server;
    // Only takes the active slot if nothing else already holds it — adding
    // a second/background server (e.g. "Add another server") shouldn't yank
    // focus away from whatever the user is already looking at. This is also
    // what keeps "always one server selected" true from the very first
    // connection on, without ever stealing it back later.
    if (!app.activeConnectionId) app.activeConnectionId = connectionId;
    app.setPendingConnect("disconnected");
    if (caPem) {
      app.settings.trustedCaByHostPort[caServerKey(host, port)] = caPem;
      app.applySettings();
    }
    afterConnect(connectionId);
    return connectionId;
  } catch (err) {
    app.setPendingConnect("error", "remote", String(err));
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
export async function connectLocalUnix(opts: SpawnUnixServerOpts): Promise<ConnectionId> {
  app.setPendingConnect("connecting", "local");
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
    const connectionId = await invoke<string>("connect_unix", { path: opts.socketPath, ...peerIdentity() });
    const server = new ServerState(connectionId, app, {
      mode: "local",
      socketPath: opts.socketPath,
      binPath: opts.binPath,
    });
    app.servers[connectionId] = server;
    // Local nearly always wins this race in practice — autoConnect() tries
    // it first, before any remote connection could exist — but the same
    // "only if nothing else is active" rule as connectTcp applies here too.
    if (!app.activeConnectionId) app.activeConnectionId = connectionId;
    app.setPendingConnect("disconnected");
    afterConnect(connectionId);
    return connectionId;
  } catch (err) {
    app.setPendingConnect("error", "local", String(err));
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
 * user has to click through. The default local socket goes first (spawning a
 * server there if nothing's listening, same as connectLocalUnix always has)
 * so it wins the active slot, then every remembered server in parallel —
 * other local sockets directly, remotes with their remembered token and
 * trusted CA. A remote with no remembered token (paired before tokens were
 * kept) just stays listed under Servers until it's connected once by hand.
 * If nothing at all connects, FirstServerPanel takes over.
 */
export async function autoConnect() {
  const socketPath = await getDefaultSocketPath();
  await connectLocalUnix({ binPath: "yoakeland", socketPath }).catch(() => {});
  await Promise.allSettled(
    loadKnownServers().map(async (k) => {
      if (k.mode === "local") {
        if (k.socketPath && k.socketPath !== socketPath) await connectLocalUnix({ binPath: "yoakeland", socketPath: k.socketPath });
        return;
      }
      const token = await loadServerToken(k.serverId);
      if (!token || !k.host || !k.port) return;
      const ca = app.settings.trustedCaByServer[k.serverId] ?? app.settings.trustedCaByHostPort[caServerKey(k.host, k.port)];
      await connectTcp(k.host, k.port, token, ca);
    }),
  );
  // A failed background attempt shouldn't leave its error on the connect
  // screen once something else did connect.
  if (app.activeConnectionId) app.setPendingConnect("disconnected");
}

export async function disconnect(connectionId: ConnectionId) {
  stopLiveness(connectionId);
  await invoke("disconnect", { connectionId });
  const server = app.servers[connectionId];
  if (server) {
    server.connectionStatus = "disconnected";
    server.clearAllSessionSyncing();
    server.pendingAsks = [];
  }
}

/** The actual "remove this server" action — disconnect() alone only marks a
 * connection dead, it stays in app.servers and offered-for-reconnect
 * forever, with nothing in the UI to take the next step. This does: close
 * the connection (abort()s its reader/writer, backend.rs's disconnect —
 * explicit, so no "connection lost" event fires and local mode's
 * auto-reconnect never kicks in), drop its ServerState so it stops appearing
 * as a connected server anywhere, forget it from the remembered-servers list
 * so it stops being offered as a "Reconnect", and hand off `active` to
 * whatever's left, if this was it. */
export async function removeServer(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (server?.connectionStatus === "connected" || server?.connectionStatus === "connecting") {
    await disconnect(connectionId);
  } else {
    stopLiveness(connectionId);
  }
  delete app.servers[connectionId];
  if (server?.serverId) forgetKnownServer(server.serverId);
  if (app.activeConnectionId === connectionId) {
    app.activeConnectionId = Object.keys(app.servers)[0] ?? null;
  }
}

/** One row per server the user could act on: every live/dead connection in
 * app.servers, then remembered ones (KnownServer) that aren't among them.
 * Shared by the palette's Servers page and Settings → Servers.
 * loadKnownServers() reads localStorage, so callers re-derive after
 * forgetting one. */
export interface ServerRow {
  key: string;
  connectionId?: ConnectionId;
  known?: KnownServer;
  /** serverId once known — ServerAvatar's color seed. */
  seed: string | null;
  label: string;
  address: string;
  mode: "local" | "remote";
  status: ServerState["connectionStatus"];
}

export function serverRows(): ServerRow[] {
  const live = Object.values(app.servers);
  const rows: ServerRow[] = live.map((s) => {
    const p = s.connectParams;
    return {
      key: s.connectionId,
      connectionId: s.connectionId,
      seed: s.serverId,
      label: s.label,
      address: p.mode === "local" ? p.socketPath : `${p.host}:${p.port}`,
      mode: p.mode,
      status: s.connectionStatus,
    };
  });
  for (const k of loadKnownServers()) {
    if (live.some((s) => s.serverId === k.serverId)) continue;
    rows.push({
      key: `known:${k.serverId}`,
      known: k,
      seed: k.serverId,
      label: k.label || (k.mode === "local" ? "Local" : "Remote"),
      address: k.mode === "local" ? (k.socketPath ?? "") : `${k.host}:${k.port}`,
      mode: k.mode,
      status: "disconnected",
    });
  }
  return rows;
}

/** The one "go to this server" action: switch to it if it's up, redial it
 * if it's a dead connection, connect a remembered local socket directly, or
 * a remembered remote with its remembered token — failing that (no token
 * kept, or it was rejected), open Settings' add-server form prefilled with
 * its address to pair again. */
export async function connectServerRow(row: ServerRow) {
  const id = row.connectionId;
  if (id) {
    if (row.status === "connected") app.activeConnectionId = id;
    else if (row.status !== "connecting") await reconnectServer(id);
    return;
  }
  const k = row.known!;
  if (k.mode === "local" && k.socketPath) {
    app.activeConnectionId = await connectLocalUnix({ binPath: "yoakeland", socketPath: k.socketPath });
  } else if (k.host && k.port) {
    const token = await loadServerToken(k.serverId);
    const ca = app.settings.trustedCaByServer[k.serverId] ?? app.settings.trustedCaByHostPort[caServerKey(k.host, k.port)];
    const id = token ? await connectTcp(k.host, k.port, token, ca).catch(() => null) : null;
    if (id) app.activeConnectionId = id;
    else app.openAddServer(k.host, k.port);
  }
}

// ---- Convenience wrappers for outbound events (§3.1) ----

/** `attachments` are absolute paths on the server's machine (§3.1
 * user_prompt): a local file's own path, or what `uploadFile` returned. */
export function sendPrompt(connectionId: ConnectionId, sessionId: string, prompt: string, attachments?: string[]): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  const server = app.servers[connectionId];
  if (!server) return turnId;
  server.addUserMessage(sessionId, turnId, prompt, attachments);
  // Always included, not just on first use: a session is permanently bound
  // to one project on our side too, so this never conflicts (§4b) and saves
  // tracking "have we sent it yet" separately.
  const projectPath = server.projectBySession[sessionId];
  if (server.sessionById.get(sessionId)?.archived) setSessionArchived(connectionId, sessionId, false);
  void send(connectionId, {
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
      attachments: attachments?.length ? attachments : undefined,
    },
  });
  // No client-side title anymore: the backend races its own generated title
  // against a fallback on this first turn and pushes whichever wins as an
  // unprompted session_updated (SPEC.md §3.1 "Auto-generated titles") — we
  // just wait for it instead of overwriting it with a local guess.
  return turnId;
}

/** SPEC.md §3.1 edit_message — replaces a past user message's content and
 * regenerates from there. A full turn, same turnId minting/streaming setup
 * as sendPrompt (state.svelte.ts's beginBranchTurn), but unlike sendPrompt
 * `sessionId` is required and no `projectPath` is sent (the session is
 * already bound). */
export function editMessage(
  connectionId: ConnectionId,
  sessionId: string,
  messageId: string,
  content: string,
  autoGenerateTitle?: boolean,
): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  const server = app.servers[connectionId];
  if (!server) return turnId;
  server.beginEdit(sessionId, turnId, messageId, content);
  void send(connectionId, {
    type: "edit_message",
    sessionId,
    turnId,
    data: {
      sessionId,
      messageId,
      content,
      ...(autoGenerateTitle !== undefined ? { autoGenerateTitle } : {}),
    },
  });
  return turnId;
}

/** SPEC.md §3.1 retry_message — discards a past assistant message (which may
 * sit mid-turn, after tool calls) and regenerates from that point. Same turn
 * machinery as editMessage/sendPrompt. */
export function retryMessage(connectionId: ConnectionId, sessionId: string, messageId: string): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  const server = app.servers[connectionId];
  if (!server) return turnId;
  server.beginRetry(sessionId, turnId, messageId);
  void send(connectionId, { type: "retry_message", sessionId, turnId, data: { sessionId, messageId } });
  return turnId;
}

/** SPEC.md §3.1 switch_branch — pure navigation, no model call: swaps in the
 * branch containing `messageId`. Its response is a full `session_history`,
 * handled by the same `case "session_history"` get_session_history's
 * response uses (state.svelte.ts), which also gets that handler's "skip
 * while a turn is actively streaming" guard for free. */
export function switchBranch(connectionId: ConnectionId, sessionId: string, messageId: string) {
  void send(connectionId, { type: "switch_branch", sessionId, turnId: "", data: { sessionId, messageId } });
}

/** Puts `sessionId`'s composer into "editing" mode for `messageId`,
 * prefilling its old text via the same restoredDraftBySession effect
 * PromptInput already uses for a no_provider-restored draft (state.svelte.ts)
 * — submit() there calls editMessage instead of sendPrompt while
 * `editingMessageId` is set. */
export function startEditingMessage(connectionId: ConnectionId, sessionId: string, messageId: string, text: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  server.editingMessageId[sessionId] = messageId;
  server.restoredDraftBySession[sessionId] = text;
}

export function cancelEditingMessage(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (server) delete server.editingMessageId[sessionId];
}

/** Fetches a session's server-persisted transcript (§3.2 get_session_history)
 * — chat history is server state, not client state, so this is the one call
 * that repaints a session from truth rather than from the local cache. Fine
 * to call unconditionally on open: an id with no persisted history yet just
 * comes back with an empty `messages` list, not an error. */
export function getSessionHistory(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  server.setSessionSyncing(sessionId, true);
  // projectPath for the same reason every other session-scoped call sends it
  // (see setProvider): the session→project binding lives in server memory
  // (§4b) and a restarted server has forgotten it, so without this a chat in
  // any project other than the server's default resolves against the default
  // project and comes back with an empty history — which this client then
  // repaints over the transcript, making a perfectly saved chat look gone.
  const projectPath = server.projectBySession[sessionId];
  void send(connectionId, { type: "get_session_history", data: { sessionId, projectPath } });
}

/** Re-sends a resumed session's own provider/model choice from this client's
 * cache (`providerBySession`) if it has one. This is server-memory-only
 * (SPEC.md §4b) — lost across a server restart or a `remove_project`
 * teardown, with no push telling the client it happened — so a resumed
 * session's next turn would otherwise silently run on the registry's default
 * provider instead of what the user picked. This is the client-side half of
 * that documented recovery contract: the same cache that already renders the
 * picker's current selection is replayed back to the server, not just
 * displayed. No-op if nothing's cached. Mode is deliberately NOT reasserted
 * here — it's server-persisted and pushed back via `session_history`'s
 * `data.mode` (§4c), so replaying a client cache over it would race a more
 * recently set value from another peer. */
function reassertSessionSettings(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  const providerName = server.providerBySession[sessionId];
  if (providerName) setProvider(connectionId, sessionId, providerName, server.modelBySession[sessionId]);
}

/** Opens `sessionId` as the main chat and refreshes it from the server so a
 * session opened cold — a second device, a fresh install, a reconnect after
 * being offline — shows its actual history instead of whatever (or nothing)
 * this client happens to have cached locally. Use this instead of calling
 * `ServerState.openSession` directly.
 *
 * This is also the single funnel that feeds the titlebar's back/forward
 * history (see ServerState.pushNavHistory): every user-initiated switch goes
 * through here, so clicking between chats in the sidebar and stepping
 * through them with the arrows walk the same list. Re-clicking the
 * already-open session records nothing, so it can't fill the stack with
 * duplicates of itself. */
/** Opens a session in the main panel — switching the main panel to its
 * server first, since the sidebar and palette list every server's chats. */
export function openChatSession(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  app.activeConnectionId = connectionId;
  if (sessionId !== server.currentSessionId) server.pushNavHistory(server.currentSessionId);
  server.openSession(sessionId);
  if (server.connectionStatus === "connected") {
    getSessionHistory(connectionId, sessionId);
    reassertSessionSettings(connectionId, sessionId);
    listTerminals(connectionId, sessionId);
  }
}

/** The titlebar island's back/forward arrows — same open-and-refresh path as
 * clicking a session in the sidebar, so a stepped-to chat resyncs from the
 * server exactly like a clicked one. No-op at either end of the history (the
 * buttons are disabled there, but a keyboard/rapid double-click can still get
 * here). */
export function navigateSessionHistory(connectionId: ConnectionId, direction: "back" | "forward") {
  const server = app.servers[connectionId];
  if (!server) return;
  const target = direction === "back" ? server.stepBack() : server.stepForward();
  if (!target) return;
  server.openSession(target);
  if (server.connectionStatus === "connected") {
    getSessionHistory(connectionId, target);
    reassertSessionSettings(connectionId, target);
    listTerminals(connectionId, target);
  }
}

export function cancelTurn(connectionId: ConnectionId, sessionId: string, turnId: string) {
  void send(connectionId, { type: "cancel_turn", sessionId, turnId, data: { sessionId, turnId } });
}

export function respondPermission(
  connectionId: ConnectionId,
  sessionId: string,
  turnId: string,
  toolCallId: string,
  allowed: boolean,
  remember: boolean,
  feedback?: string,
) {
  void send(connectionId, {
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
  connectionId: ConnectionId,
  sessionId: string,
  turnId: string,
  toolCallId: string,
  feedback: string,
) {
  respondPermission(connectionId, sessionId, turnId, toolCallId, false, false, feedback.trim() || undefined);
  const server = app.servers[connectionId];
  server?.removeAsk(toolCallId);
}

export function restoreSnapshot(connectionId: ConnectionId, sessionId: string, snapshotId: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "restore_snapshot", sessionId, turnId: "", data: { snapshotId, projectPath } });
}

export function listSnapshots(connectionId: ConnectionId, projectPath: string) {
  void send(connectionId, { type: "list_snapshots", data: { projectPath } });
}

/** Derives a title from a session's first prompt (truncated/whitespace-
 * collapsed) and pushes it via set_session_title — the backend never
 * generates one itself (SPEC.md §3.1). Only meaningful the first time a
 * session gets a message; harmless to call again; the server just overwrites. */
export function setSessionTitle(connectionId: ConnectionId, sessionId: string, title: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_session_title", data: { sessionId, title, projectPath } });
}

/** Optimistic: without this, the archive button in the chat list appeared to
 * do nothing until the server's session_updated (§3.2) round-tripped back —
 * this applies the flag locally right away, same shape as that handler in
 * state.svelte.ts, which still applies when the real response lands. */
export function setSessionArchived(connectionId: ConnectionId, sessionId: string, archived: boolean) {
  const server = app.servers[connectionId];
  const project = server?.projectBySession[sessionId];
  if (server && project && server.sessionsByProject[project]) {
    server.sessionsByProject[project] = server.sessionsByProject[project].map((s) =>
      s.sessionId === sessionId ? { ...s, archived } : s,
    );
  }
  void send(connectionId, { type: "set_session_archived", data: { sessionId, archived, projectPath: project } });
}

/** Pairs (or, with `null`, unpairs) `sessionId`'s split/sidebar layout
 * (§3.1 set_session_layout) — server-persisted so it survives a reload or
 * shows up on another device, unlike the plain UI state in
 * ServerState.showInSidePanel. Optimistic, same pattern as setSessionArchived. */
export function setSessionLayout(connectionId: ConnectionId, sessionId: string, linkedSessionId: string | null) {
  const server = app.servers[connectionId];
  const project = server?.projectBySession[sessionId];
  if (server && project && server.sessionsByProject[project]) {
    server.sessionsByProject[project] = server.sessionsByProject[project].map((s) =>
      s.sessionId === sessionId ? { ...s, linkedSessionId: linkedSessionId ?? undefined } : s,
    );
  }
  void send(connectionId, { type: "set_session_layout", data: { sessionId, linkedSessionId, projectPath: project } });
}

/** Permanently deletes a persisted session (§3.1 delete_session) — unlike
 * setSessionArchived this isn't reversible, so no optimistic local removal:
 * wait for the server's `session_deleted` (state.svelte.ts) before dropping
 * it from the UI. */
export function deleteSession(connectionId: ConnectionId, sessionId: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "delete_session", data: { sessionId, projectPath } });
}

/** Opens `sessionId` in the right sidebar (button on a session row — see
 * Sidebar.svelte / ProjectGroup.svelte) and, the first time these two
 * sessions are shown together, saves the pairing server-side (§3.1
 * set_session_layout) so it's still there — and auto-reopens (see
 * ServerState.openSession) — after a reload or from another device. */
export function openInSidePanel(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server || !server.canSplitCurrent) return;
  app.activeConnectionId = connectionId; // splits pair sessions of one server
  const main = server.currentSessionId;
  if (main && main !== sessionId && server.splitPartnerFor(main)?.sessionId !== sessionId) {
    setSessionLayout(connectionId, main, sessionId);
  }
  server.ensureSession(sessionId);
  server.showInSidePanel(sessionId);
  if (server.connectionStatus === "connected") {
    getSessionHistory(connectionId, sessionId);
    reassertSessionSettings(connectionId, sessionId);
    listTerminals(connectionId, sessionId);
  }
}

/** Browses the *backend's* filesystem (§3.1) — the only correct way to pick a
 * project folder over a remote/TCP connection, where a native OS dialog on
 * this machine would browse the wrong disk entirely. */
export function listDirectory(connectionId: ConnectionId, path?: string) {
  void send(connectionId, { type: "list_directory", data: { path: path ?? "" } });
}

/** Opens (or reuses) a project on the server without starting a turn — e.g.
 * to validate a folder and list its threads before creating a new one. */
export function openProject(connectionId: ConnectionId, path: string) {
  void send(connectionId, { type: "open_project", data: { path } });
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
export function selectProject(connectionId: ConnectionId, path: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  server.selectProject(path);
  if (server.connectionStatus === "connected") {
    openProject(connectionId, path);
    listSessionsForProject(connectionId, path);
    listFiles(connectionId, path);
  } else {
    server.rememberProject(path);
  }
}

/** A folder picked in the browser, and the server it's on — the palette can
 * switch which server it browses mid-pick. */
export interface PickedFolder {
  connectionId: ConnectionId;
  path: string;
}

let directoryBrowserResolve: ((picked: PickedFolder | null) => void) | null = null;

/** Opens the command palette's folder browser (§3.1 `list_directory`) on
 * the backend's filesystem — used for local and remote connections alike,
 * so there's one picker that always shows the disk the tools actually run
 * on. Resolves with the chosen path, or null if cancelled. Tags
 * `app.browsingConnectionId` so a late response from an abandoned browse
 * against a different server can't clobber a newer one (see
 * ServerState.handleEvent's directory_list case). */
function pickFolder(connectionId: ConnectionId): Promise<PickedFolder | null> {
  resolveDirectoryBrowser(null); // a browse already in flight is superseded
  return new Promise((resolve) => {
    directoryBrowserResolve = resolve;
    app.directoryListing = null;
    app.browsingConnectionId = connectionId;
    listDirectory(connectionId);
    app.openPalette("browse");
  });
}

/** Called by CommandPalette.svelte when the user confirms a folder or the
 * browse page goes away. A no-op when no browse is pending. */
export function resolveDirectoryBrowser(path: string | null) {
  const resolve = directoryBrowserResolve;
  const connectionId = app.browsingConnectionId;
  directoryBrowserResolve = null;
  app.browsingConnectionId = null;
  resolve?.(path && connectionId ? { connectionId, path } : null);
}

/** Whether a pickFolder() caller is waiting on the palette's browse page. */
export function isPickingFolder(): boolean {
  return directoryBrowserResolve !== null;
}

/** Browse for a folder and select it. Returns the chosen path, or null if
 * the user cancelled. */
export async function pickProjectFolder(connectionId: ConnectionId): Promise<PickedFolder | null> {
  const picked = await pickFolder(connectionId);
  if (picked) selectProject(picked.connectionId, picked.path);
  return picked;
}

/** The one remaining native-dialog entry point — Settings > Projects'
 * "Browse…", for adding a new path from scratch without switching to it
 * (daily selection goes through the sidebar's dropdown instead). Must still
 * reach the server via `open_project` when connected — the known-projects
 * list is server-persisted now (§4b), so a path only ever remembered
 * locally here would never make it into `projects.json` and so would never
 * show up for another device, or survive this client forgetting its own
 * localStorage. Same connected/offline split as `selectProject`. */
export async function browseAndAddProject(startOn: ConnectionId): Promise<PickedFolder | null> {
  const picked = await pickFolder(startOn);
  if (!picked) return null;
  const { connectionId, path: dir } = picked;
  const server = app.servers[connectionId];
  if (server?.connectionStatus === "connected") {
    server.nextProjectOpenSwitches = false; // "adds without switching to it" — see state.svelte.ts's project_opened handler
    openProject(connectionId, dir);
    listSessionsForProject(connectionId, dir); // so it shows a group immediately, not only once picked (see Sidebar.svelte's projectGroups)
  } else {
    server?.rememberProject(dir);
  }
  return picked;
}

/** Starts a new chat in `projectPath` (default: the current project; with
 * neither, the user picks a folder first). An untouched empty chat that was
 * open is dropped rather than left behind. */
export async function newChat(connectionId: ConnectionId, projectPath?: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  app.activeConnectionId = connectionId;
  let path = projectPath ?? server.currentProjectPath;
  if (!path) {
    const picked = await browseAndAddProject(connectionId);
    if (!picked) return;
    if (picked.connectionId !== connectionId) return newChat(picked.connectionId, picked.path);
    path = picked.path;
  }
  if (path !== server.currentProjectPath) selectProject(connectionId, path);
  const current = server.currentSessionId;
  if (current && (server.messagesBySession[current] ?? []).length === 0) {
    server.discardUnsentSession(current);
  }
  server.newSessionInProject(path);
}

export function listProjects(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_projects", data: {} });
}

/** Drops a path from the server's persisted known-projects list (so it stops
 * coming back on the next list_projects) and cancels/evicts any session
 * still live in it server-side — real teardown, not just a client-side
 * "hide it" (SPEC.md §3.1 remove_project). Paired with the user removing it
 * locally (Settings > Projects) — see ServerState.forgetProject. */
export function removeProject(connectionId: ConnectionId, path: string) {
  void send(connectionId, { type: "remove_project", data: { path } });
}

export function listSessionsForProject(connectionId: ConnectionId, projectPath: string) {
  const server = app.servers[connectionId];
  if (server) server.refreshingProjects[projectPath] = true;
  void send(connectionId, { type: "list_sessions", data: { projectPath } });
}

export function listSessionsForProjects(connectionId: ConnectionId, paths: string[]) {
  for (const path of paths) listSessionsForProject(connectionId, path);
}

/** Fetches the project's file list (§3.1) for @file mention autocomplete. */
export function listFiles(connectionId: ConnectionId, projectPath: string) {
  void send(connectionId, { type: "list_files", data: { projectPath } });
}

export function listProviders(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_providers", data: {} });
}

export function detectCli(connectionId: ConnectionId) {
  void send(connectionId, { type: "detect_cli", data: {} });
}

export function setProvider(connectionId: ConnectionId, sessionId: string, providerName: string, model?: string) {
  // `projectPath` is included for the same reason setSessionTitle and friends
  // send it: a brand-new chat's session isn't bound to its project yet, and
  // the server keeps a *separate* session registry per project (§4b). Omitting
  // it lets the server resolve the session against its default-project
  // fallback, so the provider lands on a different registry than the one the
  // first `user_prompt` (which *does* carry projectPath) later binds to — the
  // turn then runs on an unconfigured session and comes back `no_provider`,
  // clearing this very selection. Sending the session's own project path
  // resolves set_provider into the same registry the prompt will use.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_provider", sessionId, data: { providerName, model, projectPath } });
}

/** Tunes the current provider's request shape for a session's next turn
 * (§3.1) — reasoning effort / thinking budget / context-window override.
 * All three fields are optional; a zero/empty one is left unchanged
 * server-side, not reset, so callers only need to pass what they're
 * actually changing. */
export function setModelOptions(
  connectionId: ConnectionId,
  sessionId: string,
  options: { reasoningEffort?: string; thinkingBudget?: number; contextWindow?: number },
) {
  // projectPath for the same reason setProvider sends it — see there.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_model_options", sessionId, data: { sessionId, ...options, projectPath } });
}

/** Fetches one provider's available models (§3.1) — the model picker's per-
 * provider tabs call this lazily rather than resolving every provider up
 * front. */
export function listModels(connectionId: ConnectionId, providerName: string) {
  void send(connectionId, { type: "list_models", data: { providerName } });
}

/** Replaces one provider's server-persisted favorite-model list (§3.1) — a
 * full replacement, not a single toggle, so callers must send the whole
 * updated set. */
export function setFavoriteModels(connectionId: ConnectionId, providerName: string, models: string[]) {
  void send(connectionId, { type: "set_favorite_models", data: { providerName, models } });
}

/** Switches a session between the four modes (§3.1/§4c), effective on that
 * session's next turn. Sent on every transition — mode is server-persisted
 * and broadcast to every peer, so this is the only place that needs to send
 * it (see state.svelte.ts's `mode_set`/`session_history` handling for the
 * other half: adopting a server-confirmed value, never re-asserting one). */
export function setMode(connectionId: ConnectionId, sessionId: string, mode: ChatMode) {
  // projectPath for the same reason setProvider sends it — see there.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_mode", sessionId, data: { mode, projectPath } });
}

/** Turns web_search/web_fetch on or off for an entire project (§3.1) —
 * independent of mode, persisted server-side, and scoped by projectPath
 * rather than sessionId. */
export function setWebToolsEnabled(connectionId: ConnectionId, projectPath: string, enabled: boolean) {
  void send(connectionId, { type: "set_web_tools_enabled", data: { projectPath, enabled } });
}

/** Answers an outstanding ask_user_question_requested (§3.1) — toolCallId is
 * envelope-level, same correlation rule as permission_response. */
export function askUserAnswer(connectionId: ConnectionId, toolCallId: string, answer: string) {
  void send(connectionId, { type: "ask_user_answer", toolCallId, data: { answer } });
}

export function registerProvider(connectionId: ConnectionId, data: Record<string, unknown>) {
  void send(connectionId, { type: "register_provider", data });
}

export function removeProvider(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "remove_provider", data: { name } });
}

// ---- Peer registry & server settings (§2a/§3.1) ----

/** Pushes this connection's own display name live — every peer (including us)
 * sees it on the next `peer_list` push, so Profile settings and our own
 * roster row stay driven by the same underlying state. */
export function setPeerName(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "set_peer_name", data: { name } });
}

/** Same live-push shape as setPeerName, for the profile picture — `avatar` is
 * either an emoji glyph or an already-96x96 uploaded photo (state.svelte.ts's
 * `profileAvatar`); outgoingAvatarDataUrl (avatar.ts) normalizes either into
 * the 96x96 data URL the wire protocol expects, since the backend does no
 * image processing at all. */
export function setPeerAvatar(connectionId: ConnectionId, avatar: string) {
  void send(connectionId, { type: "set_peer_avatar", data: { avatar: outgoingAvatarDataUrl(avatar) } });
}

/** Force-closes another live connection. Any peer may disconnect any other
 * (§2a) — the confirm step belongs in the UI, not here. */
export function disconnectPeer(connectionId: ConnectionId, peerId: string) {
  void send(connectionId, { type: "disconnect_peer", data: { peerId } });
}

/** Opens or closes the optional TCP listener live. Local-socket-only — the
 * server rejects this over TCP (§3.1). */
export function setRemoteAccess(connectionId: ConnectionId, enabled: boolean) {
  void send(connectionId, { type: "set_remote_access", data: { enabled } });
}

/** Server-wide default for a first `user_prompt` that omits its own
 * `autoGenerateTitle` (§3.1 set_auto_generate_title). Broadcast back to every
 * peer as `auto_generate_title`, same push-only pattern as remote access. */
export function setAutoGenerateTitle(connectionId: ConnectionId, enabled: boolean) {
  void send(connectionId, { type: "set_auto_generate_title", data: { enabled } });
}

/** Rotates the TCP listener's shared auth token. Local-socket-only. */
export function setRemotePassword(connectionId: ConnectionId, password: string) {
  void send(connectionId, { type: "set_remote_password", data: { password } });
}

/** Sets the server's own display name, broadcast to every peer immediately —
 * not a security boundary, so this works over any transport. */
export function setServerIdentity(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "set_server_identity", data: { name } });
}

// ---- Per-person tokens (§3.1) — local-socket-only, like remote-access ----

/** Mints a new named TCP auth credential. Response (`token_registered`)
 * carries the raw token — shown once, per SPEC.md §3.2. */
export function registerToken(connectionId: ConnectionId, name: string, email?: string) {
  void send(connectionId, { type: "register_token", data: { name, email: email || undefined } });
}

export function listTokens(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_tokens", data: {} });
}

export function removeToken(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "remove_token", data: { name } });
}

// ---- Built-in terminal (SPEC.md §3.1/§3.2 terminal_*) ----

/** Starts a brand-new shell bound to `sessionId`. `terminalId` is always
 * client-chosen (state.svelte.ts's registerTerminalTab mints it) — never
 * server-allocated, so the tab can render immediately instead of waiting on
 * a round trip. */
export function terminalOpen(
  connectionId: ConnectionId,
  sessionId: string,
  terminalId: string,
  opts: { cwd?: string; cols: number; rows: number },
) {
  const server = app.servers[connectionId];
  const projectPath = server?.projectBySession[sessionId];
  void send(connectionId, {
    type: "terminal_open",
    sessionId,
    data: { sessionId, projectPath, terminalId, cwd: opts.cwd, cols: opts.cols, rows: opts.rows },
  });
}

/** Subscribes this connection to a terminal that may already be running —
 * opened earlier by this client or another tab/device/peer with this chat
 * open (§3.1). `restartIfExited` is the "reopen this closed tab" action. */
export function terminalAttach(
  connectionId: ConnectionId,
  sessionId: string,
  terminalId: string,
  cols: number,
  rows: number,
  restartIfExited = false,
) {
  void send(connectionId, {
    type: "terminal_attach",
    sessionId,
    data: { sessionId, terminalId, cols, rows, restartIfExited },
  });
}

/** Raw pty input — base64, not a plain JSON string, since terminal I/O isn't
 * guaranteed to be valid UTF-8 (§3.1). */
export function terminalInput(connectionId: ConnectionId, sessionId: string, terminalId: string, bytes: Uint8Array) {
  void send(connectionId, {
    type: "terminal_input",
    sessionId,
    data: { sessionId, terminalId, data: bytesToBase64(bytes) },
  });
}

/** A pane being resized / a split ratio changing — sends SIGWINCH server-side,
 * no response (§3.1). */
export function terminalResize(
  connectionId: ConnectionId,
  sessionId: string,
  terminalId: string,
  cols: number,
  rows: number,
) {
  void send(connectionId, { type: "terminal_resize", sessionId, data: { sessionId, terminalId, cols, rows } });
}

/** Kills the shell and drops the tab for good — unlike the shell exiting on
 * its own, this isn't reopenable via terminal_attach (§3.1). No optimistic
 * local removal, same precedent as deleteSession: wait for the server's
 * terminal_closed (state.svelte.ts). */
export function terminalClose(connectionId: ConnectionId, sessionId: string, terminalId: string) {
  void send(connectionId, { type: "terminal_close", sessionId, data: { sessionId, terminalId } });
}

/** Enumerates every open tab in one chat (§3.1) — call whenever that chat is
 * opened (openChatSession/openInSidePanel below), not once globally, so the
 * tab strip/status icons are populated (and stay current) even before the
 * terminal drawer itself is opened. */
export function listTerminals(connectionId: ConnectionId, sessionId: string) {
  void send(connectionId, { type: "list_terminals", sessionId, data: { sessionId } });
}

// ---- Notifications (§3.1 list_notifications/dismiss_notification) ----

export function listNotifications(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_notifications", data: {} });
}

/** Dismisses one notification, or all of them with no `id` — for every
 * device, the server echoes notification_dismissed to all peers. */
export function dismissNotification(connectionId: ConnectionId, id?: string) {
  // Optimistic: drop it now rather than on the notification_dismissed echo
  // (which then filters the same way, a no-op). A lost request just means it
  // comes back with the next notification_list.
  const server = app.servers[connectionId];
  if (server) server.notifications = id ? server.notifications.filter((n) => n.id !== id) : [];
  void send(connectionId, { type: "dismiss_notification", data: id ? { id } : {} });
}

// ---- Uploads (§3.1 upload_begin/upload_chunk) ----

interface UploadReply {
  received?: number;
  path?: string;
  error?: string;
}

// 512 KB raw is ~700 KB of base64 — far under the 10 MB frame limit, small
// enough that chat traffic interleaves between chunks.
const UPLOAD_CHUNK = 512 * 1024;
const uploadWaiters = new Map<string, { connectionId: ConnectionId; resolve: (r: UploadReply) => void }>();

/** Uploads a client-side file to the server and resolves with its
 * server-side path, for use as a user_prompt attachment. Content-addressed
 * on the server, so a file it already has costs one round trip and no
 * bytes. Each chunk waits for the previous one's ack (flow control).
 * ponytail: reads the whole file into memory to hash it; stream through a
 * hasher if the 256 MB server cap ever makes that hurt. */
export async function uploadFile(
  connectionId: ConnectionId,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  const uploadId = `up-${crypto.randomUUID().slice(0, 8)}`;
  const exchange = (envelope: Envelope) =>
    new Promise<UploadReply>((resolve) => {
      uploadWaiters.set(uploadId, { connectionId, resolve });
      void send(connectionId, envelope);
    });
  try {
    let reply = await exchange({ type: "upload_begin", data: { uploadId, name: file.name, size: bytes.length, sha256 } });
    let offset = 0;
    while (!reply.path && !reply.error) {
      const chunk = bytes.subarray(offset, offset + UPLOAD_CHUNK);
      offset += chunk.length;
      reply = await exchange({ type: "upload_chunk", data: { uploadId, data: bytesToBase64(chunk) } });
      onProgress?.(bytes.length ? offset / bytes.length : 1);
    }
    if (reply.error) throw new Error(reply.error);
    return reply.path!;
  } finally {
    uploadWaiters.delete(uploadId);
  }
}

/** Jumps to the chat a notification is about, if it names one. */
export function openNotificationTarget(connectionId: ConnectionId, n: { sessionId?: string; projectPath?: string }) {
  const server = app.servers[connectionId];
  if (!server || !n.sessionId) return;
  if (n.projectPath && !server.projectBySession[n.sessionId]) server.projectBySession[n.sessionId] = n.projectPath;
  openChatSession(connectionId, n.sessionId);
}

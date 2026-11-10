import { askConfirm } from "./confirm.svelte";
import { chooseMode, sessionModes } from "./modes";
import type { AuditEvent, AuditQuery, ChatMode, Envelope, FileContent, McpServerConfig, McpImportData, FileDiff, GitChange, ModelRole, NotifyPrefs, RuntimeSettings, ServerIcon, ServerStatus, TreeEntry, ContextBreakdown, Origin, ScheduleTrigger, Tier, Caps } from "./types";
import {
  app,
  CHAT_PROJECT,
  ServerState,
  forgetKnownServer,
  loadKnownServers,
  loadServerToken,
  type ConnectionId,
  type KnownServer,
} from "./state.svelte";
import { outgoingAvatarDataUrl } from "./avatar";
import { setAvatarFetcher } from "./avatarCache.svelte";
import { briefOf, continuationDraft } from "./chatBrief";
import { closeAck, connectedHost, isDesktop, invoke, listen, openUrl, pickFiles, quitApp } from "./platform";
import { bytesToBase64, base64ToBytes } from "./base64";
import { decodePairingCode } from "./pairing";
import { isOlder } from "./serverVersion";
import { cancelWebSignIn, startWebSignIn } from "./webSignIn";
import { handleBrowserRequest } from "./browserAgent.svelte";
import { handleServerBrowserEvent } from "./serverBrowser.svelte";
import type { UsageReport } from "./usage";
import { parseThemeFiles } from "./theme";
import { setDiscordRpcStatus } from "./discordRpc.svelte";
import type { DiscordRpcStatus } from "./platform";
import { showChat } from "./viewport.svelte";
import { createRelay } from "./forwardRelay";
import { canRelay, parseVia } from "./forwarding";

let wired = false;
/** Model forwarding: the relay between servers and the offers that tell each what this device reaches. */
const relay = createRelay((connectionId, envelope) => send(connectionId, envelope));

/** Reads the themes folder into `app.customThemes` and re-applies, so an edited active theme updates live.
 * Returns a note for the UI (what was wrong with which file), or null when all is well. */
export async function loadCustomThemes(): Promise<string | null> {
  try {
    const { themes, problems } = parseThemeFiles(await invoke("load_themes"));
    app.customThemes = themes;
    app.applySettings();
    return problems.length ? `Skipped ${problems.join("; ")}` : null;
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  }
}

/** A file inside the themes folder (seeded with an example if empty), so revealing it opens the folder. */
export async function themesRevealPath(): Promise<string> {
  return invoke<string>("themes_reveal_path");
}

/** An agent in the public ACP registry that the app can launch (npx or uvx). */
export interface AcpRegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  website?: string;
  npx?: { package: string; args?: string[] };
  uvx?: { package: string; args?: string[] };
}

/** The desktop fetches it in its main process; the browser build asks the server (list_acp_registry). */
export async function acpRegistry(connectionId?: ConnectionId): Promise<AcpRegistryAgent[]> {
  if (isDesktop || !connectionId) return invoke<AcpRegistryAgent[]>("acp_registry");
  const r = await rpc<{ agents?: AcpRegistryAgent[]; error?: string }>(connectionId, "list_acp_registry", {});
  if (r.error) throw new Error(r.error);
  return r.agents ?? [];
}

// --- Liveness (§2a) ---
// A dead network path often produces no read error at all, so instead of only reacting to a
// socket close, we track the last time we heard anything from the backend and treat prolonged
// silence as dead. Keyed per connection so each live connection watches/retries independently.
const LIVENESS_TIMEOUT_MS = 60_000; // comfortably < the backend's own ~90s cutoff
const WATCHDOG_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Backoff starts over only once a connection has stayed up this long (see afterConnect).
const STABLE_MS = 30_000;

interface LivenessState {
  lastActivityAt: number;
  watchdogTimer?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

const liveness = new Map<ConnectionId, LivenessState>();
const stableTimers = new WeakMap<ServerState, ReturnType<typeof setTimeout>>();

function startLiveness(connectionId: ConnectionId) {
  stopLiveness(connectionId);
  const state: LivenessState = { lastActivityAt: Date.now() };
  liveness.set(connectionId, state);
  state.watchdogTimer = setInterval(() => {
    const server = app.servers[connectionId];
    if (server?.connectionStatus === "connected" && Date.now() - state.lastActivityAt > LIVENESS_TIMEOUT_MS) {
      void invoke("disconnect", { connectionId }).catch(() => {
        // best-effort, we're about to treat the connection as dead either way
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

/** Retries a dropped connection with backoff, using its in-memory ConnectParams. */
function scheduleReconnect(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (!server) return;
  let state = liveness.get(connectionId);
  if (!state) {
    state = { lastActivityAt: Date.now() };
    liveness.set(connectionId, state);
  }
  clearTimeout(state.reconnectTimer);
  const attempt = server.reconnectAttempt++;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  state.reconnectTimer = setTimeout(() => {
    const s = app.servers[connectionId];
    if (!s || s.connectionStatus === "connected" || s.connectionStatus === "connecting") return;
    app.log(`reconnecting to ${s.label} (attempt ${attempt + 1})…`);
    void redial(connectionId);
  }, delay);
}

/** Fails what waits on this connection's replies: they will never come on a dead connection. */
function failWaiters(connectionId: ConnectionId, reason: string) {
  for (const w of uploadWaiters.values()) {
    if (w.connectionId === connectionId) w.resolve({ error: reason });
  }
  for (const w of rpcWaiters.values()) {
    if (w.connectionId === connectionId) w.reject(new Error(reason));
  }
}

function handleConnectionLost(connectionId: ConnectionId, reason: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  stopLiveness(connectionId);
  clearTimeout(stableTimers.get(server));
  // A fatal error arrived first (the server refused this connection, e.g. a revoked token): keep its
  // message, and don't redial into the same refusal.
  const refused = server.connectionStatus === "error";
  if (!refused) {
    server.connectionStatus = "disconnected";
    server.connectionError = reason;
  }
  relay.dropConnection(connectionId);
  relay.syncOffers();
  app.log(`disconnected: ${reason}`);
  server.clearAllSessionSyncing();
  server.pendingAsks = [];
  server.forgetQueuedPrompts();
  server.turnsLostOnDrop = server.endRunningTurns();
  failWaiters(connectionId, "connection lost before the server replied");
  if (!refused) scheduleReconnect(connectionId);
}

/** Every connect gets a new ConnectionId, so this re-keys the existing ServerState under it
 * instead of replacing it, keeping session/project/history state across a drop. */
async function redial(oldConnectionId: ConnectionId) {
  const server = app.servers[oldConnectionId];
  if (!server) return;
  const params = server.connectParams;
  server.connectionStatus = "connecting";
  try {
    // A daemon that stopped (a restart, a crash) is started again, as the app does at launch.
    if (isDesktop && params.mode === "local" && !(await probeUnix(params.socketPath))) {
      await spawnDetachedUnixServer({ binPath: "yoakeland", socketPath: params.socketPath });
      for (let i = 0; i < 25 && !(await probeUnix(params.socketPath)); i++) await new Promise((r) => setTimeout(r, 200));
    }
    const newConnectionId =
      params.mode === "local"
        ? await invoke<string>("connect_unix", { path: params.socketPath, ...peerIdentity() })
        : await invoke<string>("connect_tcp", {
            host: params.host,
            port: params.port,
            token: params.token,
            caPem: params.caPem || undefined,
            ...(!isDesktop && params.rtcFp ? { rtcFp: params.rtcFp } : {}),
            ...peerIdentity(),
          });
    // Removed or disconnected while the connect was in flight: don't bring it back.
    if (app.servers[oldConnectionId] !== server || server.connectionStatus !== "connecting") {
      void invoke("disconnect", { connectionId: newConnectionId }).catch(() => {});
      return;
    }
    delete app.servers[oldConnectionId];
    stopLiveness(oldConnectionId); // oldConnectionId is retired, afterConnect(newConnectionId) starts fresh tracking
    server.connectionId = newConnectionId;
    server.connectionStatus = "connected";
    server.connectionError = null;
    // Whatever the last connection said about the server may no longer hold; the identity says it again.
    server.features = [];
    server.forwardGrants = [];
    server.forwardGrantsLoaded = false;
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
  if (wired) return;
  wired = true;

  listen<{ connectionId: string; envelope: Envelope }>("yoake-event", (payload) => {
    const { connectionId, envelope: env } = payload;
    const server = app.servers[connectionId];
    if (!server) return; // stale event from a connection we no longer track
    touchActivity(connectionId);
    if (relay.handle(connectionId, env)) return;
    if (env.type === "ping") {
      // Echo the nonce back; the ping also carries the status bar's server snapshot.
      const data = env.data as { nonce?: string; status?: ServerStatus } | undefined;
      if (data?.status) {
        server.serverStatus = data.status;
        if (data.status.features) server.features = data.status.features;
        relay.syncOffers();
        askGrants(server);
      }
      void send(connectionId, { type: "pong", data: { nonce: data?.nonce } });
      return;
    }
    if (env.type === "upload_progress" || env.type === "upload_done") {
      const data = env.data as unknown as UploadReply & { uploadId: string };
      uploadWaiters.get(data.uploadId)?.resolve(data);
      return;
    }
    if (env.type === "openrouter_oauth_url") {
      oauthUrlWaiters.get(connectionId)?.(env.data as { requestId: string; url: string });
      return;
    }
    if (env.type === "mcp_oauth_url") {
      mcpOauthWaiters.get(connectionId)?.(env.data as { requestId: string; url: string });
      return;
    }
    if (handleServerBrowserEvent(connectionId, env.type, env.data)) return;
    if (env.type === "browser_request") {
      void handleBrowserRequest(connectionId, env.data as never, (data) => void send(connectionId, { type: "browser_response", data: data as Record<string, unknown> }));
      return;
    }
    const requestId = (env.data as { requestId?: string } | undefined)?.requestId;
    const waiter = requestId ? rpcWaiters.get(requestId) : undefined;
    if (waiter) {
      waiter.resolve(env.data!);
      return;
    }
    // A queued prompt being merged (sendPrompt): withdrawn, it goes out again as one prompt with
    // what was appended; if the withdrawal lost the race and it started, the rest goes on its own.
    const merging =
      (env.type === "turn_completed" || env.type === "turn_started") && env.sessionId
        ? server.queuedBySession[env.sessionId]?.find((q) => q.turnId === env.turnId && q.append && !q.withdrawing)
        : undefined;
    server.handleEvent(env);
    // A chat's real directory is only in session summaries; ask once its first output exists.
    if ((env.type === "tool_result" || env.type === "turn_completed") && env.sessionId) learnChatRoot(connectionId, server, env.sessionId);
    if (env.type === "steer_rejected" && env.sessionId) sendPrompt(connectionId, env.sessionId, (env.data as { prompt: string }).prompt);
    // A long reply gets its summary card; a short one is its own summary.
    if (env.type === "turn_completed" && env.sessionId && app.settings.autoSummary) {
      const done = env.data as { finishReason?: string };
      const msg = done.finishReason === "stop" ? server.messagesBySession[env.sessionId]?.find((m) => m.turnId === env.turnId && m.role === "assistant") : undefined;
      if (msg && msg.text.length >= AUTO_SUMMARY_CHARS && !msg.summary && !server.summaryPending[msg.id]) {
        server.summaryPending[msg.id] = "auto";
        summarizeMessage(connectionId, env.sessionId, msg.id);
      }
    }
    if (merging?.append && env.sessionId) {
      const started = env.type === "turn_started";
      sendPrompt(
        connectionId,
        env.sessionId,
        started ? merging.append.text : `${merging.text}\n\n${merging.append.text}`,
        started ? merging.append.attachments : [...(merging.attachments ?? []), ...(merging.append.attachments ?? [])],
      );
    }

    // The saved chat list a project was restored with can be stale (afterConnect runs before it
    // is restored, and the sidebar only fetches projects it holds nothing for), so once per
    // connection ask for every project's real list. A chat made since the cache was last saved,
    // or on another device, only shows up this way.
    if (env.type === "project_list" && !projectsRefreshed.has(connectionId)) {
      projectsRefreshed.add(connectionId);
      listSessionsForProjects(connectionId, server.recentProjects);
    }

    // Owner-only events: a paired-device (restricted) connection would just get an error. A Trusted
    // person may run schedules too; they only see their own.
    if (env.type === "server_identity") {
      relay.syncOffers();
      askGrants(server);
      if (server.canAdmin) void listScheduled(connectionId);
      if (server.user && server.canAdmin) listPeople(connectionId);
      // This device's local profile only fills a person who has none: a reconnect never overwrites.
      const u = server.user;
      if (u && !u.name && !u.avatar && app.settings.profileName && !seededProfile.has(`${connectionId}:${u.id}`)) {
        seededProfile.add(`${connectionId}:${u.id}`);
        setProfile(connectionId, { name: app.settings.profileName, avatar: app.settings.profileAvatar || undefined });
      }
    }

    // provider_registered only carries {name}, not the full roster, so refetch it.
    if (env.type === "provider_registered") {
      listProviders(connectionId);
    }
  });

  listen("yoake-themes-changed", () => void loadCustomThemes());
  listen<DiscordRpcStatus>("yoake-discord-status", setDiscordRpcStatus);
  listen<KeyboardEventInit>("yoake-guest-key", (k) => window.dispatchEvent(new KeyboardEvent("keydown", { ...k, cancelable: true })));
  listen<{ connectionId: string; message: string }>("yoake-log", (p) => app.log(p.message));

  listen("yoake-close-requested", () => void closeApp());
  // Coming back to the app is the usual moment after installing or signing in to a CLI in a terminal.
  let lastFocusDetect = 0;
  window.addEventListener("focus", () => {
    if (Date.now() - lastFocusDetect < 10_000) return;
    lastFocusDetect = Date.now();
    for (const s of Object.values(app.servers)) if (s.connectionStatus === "connected") detectCli(s.connectionId);
  });
  listen<{ connectionId: string; reason: string }>("yoake-disconnected", (p) => {
    handleConnectionLost(p.connectionId, p.reason);
  });
}

const projectsRefreshed = new Set<ConnectionId>();

export async function send(connectionId: ConnectionId, envelope: Envelope) {
  try {
    await invoke("send_envelope", { connectionId, envelope });
  } catch (err) {
    // Most callers fire-and-forget (`void send(...)`), so log instead of throwing an unhandled rejection.
    app.log(`send failed: ${err}`);
  }
}

async function probeUnix(path: string): Promise<boolean> {
  return invoke("probe_unix", { path });
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

/** The desktop picks the release with a binary for its own platform; a browser can't know the server's, so it takes the newest. */
const latestServerRelease = (): Promise<{ version: string }> =>
  isDesktop
    ? invoke("server_latest_release")
    : fetch("https://api.github.com/repos/yoakeland-dev/yoakeland-server/releases?per_page=1", { headers: { accept: "application/vnd.github+json" } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub answered ${r.status}`))))
        .then(([rel]) => ({ version: String(rel.tag_name).replace(/^v/, "") }));

const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
let updateTimer: ReturnType<typeof setInterval> | undefined;
/** Looks up the newest server and app releases now and every few hours after, so a long-running
 * app still hears of new ones and an offline start just tries again later. Newly connected servers
 * compare themselves against the cached version when their identity arrives (announceOutdated). */
function startUpdateChecks() {
  if (updateTimer) return;
  const run = () => {
    latestServerRelease().then(
      (r) => {
        app.latestServerVersion = r.version;
        for (const s of Object.values(app.servers)) s.announceOutdated();
      },
      () => {}, // offline or no release yet: nothing to flag
    );
    if (!isDesktop) return; // the hosted page is always the newest app
    invoke<{ version: string; url: string; install: "download" | "package" } | null>("app_latest_release").then((r) => {
      const fresh = r && isOlder(__APP_VERSION__, r.version) ? r : null;
      if (fresh && fresh.version !== app.appUpdate?.version) {
        const action = fresh.install === "download" ? { label: "Download", run: () => void openUrl(fresh.url) } : undefined;
        const how = fresh.install === "download" ? "" : " Update it with your package manager.";
        app.toastAction(app.activeConnectionId ?? "", `yoakeland v${fresh.version} is available.${how}`, action);
      }
      app.appUpdate = fresh;
    }, () => {});
  };
  run();
  updateTimer = setInterval(run, UPDATE_CHECK_MS);
}

/** Downloads the newest server. A running daemon keeps its old binary until it is restarted. */
/** Early channel, first run: copies stable's data (or just starts empty), after which the local server can start. */
export const copyStableData = (copy: boolean) => invoke("stable_copy_run", { copy });

export async function installServer(): Promise<string> {
  const r = await invoke<{ version: string }>("server_install");
  app.latestServerVersion = r.version;
  return r.version;
}

async function updateServer(connectionId: ConnectionId) {
  try {
    const v = await installServer();
    app.toastAction(connectionId, `Downloaded server v${v}. Restarting it…`);
    restartServer(connectionId);
  } catch (err) {
    app.toastAction(connectionId, `Server update failed: ${err}`);
  }
}

/** Stops the local daemon so it comes back as the newest installed binary (redial starts it again).
 * It refuses while chats are running unless forced; the server_restart answer says which. */
export function restartServer(connectionId: ConnectionId, force = false) {
  void send(connectionId, { type: "restart_server", data: { force: force || undefined } });
}
/** The window was closed with "Stop the server when closing" on: confirm if work is running, stop
 * the local server, then quit. Cancelling leaves the app open. */
async function closeApp() {
  void closeAck();
  const local = Object.values(app.servers).find((s) => s.connectionMode === "local" && s.connectionStatus === "connected");
  if (local) {
    const chats = Object.values(local.activeTurnBySession).filter(Boolean).length;
    const terminals = Object.values(local.terminalById).filter((t) => t.status === "running" || t.status === "starting").length;
    const running = [
      chats && `${chats} chat${chats === 1 ? " is" : "s are"} running`,
      terminals && `${terminals} terminal${terminals === 1 ? " is" : "s are"} open`,
    ].filter(Boolean);
    if (running.length && !(await askConfirm(`${running.join(" and ")}. Closing stops the server and everything running in it.`))) return;
    // Force: the confirmation above was the "busy" answer. The daemon drops every connection as it exits.
    await send(local.connectionId, { type: "restart_server", data: { force: true } });
    // The daemon drops us as it exits. If it doesn't (a server older than restart_server), say so
    // rather than quitting and leaving it running as if the setting had worked.
    for (let i = 0; i < 40 && local.connectionStatus === "connected"; i++) await new Promise((r) => setTimeout(r, 50));
    if (local.connectionStatus === "connected" && !(await askConfirm("The server didn't stop. It may need updating. Quit anyway?"))) return;
  }
  await quitApp();
}

if (isDesktop) app.updateServer = (id) => void updateServer(id);
app.answerPairing = (id, credential, allow) => answerPairing(id, credential, allow);
app.restartServer = (id, force) => restartServer(id, force);
app.refreshChatHistory = (id, sessionId) => getSessionHistory(id, sessionId);

function afterConnect(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (!server) return;
  startLiveness(connectionId);
  clearTimeout(stableTimers.get(server));
  stableTimers.set(server, setTimeout(() => (server.reconnectAttempt = 0), STABLE_MS));
  listProjects(connectionId);
  listProviders(connectionId);
  relay.syncOffers();
  askGrants(server);
  server.modelsAsked.clear(); // a reconnect (or restarted server) is worth one fresh try per provider
  detectCli(connectionId);
  listNotifications(connectionId);
  // The sidebar groups sessions across every saved project, not just the currently open one.
  void listSessionsForProjects(connectionId, [CHAT_PROJECT, ...server.recentProjects]);
  if (server.currentProjectPath) listFiles(connectionId, server.currentProjectPath);
  if (server.canAdmin) listTokens(connectionId);
  // Only the desktop app has a browser panel the agent can drive (§3.2 browser_host).
  if (isDesktop) void send(connectionId, { type: "browser_host", data: { enabled: true } });
  // Reconcile the chats on screen, and any a turn was running in when the connection dropped (its
  // outcome is only in history now), against server history. Fetching also resubscribes to their live events.
  for (const sessionId of new Set([server.currentSessionId, server.sidebarSessionId, ...server.turnsLostOnDrop])) {
    if (sessionId) getSessionHistory(connectionId, sessionId);
  }
  server.turnsLostOnDrop = [];
  if (server.currentSessionId) listTerminals(connectionId, server.currentSessionId);
}

const grantsAsked = new Set<ConnectionId>();
/** Asks a forwarding-capable server which servers may use its providers: once per connection, and
 * only once its feature list is known, so an older server never sees the event. */
function askGrants(server: ServerState) {
  if (!canRelay(server) || grantsAsked.has(server.connectionId)) return;
  grantsAsked.add(server.connectionId);
  void send(server.connectionId, { type: "list_forward_grants", data: {} });
}

/** Lets `borrower` use the `via:` provider `providerName` on the server that lends it. Resolves once the
 * lender has been told (at once when it already knows). Call this ONLY from the model picker's own pick
 * handler, where the person chose that row. Never from an automatic path (resuming a chat, seeding a new
 * one, anything driven by a server event): the borrowing server controls those names, and a grant sent
 * there would hand it the person's provider, or quietly undo a Revoke. */
export async function grantForwarding(borrower: ServerState, providerName: string): Promise<void> {
  const via = parseVia(providerName);
  const lender = via && Object.values(app.servers).find((s) => s.serverId === via.serverId && canRelay(s));
  if (!via || !lender || !borrower.serverId) return;
  if (lender.forwardGrants.some((g) => g.serverId === borrower.serverId && g.providerName === via.name)) return;
  lender.forwardGrants = [...lender.forwardGrants, { serverId: borrower.serverId, serverName: borrower.label, providerName: via.name }];
  await send(lender.connectionId, { type: "forward_grant", data: { serverId: borrower.serverId, serverName: borrower.label, providerName: via.name } });
}

/** Withdraws a borrowing server's use of a provider (`providerName` is the lender's own name for it). */
export function revokeForwardGrant(lenderConnectionId: ConnectionId, serverId: string, providerName: string) {
  void send(lenderConnectionId, { type: "forward_revoke", data: { serverId, providerName } });
  const lender = app.servers[lenderConnectionId];
  if (lender) lender.forwardGrants = lender.forwardGrants.filter((g) => !(g.serverId === serverId && g.providerName === providerName));
}

const seededProfile = new Set<string>();

/** Self-reported identity sent on the opt-in `auth` frame (§2a), sourced from Settings > Profile.
 * One identity shared across every server, not per-connection, so this takes no connectionId. */
function peerIdentity() {
  return {
    name: app.settings.profileName || undefined,
    deviceType: isDesktop ? ("desktop" as const) : ("web" as const),
    avatar: app.settings.profileAvatar ? outgoingAvatarDataUrl(app.settings.profileAvatar) : undefined,
    deviceId: thisDeviceId(),
  };
}

/** This install's stable id (§2a auth `deviceId`), made once, so servers can tell devices apart. */
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

export async function importCaCertFile(): Promise<string | null> {
  const [path] = await pickFiles({ title: "Locate the server's ca.pem" });
  if (!path) return null;
  return invoke<string>("read_text_file", { path });
}

/** `rtcFp` is only for the browser build: it picks WebRTC over a WebSocket (rtc.ts). The desktop
 * app speaks TLS to the server directly and pins `caPem` instead. */
export async function connectTcp(host: string, port: number, token: string, caPem?: string, rtcFp?: string, alternates?: string[]): Promise<ConnectionId> {
  app.setPendingConnect("connecting", "remote");
  try {
    const connectionId = await invoke<string>("connect_tcp", {
      host,
      port,
      token,
      caPem: caPem || undefined,
      ...(!isDesktop && rtcFp ? { rtcFp, alternates } : {}),
      ...peerIdentity(),
    });
    // Of several addresses the one that answered is the one to remember and redial.
    host = connectedHost(connectionId) ?? host;
    const server = new ServerState(connectionId, app, { mode: "remote", host, port, token, caPem, rtcFp });
    app.servers[connectionId] = server;
    // A bad token isn't refused while connecting: it comes back as a fatal error. Left in place, the
    // dead connection would keep the active slot and redial with the same token forever.
    const refused = await authVerdict(server);
    if (refused) {
      await invoke("disconnect", { connectionId }).catch(() => {});
      await removeServer(connectionId);
      throw new Error(refused);
    }
    // Only takes the active slot if nothing else holds it, so adding a background server doesn't steal focus.
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

/** Pairs with a server by the PIN it printed, then connects with the credential that gives
 * (desktop only: the exchange needs the TLS connection's exporter, which a browser can't read). */
export async function pairAndConnect(host: string, port: number, pin: string): Promise<ConnectionId> {
  app.setPendingConnect("connecting", "remote");
  let paired: { token: string; caPem: string };
  try {
    paired = await invoke<{ token: string; caPem: string }>("pair_tcp", { host, port, pin, ...peerIdentity() });
  } catch (err) {
    app.setPendingConnect("error", "remote", String(err));
    throw err;
  }
  return connectTcp(host, port, paired.token, paired.caPem || undefined);
}

/** The error a remote refused with, or null once it identified itself (or stayed quiet, as an old server may). */
async function authVerdict(server: ServerState): Promise<string | null> {
  // A pairing token waits for someone at the desktop to say yes, so that can take a minute.
  for (let waited = 0; waited < (server.awaitingApproval ? 70_000 : 4000); waited += 50) {
    if (server.serverId) return null;
    if (server.connectionStatus === "error") return server.connectionError ?? "authentication failed";
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** Never assume the UI owns the server's lifecycle: connect if something's already listening
 * (no token needed, the socket's OS permissions cover that), otherwise launch one detached. */
export async function connectLocalUnix(opts: SpawnUnixServerOpts): Promise<ConnectionId> {
  app.setPendingConnect("connecting", "local");
  try {
    const alreadyRunning = await probeUnix(opts.socketPath);
    if (!alreadyRunning) {
      app.log(`no server on ${opts.socketPath}, launching one`);
      await spawnDetachedUnixServer(opts);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 60));
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

// Asks the backend: the page can't read the environment variables involved.
export async function getDefaultSocketPath(): Promise<string> {
  try {
    return await invoke<string>("default_socket_path");
  } catch {
    return FALLBACK_SOCKET_PATH;
  }
}

/** A phone scanning the desktop's QR code lands on `https://host:port/#pair=<code>` (pairing.ts).
 * Connects with it and drops the fragment from the address bar and history so the token isn't left
 * lying around. Returns the new connection, or null if there was nothing to do or it failed (the
 * connect form then shows the error with the host filled in). */
async function connectFromUrl(): Promise<ConnectionId | null> {
  if (isDesktop || !location.hash.startsWith("#pair=")) return null;
  const code = decodePairingCode(location.hash.slice("#pair=".length));
  history.replaceState(null, "", location.pathname + location.search);
  if (!code) return null;
  // A code with an address was made for a page that isn't served by the server (the hosted app);
  // one without opened the server's own page.
  if (code.host && code.port && code.rtcFp) {
    // The address came with the link, so say where it leads before this browser pairs with it.
    if (!(await askConfirm(`Connect to ${code.host}:${code.port} and save it as a server? Only if you opened this link yourself.`))) return null;
    return connectTcp(code.host, code.port, code.token, undefined, code.rtcFp, code.hosts).catch(() => null);
  }
  return connectTcp(location.hostname, Number(location.port) || 443, code.token).catch(() => null);
}

/** Called once on startup. Default local socket connects first to win the active slot, then
 * every remembered server in parallel. A remote with no remembered token stays listed until
 * connected by hand; if nothing connects, FirstServerPanel takes over. */
export async function autoConnect() {
  const socketPath = isDesktop ? await getDefaultSocketPath() : "";
  const channelSockets = isDesktop ? await invoke<string[]>("channel_socket_paths").catch(() => []) : [];
  startUpdateChecks();
  // A first run on the early channel starts its server only after Onboarding's copy step, as a running server holds its state in memory.
  if (isDesktop && !app.settings.onboarded) app.stableCopyPending = await invoke<boolean>("stable_copy_pending").catch(() => false);
  if (isDesktop && !app.stableCopyPending) await connectLocalUnix({ binPath: "yoakeland", socketPath }).catch(() => {});
  const pairedId = await connectFromUrl();
  const pairedServerId = pairedId ? app.servers[pairedId]?.serverId : undefined;
  await Promise.allSettled(
    loadKnownServers().map(async (k) => {
      if (k.serverId === pairedServerId) return;
      if (k.mode === "local") {
        // The other release channel's own server isn't this app's to dial; only a custom socket is.
        if (isDesktop && k.socketPath && k.socketPath !== socketPath && !channelSockets.includes(k.socketPath)) {
          await connectLocalUnix({ binPath: "yoakeland", socketPath: k.socketPath });
        }
        return;
      }
      const token = await loadServerToken(k.serverId);
      if (!token || !k.host || !k.port) return;
      const ca = app.settings.trustedCaByServer[k.serverId] ?? app.settings.trustedCaByHostPort[caServerKey(k.host, k.port)];
      await connectTcp(k.host, k.port, token, ca, k.rtcFp);
    }),
  );
  // A failed background attempt shouldn't leave its error showing once something else connected.
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
    server.forgetQueuedPrompts();
    server.turnsLostOnDrop = server.endRunningTurns();
  }
  relay.dropConnection(connectionId);
  relay.syncOffers();
  failWaiters(connectionId, "disconnected before the server replied");
}

/** Unlike disconnect(), also forgets the server, so it stops being offered
 * for reconnect. */
export async function removeServer(connectionId: ConnectionId) {
  const server = app.servers[connectionId];
  if (server?.connectionStatus === "connected" || server?.connectionStatus === "connecting") {
    await disconnect(connectionId);
  } else {
    stopLiveness(connectionId);
  }
  delete app.servers[connectionId];
  relay.syncOffers();
  if (server?.serverId) forgetKnownServer(server.serverId);
  if (app.activeConnectionId === connectionId) {
    app.activeConnectionId = Object.keys(app.servers)[0] ?? null;
  }
}

/** One row per server the user could act on: every live/dead connection in
 * app.servers, then remembered ones (KnownServer) that aren't among them.
 * Shared by the palette's Servers page and Settings > Servers.
 * loadKnownServers() reads localStorage, so callers re-derive after
 * forgetting one. */
export interface ServerRow {
  key: string;
  connectionId?: ConnectionId;
  known?: KnownServer;
  /** serverId once known: ServerAvatar's color seed. */
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

/** Switch to a live server, redial a dead one, connect a remembered socket/token, or
 * failing that (no token, or rejected) open Settings' add-server form prefilled to re-pair. */
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
    const id = token ? await connectTcp(k.host, k.port, token, ca, k.rtcFp).catch(() => null) : null;
    if (id) app.activeConnectionId = id;
    else app.openAddServer(k.host, k.port);
  }
}

// ---- Convenience wrappers for outbound events (§3.1) ----

/** `attachments` are absolute paths on the server's machine: a local file's own path, or what `uploadFile` returned. */
export function sendPrompt(connectionId: ConnectionId, sessionId: string, prompt: string, attachments?: string[]): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  const server = app.servers[connectionId];
  if (!server) return turnId;
  // A new chat's mode is seeded locally from lastUsedMode (ensureSession) without telling the
  // server, which defaults to read_write: the picker said Run while every bash call still
  // asked. Assert it before the first prompt; envelopes are handled in order, so it lands first.
  if (!server.messagesBySession[sessionId]?.length) {
    setMode(connectionId, sessionId, server.modeBySession[sessionId] ?? "read_write");
  }
  // Follow-ups merge into the one already waiting rather than stacking up as separate turns:
  // that one is withdrawn and goes out again with these appended (see the turn_completed hook).
  const waiting = server.queuedBySession[sessionId]?.at(-1);
  if (waiting && !waiting.withdrawing) {
    const append = waiting.append;
    waiting.append = {
      text: [append?.text, prompt].filter(Boolean).join("\n\n"),
      attachments: [...(append?.attachments ?? []), ...(attachments ?? [])],
    };
    if (!append) void send(connectionId, { type: "cancel_turn", sessionId, turnId: waiting.turnId, data: { sessionId, turnId: waiting.turnId, queuedOnly: true } });
    return waiting.turnId;
  }
  // Mid-turn, the server holds it until the running turn ends (turn_started).
  if (server.activeTurnBySession[sessionId] || server.queuedBySession[sessionId]) server.queuePrompt(sessionId, turnId, prompt, attachments);
  else server.addUserMessage(sessionId, turnId, prompt, attachments);
  // Always included: a session is permanently bound to one project (§4b), so this never conflicts.
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
      // Persisted with the message so it still renders after a history reload. Sent raw (not through
      // outgoingAvatarDataUrl) so the stored copy matches the live bubble and an emoji stays small.
      authorName: app.settings.profileName || undefined,
      authorAvatar: app.settings.profileAvatar || undefined,
      attachments: attachments?.length ? attachments : undefined,
    },
  });
  // No client-side title: the backend pushes its generated one as an unprompted session_updated.
  return turnId;
}

/** SPEC.md §3.1 steer_turn: puts a message into the turn that is running, for an agent that can take one
 * while it works. False when no turn is running. steer_rejected (an agent that can't) comes back through
 * handleEnvelope, which sends the text as an ordinary, queued prompt. */
export function steerPrompt(connectionId: ConnectionId, sessionId: string, prompt: string): boolean {
  const server = app.servers[connectionId];
  const turnId = server?.activeTurnBySession[sessionId];
  if (!server || !turnId) return false;
  server.addSteering(sessionId, prompt);
  void send(connectionId, {
    type: "steer_turn",
    sessionId,
    turnId,
    data: {
      sessionId,
      turnId,
      prompt,
      projectPath: server.projectBySession[sessionId],
      authorName: app.settings.profileName || undefined,
      authorAvatar: app.settings.profileAvatar || undefined,
    },
  });
  return true;
}

/** SPEC.md §3.1 edit_message: replaces a past user message's content and regenerates from there. */
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

/** SPEC.md §3.1 retry_message: discards a past assistant message and regenerates from that point. */
export function retryMessage(connectionId: ConnectionId, sessionId: string, messageId: string): string {
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  const server = app.servers[connectionId];
  if (!server) return turnId;
  server.beginRetry(sessionId, turnId, messageId);
  void send(connectionId, { type: "retry_message", sessionId, turnId, data: { sessionId, messageId } });
  return turnId;
}

/** SPEC.md §3.1 switch_branch: pure navigation, no model call, swaps in the branch containing `messageId`. */
export function switchBranch(connectionId: ConnectionId, sessionId: string, messageId: string) {
  void send(connectionId, { type: "switch_branch", sessionId, turnId: "", data: { sessionId, messageId } });
}

/** Puts `sessionId`'s composer into "editing" mode for `messageId`, prefilling its old text. */
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

const historyTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Fetches a session's server-persisted transcript (§3.2 get_session_history), repainting from
 * truth rather than the local cache. Fine to call unconditionally: an unknown id just returns empty. */
export function getSessionHistory(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  // Only a cold open dims the chat: a cached transcript is already on screen, so the refetch
  // repaints it silently. Nor does one that's known to be empty: there's nothing to wait for, and
  // syncing reads as "not a new chat", docking the composer until the reply lands.
  if (!server.messagesBySession[sessionId]?.length && server.sessionById.get(sessionId)?.messageCount !== 0)
    server.setSessionSyncing(sessionId, true);
  // A restarted server forgets the session-to-project binding (§4b), so send it explicitly
  // or the history resolves against the default project and comes back empty.
  const projectPath = server.projectBySession[sessionId];
  void send(connectionId, { type: "get_session_history", data: { sessionId, projectPath } });
  // Nothing else clears this if the reply never comes, leaving the chat inert and blank. One timer per
  // chat, so an earlier fetch's timer can't clear a later fetch's syncing flag.
  const key = `${connectionId}\n${sessionId}`;
  clearTimeout(historyTimers.get(key));
  historyTimers.set(key, setTimeout(() => app.servers[connectionId]?.setSessionSyncing(sessionId, false), 8000));
}

/** Re-sends a resumed session's provider/model choice from `providerBySession`: this is
 * server-memory-only (§4b) and lost on server restart with no push notifying the client.
 * Mode is deliberately NOT reasserted: it's server-persisted (§4c) and replaying a stale
 * client value here would race a more recently set one from another peer. */
function reassertSessionSettings(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  const providerName = server.providerBySession[sessionId];
  if (providerName) setProvider(connectionId, sessionId, providerName, server.modelBySession[sessionId]);
  const { reasoningEffort: effort, fastMode } = server.modelOptionsBySession[sessionId] ?? {};
  if (providerName && (effort || fastMode)) setModelOptions(connectionId, sessionId, { reasoningEffort: effort, fastMode });
}

/** Opens `sessionId` as the main chat and refreshes it from the server so a
 * session opened cold (a second device, a fresh install, a reconnect after
 * being offline) shows its actual history instead of whatever (or nothing)
 * this client happens to have cached locally. Also switches the main panel
 * to `sessionId`'s server first, since the sidebar and palette list every
 * server's chats. Use this instead of calling `ServerState.openSession`
 * directly.
 *
 * This is also the single funnel that feeds the titlebar's back/forward
 * history (see ServerState.pushNavHistory): every user-initiated switch goes
 * through here, so clicking between chats in the sidebar and stepping
 * through them with the arrows walk the same list. Re-clicking the
 * already-open session records nothing, so it can't fill the stack with
 * duplicates of itself. */
export function openChatSession(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  // A pairing is one chat in the UI: either half opens it the same way round.
  sessionId = server.splitAnchorOf(sessionId)?.sessionId ?? sessionId;
  app.activeConnectionId = connectionId;
  if (sessionId !== server.currentSessionId) server.pushNavHistory(server.currentSessionId);
  server.openSession(sessionId);
  showChat();
  if (server.connectionStatus === "connected") {
    getSessionHistory(connectionId, sessionId);
    reassertSessionSettings(connectionId, sessionId);
    listTerminals(connectionId, sessionId);
  }
}

/** The titlebar island's back/forward arrows; same open-and-refresh path as clicking a session
 * in the sidebar. No-op at either end of history (buttons disable there, but a rapid double-click can still land here). */
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

export function cancelSubagent(connectionId: ConnectionId, sessionId: string, toolCallId: string) {
  void send(connectionId, { type: "cancel_subagent", sessionId, data: { toolCallId } });
}

export function cancelTurn(connectionId: ConnectionId, sessionId: string, turnId: string) {
  void send(connectionId, { type: "cancel_turn", sessionId, turnId, data: { sessionId, turnId } });
}

/** Undoes a queued prompt if the server hasn't started it yet; turn_completed confirms. */
export function withdrawPrompt(connectionId: ConnectionId, sessionId: string, turnId: string) {
  const queued = app.servers[connectionId]?.queuedBySession[sessionId]?.find((q) => q.turnId === turnId);
  if (!queued) return;
  queued.withdrawing = true;
  void send(connectionId, { type: "cancel_turn", sessionId, turnId, data: { sessionId, turnId, queuedOnly: true } });
}

export function respondPermission(
  connectionId: ConnectionId,
  sessionId: string,
  turnId: string,
  toolCallId: string,
  allowed: boolean,
  remember: boolean,
  feedback?: string,
  /** A picked suggestion (SPEC.md §3.1 permission_response): which rule to remember, and where. */
  choice?: { ruleId?: string; scope?: string },
) {
  void send(connectionId, {
    type: "permission_response",
    sessionId,
    turnId,
    toolCallId,
    data: {
      allowed,
      remember,
      ...(feedback ? { feedback } : {}),
      ...(choice?.ruleId ? { ruleId: choice.ruleId } : {}),
      ...(choice?.scope ? { scope: choice.scope } : {}),
    },
  });
}

// ---- Permission rules (§3.1 list_permission_rules/add_permission_rule/delete_permission_rule) ----

/** The reply, `permission_rules`, lands in `server.permissionRules[projectPath]`. */
export function listPermissionRules(connectionId: ConnectionId, projectPath?: string) {
  void send(connectionId, { type: "list_permission_rules", data: { projectPath } });
}

export function addPermissionRule(
  connectionId: ConnectionId,
  projectPath: string | undefined,
  scope: string,
  rule: { tool: string; text: string; decision: string; modes?: string[] },
) {
  void send(connectionId, { type: "add_permission_rule", data: { projectPath, scope, rule } });
}

export function deletePermissionRule(connectionId: ConnectionId, projectPath: string | undefined, id: string) {
  void send(connectionId, { type: "delete_permission_rule", data: { projectPath, id } });
}

export function restoreSnapshot(connectionId: ConnectionId, sessionId: string, snapshotId: string, project?: string) {
  const projectPath = project ?? app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "restore_snapshot", sessionId, turnId: "", data: { snapshotId, projectPath } });
}

export function listSnapshots(connectionId: ConnectionId, projectPath: string) {
  void send(connectionId, { type: "list_snapshots", data: { projectPath } });
}

/** Derives a title from a session's first prompt and pushes it: the backend never generates one itself (§3.1). */
export function setSessionTitle(connectionId: ConnectionId, sessionId: string, title: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_session_title", data: { sessionId, title, projectPath } });
}

/** Optimistic: applies the flag locally right away instead of waiting on session_updated (§3.2) to round-trip. */
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

/** Pairs (or, with `null`, unpairs) `sessionId`'s split/sidebar layout (§3.1), server-persisted
 * so it survives a reload or shows on another device. Optimistic, like setSessionArchived. */
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

/** Permanently deletes a session (§3.1): not reversible, so no optimistic removal, wait for `session_deleted`. */
export function deleteSession(connectionId: ConnectionId, sessionId: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "delete_session", data: { sessionId, projectPath } });
}

/** Opens `sessionId` in the right sidebar and, the first time these two sessions pair up,
 * saves the layout server-side (§3.1) so it auto-reopens after a reload or on another device. */
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

/** Makes `sessionId` the only chat on screen: drops its pairing (whichever half it is) and opens it. */
export function focusChat(connectionId: ConnectionId, sessionId: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  const anchor = server.sessionById.get(sessionId)?.linkedSessionId ? sessionId : server.splitAnchorOf(sessionId)?.sessionId;
  if (anchor) setSessionLayout(connectionId, anchor, null);
  openChatSession(connectionId, sessionId);
}

/** Browses the *backend's* filesystem (§3.1): a native OS dialog here would browse the wrong disk over a remote connection. */
export function listDirectory(connectionId: ConnectionId, path?: string) {
  void send(connectionId, { type: "list_directory", data: { path: path ?? "" } });
}

/** Opens (or reuses) a project on the server without starting a turn, e.g.
 * to validate a folder and list its threads before creating a new one. */
function openProject(connectionId: ConnectionId, path: string) {
  void send(connectionId, { type: "open_project", data: { path } });
}

/** Selects `path` as the current project and, if connected, opens it server-side. `rememberProject`
 * is only called from the canonicalized `project_opened` response when connected, to avoid two
 * differently-spelled entries for the same folder; offline it's remembered as a local best guess. */
export function selectProject(connectionId: ConnectionId, path: string) {
  const server = app.servers[connectionId];
  if (!server) return;
  server.selectProject(path);
  if (path === CHAT_PROJECT) return; // no folder to open; the server makes its scratch dir on the first prompt
  if (server.connectionStatus === "connected") {
    openProject(connectionId, path);
    listSessionsForProject(connectionId, path);
    listFiles(connectionId, path);
  } else {
    server.rememberProject(path);
  }
}

/** A folder picked in the browser, and the server it's on: the palette can
 * switch which server it browses mid-pick. */
export interface PickedFolder {
  connectionId: ConnectionId;
  path: string;
}

let directoryBrowserResolve: ((picked: PickedFolder | null) => void) | null = null;

/** Opens the command palette's folder browser (§3.1 `list_directory`) on the backend's filesystem.
 * Tags `app.browsingConnectionId` so a late response from an abandoned browse can't clobber a newer one. */
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

/** The one remaining native-dialog entry point, Settings > Projects'
 * "Browse...", for adding a new path from scratch without switching to it
 * (daily selection goes through the sidebar's dropdown instead). Must still
 * reach the server via `open_project` when connected: the known-projects
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
    server.nextProjectOpenSwitches = false; // "adds without switching to it", see state.svelte.ts's project_opened handler
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
  const from = app.active;
  app.activeConnectionId = connectionId;
  // No project given: a chat with the server as its computer (§4b), not the current project.
  // newSessionInProject drops an untouched chat it replaces, carrying its unsent text over.
  const path = projectPath ?? CHAT_PROJECT;
  if (path !== CHAT_PROJECT && path !== server.currentProjectPath) {
    selectProject(connectionId, path);
    server.freshChatId = server.currentSessionId;
  } else {
    server.freshChatId = server.newSessionInProject(path);
  }
  carryBlankChat(from, server);
  showChat();
}

/** Moving to another server from an untouched chat takes its unsent text, model, effort and
 * permission level along where the new server has the same model. Nothing happens unless both
 * chats are untouched: a chat with history keeps what it has. */
export function carryBlankChat(from: ServerState | null, to: ServerState) {
  const src = from?.currentSessionId;
  const dst = to.currentSessionId;
  if (!from || from === to || !src || !dst) return;
  if (from.messagesBySession[src]?.length || to.messagesBySession[dst]?.length) return;
  const draft = from.composerDraftBySession[src];
  if (draft) {
    to.composerDraftBySession[dst] = draft;
    delete from.composerDraftBySession[src];
  }
  void carrySettings(from, src, to, dst);
}

/** Looks for the chat's model among the new server's providers (same provider first) and, if it
 * has it, has the chat start there on it, at the same effort, speed and permission level. */
async function carrySettings(from: ServerState, src: string, to: ServerState, dst: string) {
  const name = from.providerBySession[src];
  const model = from.modelBySession[src];
  if (!name) return;
  const candidates = [...to.providers].sort((a, b) => Number(b.name === name) - Number(a.name === name));
  for (const p of candidates) ensureModels(to.connectionId, p.name);
  for (let i = 0; i < 30 && candidates.some((p) => !to.modelsByProvider[p.name] && to.modelsAsked.has(p.name)); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const match = candidates.find((p) => (model ? to.modelsByProvider[p.name]?.some((m) => m.id === model) : p.name === name));
  if (!match || to.currentSessionId !== dst) return;
  const { reasoningEffort, fastMode } = from.modelOptionsBySession[src] ?? {};
  to.lastUsedProvider = match.name;
  to.lastUsedModel = model ?? null;
  to.lastUsedEffort = reasoningEffort ?? null;
  to.lastUsedFast = !!fastMode;
  to.reseedBySession[dst] = true; // ModelPicker applies it, with the effort check it owns
  const mode = from.modeBySession[src];
  if (!mode) return;
  for (let i = 0; i < 30 && to.providerBySession[dst] !== match.name; i++) await new Promise((r) => setTimeout(r, 100));
  if (sessionModes(to, dst).available.includes(mode)) chooseMode(to, to.connectionId, dst, mode);
}

/** Switches the main panel to another server, taking an untouched chat's composer along. */
export function switchServer(connectionId: ConnectionId) {
  const from = app.active;
  app.activeConnectionId = connectionId;
  const to = app.active;
  if (to) carryBlankChat(from, to);
}

/** A chat can't change root, so "moving" it starts a session in the project: the chat's files are
 * copied in (§4b import_chat_files) and the new session's first message is drafted from a digest of
 * the conversation, for the user to read and send. The chat itself stays until it's deleted. */
export async function moveChatToProject(connectionId: ConnectionId, sessionId: string, project: string) {
  const server = app.servers[connectionId];
  if (!server || server.connectionStatus !== "connected") return;
  if (!server.messagesBySession[sessionId]?.length) {
    getSessionHistory(connectionId, sessionId);
    for (let i = 0; i < 20 && !server.messagesBySession[sessionId]?.length; i++) await new Promise((r) => setTimeout(r, 100));
  }
  let imported: { dir: string; files: number } | undefined;
  try {
    const r = await rpc<{ error?: string; dir?: string; files?: number }>(connectionId, "import_chat_files", { sessionId, target: project });
    if (r.dir) imported = { dir: r.dir, files: r.files ?? 0 };
    else if (r.error && !/no files/.test(r.error) && !(await askConfirm(`Couldn't copy the chat's files: ${r.error}. Continue without them?`))) return;
  } catch (e) {
    if (!(await askConfirm(`Couldn't copy the chat's files: ${e instanceof Error ? e.message : e}. Continue without them?`))) return;
  }
  if (imported) listFiles(connectionId, project);
  await newChat(connectionId, project);
  const id = server.currentSessionId;
  if (!id) return;
  const title = server.sessionById.get(sessionId)?.title || "Untitled chat";
  server.restoredDraftBySession[id] = continuationDraft(title, briefOf(server.messagesBySession[sessionId] ?? []), imported);
}

/** A fresh chat in `projectPath` (CHAT_PROJECT for none) whose composer already holds `prompt`, unsent. */
export async function startChatWith(connectionId: ConnectionId, projectPath: string, prompt: string) {
  await newChat(connectionId, projectPath);
  const server = app.servers[connectionId];
  const id = server?.currentSessionId;
  if (server && id) server.restoredDraftBySession[id] = prompt;
}

function listProjects(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_projects", data: {} });
}

/** Drops a project from the server's persisted list and evicts its live sessions server-side:
 * real teardown, not just a client-side hide (§3.1 remove_project). */
export function removeProject(connectionId: ConnectionId, path: string) {
  void send(connectionId, { type: "remove_project", data: { path } });
}

function listSessionsForProject(connectionId: ConnectionId, projectPath: string) {
  const server = app.servers[connectionId];
  if (server) server.refreshingProjects[projectPath] = true;
  void send(connectionId, { type: "list_sessions", data: { projectPath } });
}

const rootAsked = new Set<string>();
/** A project-less chat's scratch path (the panels need it) only arrives in session summaries. */
function learnChatRoot(connectionId: ConnectionId, server: ServerState, sessionId: string) {
  if (server.projectBySession[sessionId] !== CHAT_PROJECT || server.rootBySession[sessionId] || rootAsked.has(sessionId)) return;
  rootAsked.add(sessionId);
  setTimeout(() => rootAsked.delete(sessionId), 1500);
  listSessionsForProject(connectionId, CHAT_PROJECT);
}

export function listSessionsForProjects(connectionId: ConnectionId, paths: string[]) {
  for (const path of paths) listSessionsForProject(connectionId, path);
}

/** Fetches the project's file list (§3.1) for @file mention autocomplete. */
export function listFiles(connectionId: ConnectionId, projectPath: string) {
  if (projectPath === CHAT_PROJECT) return; // a chat's files are listed by its root (rootOf), not the sentinel
  void send(connectionId, { type: "list_files", data: { projectPath } });
}

function listProviders(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_providers", data: {} });
}

/** Asks which coding-agent CLIs the server has (§3.1 detect_cli). The server looks them up fresh,
 * so this is how one installed since the last ask shows up. */
export function detectCli(connectionId: ConnectionId) {
  void send(connectionId, { type: "detect_cli", data: {} });
}

export function setProvider(connectionId: ConnectionId, sessionId: string, providerName: string, model?: string) {
  // A brand-new session isn't bound to its project yet, and the server keeps a separate
  // registry per project (§4b); omitting projectPath resolves against the wrong one and the
  // turn comes back `no_provider`, clearing this selection.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_provider", sessionId, data: { providerName, model, projectPath } });
}

/** Tunes the provider's request shape for a session's next turn (§3.1). All fields optional;
 * a zero/empty one is left unchanged server-side, not reset. */
export function setModelOptions(
  connectionId: ConnectionId,
  sessionId: string,
  options: { reasoningEffort?: string; thinkingBudget?: number; contextWindow?: number; fastMode?: boolean; autoCompactTokens?: number; autoCompact?: boolean },
) {
  // projectPath for the same reason setProvider sends it, see there.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_model_options", sessionId, data: { sessionId, ...options, projectPath } });
}

/** Summarizes the chat's conversation now (§3.1 compact_context); `context_compacted` answers, or `error`. */
export function compactContext(connectionId: ConnectionId, sessionId: string, instructions = "") {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "compact_context", sessionId, turnId: crypto.randomUUID(), data: { sessionId, instructions, projectPath } });
}

/** Asks about the chat without adding to it (§3.1 side_question), mid-turn too. With `anchorMessageId` it
 * is a reply in that message's thread and the exchange is kept; without, it is a /btw and nothing is.
 * `side_answer` events carrying `requestId` stream the answer. */
export function sideQuestion(connectionId: ConnectionId, sessionId: string, requestId: string, question: string, anchorMessageId?: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "side_question", sessionId, data: { sessionId, requestId, question, anchorMessageId, projectPath } });
}

/** Replies shorter than this aren't worth a summary. */
export const AUTO_SUMMARY_CHARS = 800;

/** Has the utility model write a short summary of one reply (§3.1 summarize_message); `message_summary` answers. */
export function summarizeMessage(connectionId: ConnectionId, sessionId: string, messageId: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "summarize_message", sessionId, data: { sessionId, messageId, projectPath } });
}

/** Fetches one provider's available models (§3.1), called lazily per picker tab. */
function listModels(connectionId: ConnectionId, providerName: string, refresh = false) {
  void send(connectionId, { type: "list_models", data: { providerName, refresh: refresh || undefined } });
}

/** Asks a CLI agent's models again when what we have is missing or the server's fallback, which is
 * what a chat sees if the agent was logged out when first asked and has been signed in since. At
 * most once every 15 s per provider, since each ask spawns the agent. */
export function refreshModels(connectionId: ConnectionId, providerName: string) {
  const server = app.servers[connectionId];
  if (!server || server.modelsByProvider[providerName] && !server.modelsFallback.has(providerName)) return;
  if (Date.now() - (server.modelsRefreshedAt.get(providerName) ?? 0) < 15_000) return;
  server.modelsRefreshedAt.set(providerName, Date.now());
  server.modelsAsked.add(providerName);
  listModels(connectionId, providerName, true);
}

/** `listModels` once per provider per server: a failed ask (host down) isn't asked again by every
 * picker that mounts, since each one costs the server a dial. Re-registering the provider resets it. */
export function ensureModels(connectionId: ConnectionId, providerName: string) {
  const server = app.servers[connectionId];
  if (!server || server.modelsAsked.has(providerName)) return;
  server.modelsAsked.add(providerName);
  listModels(connectionId, providerName);
}

/** Replaces one provider's favorite-model list (§3.1): a full replacement, not a single toggle. */
export function setFavoriteModels(connectionId: ConnectionId, providerName: string, models: string[]) {
  void send(connectionId, { type: "set_favorite_models", data: { providerName, models } });
}

/** Switches a session between the modes (§3.1/§4c), effective next turn. Server-persisted and broadcast. */
export function setMode(connectionId: ConnectionId, sessionId: string, mode: ChatMode) {
  // projectPath for the same reason setProvider sends it, see there.
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "set_mode", sessionId, data: { mode, projectPath } });
}

/** Approves the plan a chat has shown and carries it out in `mode` (§3.1 approve_plan). */
export function approvePlan(connectionId: ConnectionId, sessionId: string, mode: ChatMode) {
  const server = app.servers[connectionId];
  const projectPath = server?.projectBySession[sessionId];
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  void send(connectionId, { type: "approve_plan", sessionId, turnId, data: { mode, projectPath } });
  // The server answers with mode_set; the ask itself is gone once it is approved.
  const ask = server?.planAskFor(sessionId);
  if (ask) server?.removeAsk(ask.toolCallId);
}

/** Turns web_search/web_fetch on or off for an entire project (§3.1), scoped by projectPath, not sessionId. */
export function setWebToolsEnabled(connectionId: ConnectionId, projectPath: string, enabled: boolean) {
  void send(connectionId, { type: "set_web_tools_enabled", data: { projectPath, enabled } });
}

/** Answers an outstanding ask_user_question_requested (§3.1). Needs the sessionId: without it the
 * server resolves the "default" session and the waiting turn never gets the answer. */
export function askUserAnswer(connectionId: ConnectionId, sessionId: string, toolCallId: string, answer: string) {
  void send(connectionId, { type: "ask_user_answer", sessionId, toolCallId, data: { answer } });
}

export function registerProvider(connectionId: ConnectionId, data: Record<string, unknown>) {
  void send(connectionId, { type: "register_provider", data });
}

export function removeProvider(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "remove_provider", data: { name } });
}

// The server mints the request id, so openrouter_oauth_url can't ride rpc(); one sign-in per connection.
const oauthUrlWaiters = new Map<ConnectionId, (d: { requestId: string; url: string }) => void>();

/** OpenRouter sign-in (SPEC.md openrouter_oauth_*). The desktop shell listens on a loopback port for the
 * redirect; the server builds the PKCE URL and swaps the code for a key, stored as a provider with
 * authMethod "oauth". Resolves once the code is handed to the server: provider_registered (or an error
 * event) follows. Rejects if the browser step fails, times out or is cancelled. */
export async function signInOpenRouter(connectionId: ConnectionId, name: string) {
  const web = isDesktop ? null : startWebSignIn();
  try {
    const { callbackUrl } = web ?? (await invoke<{ callbackUrl: string }>("oauth_listen"));
    const { requestId, url } = await new Promise<{ requestId: string; url: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        oauthUrlWaiters.delete(connectionId);
        reject(new Error("the server didn't answer the sign-in request"));
      }, 15_000);
      oauthUrlWaiters.set(connectionId, (d) => {
        clearTimeout(timer);
        oauthUrlWaiters.delete(connectionId);
        resolve(d);
      });
      void send(connectionId, { type: "openrouter_oauth_start", data: { name, callbackUrl } });
    });
    // OpenRouter's redirect carries no state; the nonce in the callback URL stands in for it.
    const answer = web?.wait();
    answer?.catch(() => {}); // the await below reports it; this only keeps it handled if open() throws first
    if (web) web.open(url);
    else await openUrl(url);
    const code = answer ? (await answer).code : await invoke<string>("oauth_wait");
    void send(connectionId, { type: "openrouter_oauth_complete", data: { requestId, code } });
  } catch (e) {
    if (!web) void invoke("oauth_cancel").catch(() => {});
    throw e;
  } finally {
    web?.end();
  }
}

export const cancelOpenRouterSignIn = () => (isDesktop ? invoke("oauth_cancel") : Promise.resolve(cancelWebSignIn()));

// ---- MCP servers (§3.1 list_mcp_servers … mcp_sign_out) ----
// Every reply is an `mcp_servers` event, which lands in `server.mcpByProject[projectPath]`; a refused
// change carries `error`. A server's own state (connecting → ready) is pushed as it happens.

export function listMcpServers(connectionId: ConnectionId, projectPath: string | undefined, connect = false) {
  void send(connectionId, { type: "list_mcp_servers", data: { projectPath, connect } });
}

/** Adds a server (`replacing` empty) or edits one. Secrets sent back as the `redacted` placeholder are kept. */
export function saveMcpServer(connectionId: ConnectionId, projectPath: string | undefined, name: string, config: McpServerConfig, replacing = "") {
  void send(connectionId, { type: "save_mcp_server", data: { projectPath, name, replacing, config } });
}

export function removeMcpServer(connectionId: ConnectionId, projectPath: string | undefined, name: string) {
  void send(connectionId, { type: "remove_mcp_server", data: { projectPath, name } });
}

/** Switches your own server on or off; for a project's server, approves (true) or refuses (false) what its .mcp.json runs. */
export function setMcpServerEnabled(connectionId: ConnectionId, projectPath: string | undefined, name: string, enabled: boolean) {
  void send(connectionId, { type: "set_mcp_server_enabled", data: { projectPath, name, enabled } });
}

export function setMcpToolEnabled(connectionId: ConnectionId, projectPath: string | undefined, name: string, tool: string, enabled: boolean) {
  void send(connectionId, { type: "set_mcp_tool_enabled", data: { projectPath, name, tool, enabled } });
}

export function reconnectMcpServer(connectionId: ConnectionId, projectPath: string | undefined, name: string) {
  void send(connectionId, { type: "reconnect_mcp_server", data: { projectPath, name } });
}

export function signOutMcpServer(connectionId: ConnectionId, projectPath: string | undefined, name: string) {
  void send(connectionId, { type: "mcp_sign_out", data: { projectPath, name } });
}

const mcpOauthWaiters = new Map<ConnectionId, (d: { requestId: string; url: string }) => void>();

/** Signs in to a remote MCP server. The desktop shell listens on a loopback port for the redirect, so the
 * code reaches the server whichever machine it runs on. Resolves once the server has the code
 * (`mcp_servers` follows, with the server signed in or an `error`); rejects if the browser step fails. */
export async function signInMcpServer(connectionId: ConnectionId, projectPath: string | undefined, name: string) {
  const web = isDesktop ? null : startWebSignIn();
  try {
    const { callbackUrl } = web ?? (await invoke<{ callbackUrl: string }>("oauth_listen"));
    const { requestId, url } = await new Promise<{ requestId: string; url: string }>((resolve, reject) => {
      const waiter = (d: { requestId: string; url: string }) => {
        clearTimeout(timer);
        if (mcpOauthWaiters.get(connectionId) === waiter) mcpOauthWaiters.delete(connectionId);
        resolve(d);
      };
      const timer = setTimeout(() => {
        if (mcpOauthWaiters.get(connectionId) === waiter) mcpOauthWaiters.delete(connectionId);
        reject(new Error("the server didn't answer the sign-in request"));
      }, 20_000);
      mcpOauthWaiters.set(connectionId, waiter);
      void send(connectionId, { type: "mcp_oauth_start", data: { projectPath, name, callbackUrl } });
    });
    // Only the redirect that carries this sign-in's state is taken (oauthListener.js).
    const state = new URL(url).searchParams.get("state") ?? undefined;
    const answer = web?.wait(state);
    answer?.catch(() => {});
    if (web) web.open(url);
    else {
      if (state) await invoke("oauth_expect_state", { state });
      await openUrl(url);
    }
    const { code, state: returned, iss } = await (answer ?? invoke<{ code: string; state?: string; iss?: string }>("oauth_wait_params"));
    void send(connectionId, { type: "mcp_oauth_complete", data: { projectPath, requestId, code, state: returned, iss } });
  } catch (e) {
    if (!web) void invoke("oauth_cancel").catch(() => {});
    throw e;
  } finally {
    web?.end();
  }
}

/** What other tools on the server's machine already have configured (§3.1 scan_mcp_imports). Reads only. */
export const scanMcpImports = (cid: ConnectionId, projectPath: string | undefined) =>
  rpc<McpImportData>(cid, "scan_mcp_imports", { projectPath });

/** Copies the chosen candidates into your servers; the daemon re-reads each source file, so no secret passes
 * through here. Answered with `mcp_servers` (the new servers, or an `error` and nothing saved). */
export function importMcpServers(connectionId: ConnectionId, projectPath: string | undefined, items: { id: string; name?: string }[]) {
  void send(connectionId, { type: "import_mcp_servers", data: { projectPath, items } });
}

/** Gives up a sign-in waiting on the browser; the pending `signInMcpServer` rejects with "sign-in cancelled". */
export const cancelMcpSignIn = () => (isDesktop ? invoke("oauth_cancel") : Promise.resolve(cancelWebSignIn()));

// ---- Skills (§3.1 list_skills, set_skill_enabled, get_skill) ----
// Replies land in `server.skillsByProject[projectPath]` and `server.skillDetails[dir]`.

export function listSkills(connectionId: ConnectionId, projectPath: string | undefined) {
  void send(connectionId, { type: "list_skills", data: { projectPath } });
}

export function setSkillEnabled(connectionId: ConnectionId, projectPath: string | undefined, dir: string, enabled: boolean) {
  void send(connectionId, { type: "set_skill_enabled", data: { projectPath, dir, enabled } });
}

export function getSkill(connectionId: ConnectionId, projectPath: string | undefined, dir: string) {
  void send(connectionId, { type: "get_skill", data: { projectPath, dir } });
}

// ---- Peer registry & server settings (§2a/§3.1) ----

/** Pushes this connection's display name live; every peer sees it on the next `peer_list` push. */
export function setPeerName(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "set_peer_name", data: { name } });
}

/** Same live-push shape as setPeerName, for the profile picture; outgoingAvatarDataUrl normalizes
 * either an emoji glyph or a photo into the data URL the wire protocol expects. */
export function setPeerAvatar(connectionId: ConnectionId, avatar: string) {
  void send(connectionId, { type: "set_peer_avatar", data: { avatar: outgoingAvatarDataUrl(avatar) } });
}

/** Edits your own person: the name and picture every chat shows for you. A device's label is separate. */
export function setProfile(connectionId: ConnectionId, profile: { name?: string; avatar?: string }) {
  void send(connectionId, { type: "set_profile", data: profile });
}

// A person's picture is an "upload:<sha>" reference; the server hands the image over on request.
setAvatarFetcher((avatar) => {
  const id = app.active?.connectionId;
  if (!id) return false;
  void send(id, { type: "get_avatar", data: { avatar } });
  return true;
});

// ---- People & devices (§3.1/§3.2 people), Trusted and Full ----

export function listPeople(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_people", data: {} });
}

/** `caps` replaces the person's whole overlay: send only what differs from the tier's default. */
export function setUserPermissions(connectionId: ConnectionId, userId: string, change: { tier?: Tier; caps?: Partial<Caps> }) {
  void send(connectionId, { type: "set_user_permissions", data: { userId, ...change } });
}

export function setDeviceRestrictions(connectionId: ConnectionId, credential: string, change: { maxTier?: Tier | ""; deny?: string[] }) {
  void send(connectionId, { type: "set_device_restrictions", data: { credential, ...change } });
}

export function setLimitedDefaults(connectionId: ConnectionId, caps: Partial<Caps>) {
  void send(connectionId, { type: "set_limited_defaults", data: { caps } });
}

export function mergeUsers(connectionId: ConnectionId, from: string, into: string) {
  void send(connectionId, { type: "merge_users", data: { from, into } });
}

export function moveDevice(connectionId: ConnectionId, credential: string, userId: string) {
  void send(connectionId, { type: "move_device", data: { credential, userId } });
}

export function removeUser(connectionId: ConnectionId, userId: string) {
  void send(connectionId, { type: "remove_user", data: { userId } });
}

/** Force-closes another live connection (§2a). Full access, or the computer running the server. */
export function disconnectPeer(connectionId: ConnectionId, peerId: string) {
  void send(connectionId, { type: "disconnect_peer", data: { peerId } });
}

/** Old clients' switch: full makes the credential's person Full, otherwise caps the device at Limited. Needs full access. */
export function setPeerScope(connectionId: ConnectionId, peerId: string, full: boolean) {
  void send(connectionId, { type: "set_peer_scope", data: { peerId, full } });
}

/** Opens or closes the optional TCP listener live. Local-socket-only: the
 * server rejects this over TCP (§3.1). */
export function setRemoteAccess(
  connectionId: ConnectionId,
  enabled: boolean,
  opts: { addr?: string; tlsCert?: string; tlsKey?: string; webRoot?: string } = {},
) {
  void send(connectionId, { type: "set_remote_access", data: { enabled, ...opts } });
}

/** Changes server-wide tunables (`RuntimeSettings`); only the keys given change. Any peer may. The
 * server answers with `runtime_settings` carrying what it stored (values are clamped). */
export function setRuntimeSettings(connectionId: ConnectionId, patch: Partial<RuntimeSettings>) {
  void send(connectionId, { type: "set_runtime_settings", data: patch });
}

/** Picks the registered provider new chats start on; an empty name clears it. */
export function setDefaultProvider(connectionId: ConnectionId, providerName: string, model = "") {
  void send(connectionId, { type: "set_default_provider", data: { providerName, model } });
}

/** Replaces the server-wide model role table (SPEC.md §4f); a role left out runs on each chat's own model. */
export function setModelRoles(connectionId: ConnectionId, roles: Record<string, ModelRole>) {
  void send(connectionId, { type: "set_model_roles", data: { roles } });
}

export function setAutoGenerateTitle(connectionId: ConnectionId, enabled: boolean) {
  void send(connectionId, { type: "set_auto_generate_title", data: { enabled } });
}

/** Rotates the TCP listener's shared auth token. Local-socket-only. */
export function setRemotePassword(connectionId: ConnectionId, password: string) {
  void send(connectionId, { type: "set_remote_password", data: { password } });
}

/** Sets the server's own display name; not a security boundary, so this works over any transport. */
export function setServerIdentity(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "set_server_identity", data: { name } });
}

/** Sets the server's avatar for every client; an empty icon resets to initials and the derived colour. */
export function setServerIcon(connectionId: ConnectionId, icon: ServerIcon) {
  void send(connectionId, { type: "set_server_identity", data: { icon } });
}

// ---- Per-person tokens (§3.1), local-socket-only, like remote-access ----

/** Mints a new named TCP auth credential. The `token_registered` response carries the raw token once (§3.2). */
export function registerToken(
  connectionId: ConnectionId,
  name: string,
  email?: string,
  pairing = false,
  /** Whose device this is: "me", "new" (named `newUserName`), or an existing person's id (the local client only).
   * Omitted, an old server treats a pairing code as a new person. */
  who?: { user: string; newUserName?: string; tier?: Tier; maxTier?: Tier },
) {
  void send(connectionId, { type: "register_token", data: { name, email: email || undefined, pairing: pairing || undefined, ...who } });
}

/** Lets a device that scanned a pairing QR code in (or turns it away). Local socket only. */
export function answerPairing(connectionId: ConnectionId, credential: string, allow: boolean, full = false) {
  void send(connectionId, { type: "approve_pairing", data: { credential, allow, full: full || undefined } });
  const s = app.servers[connectionId];
  if (s) s.pairingRequests = s.pairingRequests.filter((r) => r.credential !== credential);
  app.dropToast(`pair-${credential}`);
}

export function listTokens(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_tokens", data: {} });
}

export function removeToken(connectionId: ConnectionId, name: string) {
  void send(connectionId, { type: "remove_token", data: { name } });
}

// ---- Built-in terminal (SPEC.md §3.1/§3.2 terminal_*) ----

/** Starts a brand-new shell bound to `sessionId`. `terminalId` is always client-chosen,
 * never server-allocated, so the tab renders immediately instead of waiting on a round trip. */
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

/** Subscribes this connection to a terminal that may already be running elsewhere (§3.1).
 * `restartIfExited` is the "reopen this closed tab" action. */
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

/** This connection stopped watching a terminal (its drawer closed). The server forgets a shell
 * nobody watches and nothing runs in, so there's nothing to clean up client-side. */
export function terminalDetach(connectionId: ConnectionId, sessionId: string, terminalId: string) {
  const projectPath = app.servers[connectionId]?.projectBySession[sessionId];
  void send(connectionId, { type: "terminal_detach", sessionId, data: { sessionId, projectPath, terminalId } });
}

/** Raw pty input: base64, not a plain JSON string, since terminal I/O isn't
 * guaranteed to be valid UTF-8 (§3.1). */
export function terminalInput(connectionId: ConnectionId, sessionId: string, terminalId: string, bytes: Uint8Array) {
  void send(connectionId, {
    type: "terminal_input",
    sessionId,
    data: { sessionId, terminalId, data: bytesToBase64(bytes) },
  });
}

/** A pane being resized / a split ratio changing: sends SIGWINCH server-side,
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

/** Kills the shell and drops the tab for good: unlike the shell exiting on
 * its own, this isn't reopenable via terminal_attach (§3.1). No optimistic
 * local removal, same precedent as deleteSession: wait for the server's
 * terminal_closed (state.svelte.ts). */
export function terminalClose(connectionId: ConnectionId, sessionId: string, terminalId: string) {
  void send(connectionId, { type: "terminal_close", sessionId, data: { sessionId, terminalId } });
}

/** Enumerates every open tab in one chat (§3.1); called whenever that chat opens, so the
 * tab strip/status icons are current even before the terminal drawer itself opens. */
export function listTerminals(connectionId: ConnectionId, sessionId: string) {
  void send(connectionId, { type: "list_terminals", sessionId, data: { sessionId } });
}

/** The addresses the server could be reached at from a phone, for the pairing QR (§3.1 get_pair_info). */
export const getPairInfo = (cid: ConnectionId) => rpc<{ hosts: string[] }>(cid, "get_pair_info", {});

/** One sample of the server's process tree; the answer lands in ServerState.processes. */
export function listProcesses(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_processes", data: {} });
}

/** Sends a process a signal; the answer is process_signaled (state.svelte.ts). Local socket only. */
export function signalProcess(connectionId: ConnectionId, pid: number, signal: "SIGINT" | "SIGKILL") {
  void send(connectionId, { type: "signal_process", data: { pid, signal } });
}

/** Recent tool failures, slow calls and warnings; the answer is problem_list. Local socket only. */
export function listProblems(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_problems", data: {} });
}

/** Asks for the server log tail; the answer is log_text, which state.svelte.ts saves as a file. Local socket only. */
export function readLog(connectionId: ConnectionId) {
  void send(connectionId, { type: "read_log", data: {} });
}

// ---- Notifications (§3.1 list_notifications/dismiss_notification) ----

function listNotifications(connectionId: ConnectionId) {
  void send(connectionId, { type: "list_notifications", data: {} });
}

/** Dismisses one notification, or all of them with no `id`; the server echoes it to all peers. */
export function dismissNotification(connectionId: ConnectionId, id?: string) {
  // Optimistic: a lost request just comes back with the next notification_list.
  const server = app.servers[connectionId];
  if (server) server.notifications = id ? server.notifications.filter((n) => n.id !== id) : [];
  void send(connectionId, { type: "dismiss_notification", data: id ? { id } : {} });
}

/** Marks notifications read (all of them with no ids) on the server, which tells every device. */
export function markNotificationsRead(connectionId: ConnectionId, ids?: string[]) {
  if (ids && !ids.length) return; // no ids means all; an empty list means none
  const server = app.servers[connectionId];
  if (server) {
    const set = ids && new Set(ids);
    server.notifications = server.notifications.map((n) => (!n.read && (!set || set.has(n.id)) ? { ...n, read: true } : n));
  }
  void send(connectionId, { type: "mark_notifications_read", data: ids ? { ids } : {} });
}

/** The server-wide notification policy (§3.1 set_notify_prefs); every device gets it back as notify_prefs. */
export function setNotifyPrefs(connectionId: ConnectionId, prefs: NotifyPrefs) {
  void send(connectionId, { type: "set_notify_prefs", data: { ...prefs } });
}

/** Tells the server which chats this device shows and whether it's in use, so it can skip
 * "finished" pings for a chat you're reading and keep other devices quiet (§3.1 set_presence). */
export function setPresence(connectionId: ConnectionId, sessionIds: string[], focused: boolean, visible: boolean) {
  void send(connectionId, { type: "set_presence", data: { sessionIds, focused, visible } });
}

// ---- Uploads (§3.1 upload_begin/upload_chunk) ----

interface UploadReply {
  received?: number;
  path?: string;
  error?: string;
}

// ~700 KB as base64, far under the 10 MB frame limit, small enough that chat traffic interleaves between chunks.
const UPLOAD_CHUNK = 512 * 1024;
const uploadWaiters = new Map<string, { connectionId: ConnectionId; resolve: (r: UploadReply) => void }>();

/** Uploads a client-side file and resolves with its server-side path. Content-addressed, so a
 * file the server already has costs one round trip and no bytes. Each chunk waits for the previous ack.
 * ponytail: reads the whole file into memory to hash it; stream through a hasher if the 256 MB cap hurts. */
export async function uploadFile(
  connectionId: ConnectionId,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (app.servers[connectionId]?.connectionStatus !== "connected") throw new Error("not connected to the server");
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
  markNotificationsRead(connectionId, server.notifications.filter((o) => o.sessionId === n.sessionId && !o.read).map((o) => o.id));
}

// ---- Project files (§3.1 "Project files", v2.17) ----
// These requests carry a requestId the reply echoes, so callers can simply await them.

const RPC_TIMEOUT_MS = 20_000;
const rpcWaiters = new Map<string, { connectionId: ConnectionId; resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void }>();

function rpc<T>(connectionId: ConnectionId, type: string, data: Record<string, unknown>): Promise<T> {
  // Not connected means no reply is coming: say so now instead of after the timeout.
  if (app.servers[connectionId]?.connectionStatus !== "connected") return Promise.reject(new Error(`${type}: not connected to the server`));
  const requestId = `rq-${crypto.randomUUID().slice(0, 8)}`;
  return new Promise<T>((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      rpcWaiters.delete(requestId);
    };
    const timer = setTimeout(() => {
      settle();
      reject(new Error(`${type}: no reply from the server (it may be too old for this)`));
    }, RPC_TIMEOUT_MS);
    rpcWaiters.set(requestId, {
      connectionId,
      resolve: (reply) => {
        settle();
        resolve(reply as T);
      },
      reject: (err) => {
        settle();
        reject(err);
      },
    });
    void send(connectionId, { type, data: { ...data, requestId } });
  });
}

type Reply<T = object> = T & { error?: string };

export const listTree = (cid: ConnectionId, projectPath: string, path: string) =>
  rpc<Reply<{ entries: TreeEntry[] }>>(cid, "list_tree", { projectPath, path });

export const readFile = (cid: ConnectionId, projectPath: string, path: string) =>
  rpc<FileContent>(cid, "read_file", { projectPath, path });

/** A page of the server's audit log, newest first (§3.1 list_audit). `more` says older entries
 * remain: ask again with `before` set to the last one's `seq`. */
export const listAudit = (cid: ConnectionId, query: AuditQuery = {}) =>
  rpc<Reply<{ events: AuditEvent[]; more: boolean }>>(cid, "list_audit", { ...query });

/** Fetches a previewable file's bytes in chunks (server-side caps: 25MB images/fonts, 200MB
 * video/audio/PDF) and hands back an object URL good until `URL.revokeObjectURL` is called on it. */
export async function readMedia(
  cid: ConnectionId,
  projectPath: string,
  path: string,
  /** With an absolute `path`: the chat it was attached to, which is what lets the server serve it. */
  sessionId?: string,
  /** Ask for a generated preview of a stored image (falls back to the original). */
  thumb = false,
): Promise<{ url: string; mime: string; size: number } | { error: string }> {
  const info = await rpc<Reply<{ size: number; mime: string }>>(cid, "read_media", { projectPath, path, sessionId, thumb });
  if (info.error) return { error: info.error };
  const chunks: Uint8Array[] = [];
  for (let offset = 0; ; ) {
    const r = await rpc<Reply<{ data: string; offset: number; last: boolean }>>(cid, "read_media_chunk", { projectPath, path, offset, sessionId, thumb });
    if (r.error) return { error: r.error };
    const bytes = base64ToBytes(r.data);
    chunks.push(bytes);
    offset += bytes.length;
    if (r.last) break;
  }
  return { url: URL.createObjectURL(new Blob(chunks as BlobPart[], { type: info.mime })), mime: info.mime, size: info.size };
}

/** `baseVersion` is the read_file version the edit started from; a reply with `conflict` means it changed since. */
export const writeFile = (cid: ConnectionId, projectPath: string, path: string, content: string, baseVersion: string, force = false) =>
  rpc<Reply<{ version?: string; conflict?: boolean }>>(cid, "write_file", { projectPath, path, content, baseVersion, force });

export const fsOp = (
  cid: ConnectionId,
  projectPath: string,
  op: "create" | "mkdir" | "rename" | "delete",
  path: string,
  newPath?: string,
) => rpc<Reply>(cid, "fs_op", { projectPath, op, path, newPath });

/** Every recorded round-trip on this server, hourly, plus the CLIs' own transcripts there (SPEC.md §3.1 get_usage). */
export const getUsage = (cid: ConnectionId) => rpc<Reply<UsageReport>>(cid, "get_usage", { external: true });

/** A chat's context split by category (§3.1 get_context_breakdown). Can take a few seconds when a CLI agent counts it. */
export const getContextBreakdown = (cid: ConnectionId, sessionId: string, projectPath?: string) =>
  rpc<Reply<ContextBreakdown>>(cid, "get_context_breakdown", { sessionId, projectPath });

export const listGitChanges = (cid: ConnectionId, projectPath: string) =>
  rpc<Reply<{ files: GitChange[]; truncated?: boolean }>>(cid, "list_git_changes", { projectPath });

export const getFileDiff = (cid: ConnectionId, projectPath: string, path: string, opts: { snapshotId?: string; basePath?: string } = {}) =>
  rpc<Reply<{ diff?: FileDiff; binary?: boolean }>>(cid, "get_file_diff", { projectPath, path, ...opts });

// --- Scheduled turns (SPEC.md §3.1 schedule_turn et al.); replies arrive as schedule_list events.
export const scheduleTurn = (
  cid: ConnectionId,
  d: { sessionId: string; projectPath?: string; text: string; trigger: ScheduleTrigger; origin?: Origin },
) => send(cid, { type: "schedule_turn", sessionId: d.sessionId, data: d });
export const listScheduled = (cid: ConnectionId, sessionId?: string) => send(cid, { type: "list_scheduled", data: { sessionId } });
export const cancelScheduled = (cid: ConnectionId, id: string) => send(cid, { type: "cancel_scheduled", data: { id } });
export const pauseScheduled = (cid: ConnectionId, d: { id?: string; all?: boolean; paused: boolean }) =>
  send(cid, { type: "pause_scheduled", data: d });
export const limitContinue = (cid: ConnectionId, sessionId: string) => send(cid, { type: "limit_continue", sessionId, data: { sessionId } });
export const limitDismiss = (cid: ConnectionId, sessionId: string) => send(cid, { type: "limit_dismiss", sessionId, data: { sessionId } });
export const setLimitAction = (cid: ConnectionId, action: "ask" | "continue" | "stop") => send(cid, { type: "set_limit_action", data: { action } });

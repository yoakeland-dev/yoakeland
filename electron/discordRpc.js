// Discord Rich Presence over Discord's local IPC socket. Implemented directly on node:net so it
// works the same on Windows (named pipes), macOS and Linux (XDG/TMP unix sockets), including the
// Snap/Flatpak sandbox paths, with no native dependency and nothing to unpack from app.asar.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MAX_FRAME = 1 << 20;
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Discord exposes ten IPC sockets (one per running client) in each candidate directory. */
export function discordIpcPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "win32") {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const dirs = [];
  const add = (dir) => dir && !dirs.includes(dir) && dirs.push(dir);
  if (platform === "darwin") {
    add(env.TMPDIR);
    add(path.join(home, "Library", "Application Support", "discord"));
    add(path.join(home, "Library", "Application Support", "discordcanary"));
  } else {
    add(env.XDG_RUNTIME_DIR);
    add(env.TMPDIR);
    add(env.TMP);
    add(env.TEMP);
    add("/tmp");
    // Flatpak and Snap put the socket inside their own runtime directory.
    if (env.XDG_RUNTIME_DIR) {
      add(path.join(env.XDG_RUNTIME_DIR, "snap.discord"));
      add(path.join(env.XDG_RUNTIME_DIR, "app", "com.discordapp.Discord"));
    }
  }
  const paths = [];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) paths.push(path.join(dir, `discord-ipc-${i}`));
  }
  return paths;
}

export function encodeFrame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(8 + json.length);
  frame.writeInt32LE(op, 0);
  frame.writeInt32LE(json.length, 4);
  json.copy(frame, 8);
  return frame;
}

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const httpUrl = (v, max = 512) => {
  const url = text(v, max)?.trim();
  return url && /^https?:\/\/\S+$/i.test(url) ? url : undefined;
};

/** Whitelists the fields Discord accepts; the renderer is untrusted input like any page. */
export function sanitizeActivity(input) {
  if (!input || typeof input !== "object") return null;
  const activity = {};
  const type = Number(input.type);
  if (Number.isInteger(type) && type >= 0 && type <= 5) activity.type = type;
  const name = text(input.name, 128)?.trim();
  if (name) activity.name = name;
  const display = Number(input.status_display_type);
  if (Number.isInteger(display) && display >= 0 && display <= 2) activity.status_display_type = display;
  const details = text(input.details, 128);
  const state = text(input.state, 128);
  if (details) {
    activity.details = details;
    const url = httpUrl(input.details_url);
    if (url) activity.details_url = url;
  }
  if (state) {
    activity.state = state;
    const url = httpUrl(input.state_url);
    if (url) activity.state_url = url;
  }
  // SET_ACTIVITY takes the gateway Activity object, whose timestamps are unix milliseconds.
  const start = Number(input.timestamps?.start);
  if (Number.isFinite(start) && start > 0) activity.timestamps = { start: Math.round(start) };
  const assets = input.assets;
  if (assets && typeof assets === "object") {
    const out = {};
    for (const key of ["large_image", "small_image"]) {
      const v = text(assets[key], 256)?.trim();
      if (v) out[key] = v;
    }
    for (const key of ["large_text", "small_text"]) {
      const v = text(assets[key], 128)?.trim();
      if (v) out[key] = v;
    }
    for (const key of ["large_url", "small_url"]) {
      const v = httpUrl(assets[key]);
      if (v) out[key] = v;
    }
    if (Object.keys(out).length) activity.assets = out;
  }
  if (Array.isArray(input.buttons)) {
    const buttons = [];
    for (const b of input.buttons) {
      if (buttons.length === 2) break;
      const label = text(b?.label, 32)?.trim();
      const url = httpUrl(b?.url);
      if (label && url) buttons.push({ label, url });
    }
    if (buttons.length) activity.buttons = buttons;
  }
  // Discord drops activities with no real content in practice; don't spam it with empty updates.
  // A timer alone shows nothing, so timestamps don't count.
  const meaningful = activity.name || activity.details || activity.state || activity.assets || activity.buttons;
  return meaningful ? activity : null;
}

/**
 * Discord publishes every RPC application's public profile — including its uploaded art — at
 * GET /oauth2/applications/{id}/rpc, so the settings preview can render the real pictures
 * instead of a stand-in. Assets cache for five minutes per application id.
 */
const OAUTH_APP_URL = "https://discord.com/api/oauth2/applications";
const assetsCache = new Map();
const ASSETS_TTL_MS = 5 * 60_000;

export function clearDiscordApplicationCache() {
  assetsCache.clear();
}

export async function fetchDiscordApplication(clientId, fetchFn = fetch) {
  const id = String(clientId ?? "").trim();
  if (!/^\d{16,22}$/.test(id)) throw new Error("Add a valid Discord application id (numbers only)");
  const cached = assetsCache.get(id);
  if (cached && Date.now() - cached.at < ASSETS_TTL_MS) return cached.app;
  const res = await fetchFn(`${OAUTH_APP_URL}/${id}/rpc`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Discord answered ${res.status} for application ${id}`);
  const data = await res.json();
  const app = {
    name: typeof data?.name === "string" ? data.name : "",
    icon: typeof data?.icon === "string" ? data.icon : "",
    assets: Array.isArray(data?.assets)
      ? data.assets
          .filter((a) => a && typeof a.id === "string" && typeof a.name === "string")
          .map((a) => ({ id: a.id, name: a.name, type: Number(a.type) === 2 ? "gif" : "png" }))
      : [],
  };
  assetsCache.set(id, { at: Date.now(), app });
  return app;
}

const sameStatus = (a, b) =>
  a.enabled === b.enabled && a.connected === b.connected && a.clientId === b.clientId && a.error === b.error;

/**
 * @param {object} [options]
 * @param {(p: string) => import("node:net").Socket} [options.createConnection]
 * @param {string[]} [options.paths]
 * @param {number} [options.connectTimeoutMs]
 * @param {number} [options.minUpdateMs] Discord rate-limits SET_ACTIVITY, so updates are coalesced.
 * @param {number} [options.retryMs] Base delay before trying to find a running Discord again.
 * @param {(status: object) => void} [options.onStatus]
 */
export function createDiscordRpc(options = {}) {
  // A shared dir like /tmp lets another user pre-bind discord-ipc-0 and read every presence
  // payload, so on unix only a socket owned by this user is connected to.
  const createConnection =
    options.createConnection ??
    ((p) => {
      if (process.platform !== "win32" && !p.startsWith("\\\\")) {
        const st = fs.lstatSync(p);
        if (!st.isSocket() || st.uid !== process.getuid()) throw new Error("not our socket");
      }
      return net.createConnection(p);
    });
  const paths = options.paths ?? discordIpcPaths();
  const connectTimeoutMs = options.connectTimeoutMs ?? 1200;
  const minUpdateMs = options.minUpdateMs ?? 15_000;
  const retryMs = options.retryMs ?? 5_000;
  const onStatus = options.onStatus ?? (() => {});

  let desired = { enabled: false, clientId: "" };
  let status = { enabled: false, connected: false, clientId: "", error: null };
  let socket = null;
  let ready = false;
  let connecting = false;
  let retryTimer;
  let flushTimer;
  let retryAttempt = 0;
  let nonce = 0;
  let receive = Buffer.alloc(0);
  let requested;
  let lastSentJson = null;
  let lastSentAt = 0;
  let disposed = false;

  function setStatus(patch) {
    const next = { ...status, ...patch };
    if (sameStatus(next, status)) return;
    status = next;
    try {
      onStatus(next);
    } catch {
      /* a status listener must not break the client */
    }
  }

  function send(op, payload) {
    if (!socket || socket.destroyed) return false;
    try {
      socket.write(encodeFrame(op, payload));
      return true;
    } catch {
      return false;
    }
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!socket || !ready) return;
    const json = JSON.stringify(requested ?? null);
    if (json === lastSentJson) return;
    const wait = lastSentAt + minUpdateMs - Date.now();
    if (wait > 0) {
      flushTimer = setTimeout(flush, wait);
      flushTimer.unref?.();
      return;
    }
    if (
      send(OP_FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: requested ?? undefined },
        nonce: String(++nonce),
      })
    ) {
      lastSentJson = json;
      lastSentAt = Date.now();
    }
  }

  function schedulePresence(activity) {
    requested = activity ?? null;
    // A newer request may arrive while an older update waits out the rate limit.
    flush();
  }

  function onMessage(op, payload) {
    if (op === OP_PING) {
      send(OP_PONG, payload);
      return;
    }
    if (op === OP_CLOSE) {
      const message = payload?.message || payload?.code ? `Discord closed the connection: ${payload.message ?? payload.code}` : null;
      dropSocket(message);
      return;
    }
    if (payload?.evt === "READY") {
      ready = true;
      retryAttempt = 0;
      lastSentJson = null; // a fresh connection has no activity yet
      setStatus({ connected: true, error: null });
      flush();
    }
  }

  function onData(chunk) {
    receive = Buffer.concat([receive, chunk]);
    while (receive.length >= 8) {
      const op = receive.readInt32LE(0);
      const length = receive.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME) return dropSocket("Discord sent a malformed frame");
      if (receive.length < 8 + length) return;
      const body = receive.subarray(8, 8 + length).toString("utf8");
      receive = receive.subarray(8 + length);
      try {
        onMessage(op, JSON.parse(body));
      } catch {
        /* a malformed frame is not worth killing the connection over */
      }
    }
  }

  function dropSocket(error = null) {
    const s = socket;
    socket = null;
    ready = false;
    lastSentJson = null;
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (s) {
      s.removeAllListeners?.("data");
      s.removeAllListeners?.("error");
      s.removeAllListeners?.("close");
      try {
        s.destroy?.();
      } catch {
        /* already gone */
      }
    }
    if (desired.enabled && !disposed) {
      setStatus({ connected: false, error });
      scheduleRetry();
    } else {
      setStatus({ connected: false, error });
    }
  }

  function attach(s) {
    socket = s;
    receive = Buffer.alloc(0);
    s.on("data", onData);
    s.on("error", (err) => dropSocket(err instanceof Error ? err.message : String(err)));
    s.on("close", () => dropSocket("Discord closed the connection"));
    send(OP_HANDSHAKE, { v: 1, client_id: desired.clientId });
    setStatus({ enabled: true, connected: false, clientId: desired.clientId, error: null });
  }

  function tryPath(p) {
    return new Promise((resolve) => {
      let settled = false;
      let s;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s?.removeListener?.("connect", ok);
        s?.removeListener?.("error", fail);
        resolve(value);
      };
      const ok = () => finish(s);
      const fail = () => {
        try {
          s?.destroy?.();
        } catch {
          /* never connected */
        }
        finish(null);
      };
      try {
        s = createConnection(p);
      } catch {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => {
        try {
          s?.destroy?.();
        } catch {
          /* ignore */
        }
        finish(null);
      }, connectTimeoutMs);
      timer.unref?.();
      s.once("connect", ok);
      s.once("error", fail);
    });
  }

  async function connect() {
    if (connecting || disposed || !desired.enabled) return;
    connecting = true;
    try {
      for (const p of paths) {
        if (!desired.enabled || disposed) return;
        const s = await tryPath(p);
        if (s) {
          if (!desired.enabled || disposed) {
            try {
              s.destroy();
            } catch {
              /* ignore */
            }
            return;
          }
          attach(s);
          return;
        }
      }
      if (desired.enabled && !disposed) {
        setStatus({ connected: false, error: "Discord is not running" });
        scheduleRetry();
      }
    } finally {
      connecting = false;
    }
  }

  function scheduleRetry() {
    if (!desired.enabled || disposed || retryTimer) return;
    const delay = Math.min(retryMs * 2 ** retryAttempt, 60_000);
    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delay);
    retryTimer.unref?.();
  }

  function disconnect() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    clearTimeout(flushTimer);
    flushTimer = undefined;
    const s = socket;
    socket = null;
    ready = false;
    lastSentJson = null;
    if (s) {
      s.removeAllListeners?.("data");
      s.removeAllListeners?.("error");
      s.removeAllListeners?.("close");
      // Closing the IPC connection is what makes Discord clear the activity.
      try {
        s.end();
      } catch {
        /* ignore */
      }
      try {
        s.destroy?.();
      } catch {
        /* ignore */
      }
    }
  }

  return {
    /** Applies new settings. Enabling connects; disabling drops the activity and reconnects only
     * when enabled again. Safe to call repeatedly. */
    configure(config = {}) {
      const clientId = typeof config.clientId === "string" ? config.clientId.trim() : "";
      const enabled = !!config.enabled && /^\d{16,22}$/.test(clientId);
      const invalid = !!config.enabled && !enabled ? "Add a valid Discord application id (numbers only)" : null;
      const previous = desired;
      desired = { enabled, clientId };
      disposed = false;
      if (!enabled) {
        disconnect();
        retryAttempt = 0;
        setStatus({ enabled: false, connected: false, clientId, error: invalid });
        return { ...status };
      }
      if (socket && previous.clientId === clientId) return { ...status };
      if (socket || previous.clientId !== clientId) disconnect();
      retryAttempt = 0;
      setStatus({ enabled: true, connected: false, clientId, error: null });
      void connect();
      return { ...status };
    },
    /** `activity` is already-safe Discord activity JSON, or null to clear it. */
    setPresence(activity) {
      schedulePresence(sanitizeActivity(activity));
    },
    status() {
      return { ...status };
    },
    shutdown() {
      disposed = true;
      desired = { enabled: false, clientId: desired.clientId };
      disconnect();
      clearTimeout(retryTimer);
      retryTimer = undefined;
    },
  };
}

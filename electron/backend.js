// Connections to yoakeland servers: TLS for remote ones, the Unix socket for a
// local one (SPEC.md §2a). Messages are newline-delimited JSON (§2).
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { pairWithPin } from "./pair.js";
import { installedServer, installServer, latestRelease, managedBinPath } from "./serverInstall.js";

const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 400;
const isWindows = process.platform === "win32";

/** @type {Map<string, import("node:net").Socket>} */
const connections = new Map();

const expandTilde = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

function connected(sock, ready = "connect") {
  return new Promise((resolve, reject) => {
    sock.once(ready, resolve);
    sock.once("error", reject);
  });
}

async function probe(sock) {
  const t = setTimeout(() => sock.destroy(new Error("timeout")), PROBE_TIMEOUT_MS);
  try {
    await connected(sock);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
    sock.destroy();
  }
}

// Windows pipe names are global and Node can't check a pipe's owner, so local connections there are refused.
async function openLocal(p) {
  if (isWindows) {
    // ponytail: needs a native addon that compares the pipe's owner SID
    // (GetSecurityInfo) with the current user's, and retries ERROR_PIPE_BUSY.
    throw new Error("local connections on Windows aren't supported in this build yet; connect over TCP");
  }
  const sock = net.connect(p);
  await connected(sock).catch((e) => {
    throw new Error(`connect to ${p} failed: ${e.message}`);
  });
  return sock;
}

function adopt(sock, emit) {
  const connectionId = randomUUID();
  connections.set(connectionId, sock);
  let buf = "";
  let skipping = false; // dropping the rest of an oversized frame until its newline
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (skipping) {
        skipping = false;
        continue;
      }
      if (!line.trim()) continue;
      try {
        emit("yoake-event", { connectionId, envelope: JSON.parse(line) });
      } catch (e) {
        emit("yoake-log", { connectionId, message: `bad frame: ${e.message}: ${line}` });
      }
    }
    if (buf.length > MAX_FRAME_BYTES) {
      if (!skipping) emit("yoake-log", { connectionId, message: `dropped oversized frame (>${MAX_FRAME_BYTES} bytes)` });
      buf = "";
      skipping = true;
    }
  });
  let reason = "connection closed";
  sock.on("error", (e) => (reason = `read error: ${e.message}`));
  sock.on("close", () => {
    // `disconnect` deletes the entry first, so only unexpected closes report.
    if (connections.delete(connectionId)) emit("yoake-disconnected", { connectionId, reason });
  });
  return connectionId;
}

const send = (sock, obj) => sock.write(JSON.stringify(obj) + "\n");

const identity = ({ name, deviceType, avatar, deviceId }) =>
  Object.fromEntries(Object.entries({ name, deviceType, avatar, deviceId }).filter(([, v]) => v != null));

// Must match the server's default (yoakeland's internal/sockpath).
export function defaultSocketPath() {
  if (isWindows) return `\\\\.\\pipe\\yoakeland-${process.env.USERNAME ?? ""}`;
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) return `${xdg.replace(/\/+$/, "")}/yoake/yoakeland.sock`;
  const tmp = process.env.TMPDIR;
  if (process.platform === "darwin" && tmp) return `${tmp.replace(/\/+$/, "")}/yoake/yoakeland.sock`;
  return expandTilde("~/.yoake/yoakeland.sock");
}

// Logs go to a file, not a pipe: after the app exits, a write to a pipe would raise SIGPIPE and kill the server.
async function spawnDetached(dataDir, binPath, args) {
  await mkdir(dataDir, { recursive: true });
  const logFile = path.join(dataDir, "server.log");
  // Append, so a crash's output survives the respawn that follows it; start over once it's large.
  const log = openSync(logFile, (await stat(logFile).catch(() => null))?.size > 5_000_000 ? "w" : "a");
  try {
    const child = spawn(binPath, args, { detached: true, stdio: ["ignore", log, log], windowsHide: true });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (e) => reject(new Error(`failed to spawn ${binPath}: ${e.message}`)));
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

// Only the paired CA when there is one, otherwise the OS trust store (§2a).
function trustedCAs(caPem) {
  const pem = caPem?.trim();
  if (pem) {
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw new Error("no certificate found in the provided CA file");
    return pem;
  }
  return tls.getCACertificates?.("system") ?? undefined;
}

// Paths the user picked in a file dialog or dropped onto the window this session. The page can
// only read these, and only one of these can be a custom server binary (grantPaths).
const granted = new Set();
export function grantPaths(paths) {
  for (const p of paths ?? []) if (typeof p === "string" && path.isAbsolute(p)) granted.add(path.resolve(p));
}
const isGranted = (p) => typeof p === "string" && granted.has(path.resolve(p));

// Read by the page only for paths it was granted; the bridge can't name any other file.
async function readGranted(p, encoding) {
  if (!isGranted(p)) throw new Error(`not a file you picked: ${p}`);
  return readFile(p, encoding).catch((e) => {
    throw new Error(`failed to read ${p}: ${e.message}`);
  });
}

export function commands(emit, dataDir) {
  return {
    probe_tcp: ({ host, port }) => probe(net.connect({ host, port })),
    probe_unix: ({ path: p }) => probe(net.connect(expandTilde(p))),
    default_socket_path: () => defaultSocketPath(),
    // A bare daemon: it is configured at runtime over its socket (set_remote_access,
    // set_runtime_settings, ...), never by launch flags. Only a non-default socket
    // location is still a launch argument, because nothing can be told before it exists.
    spawn_detached_unix_server: async ({ binPath, socketPath }) => {
      const wanted = expandTilde(socketPath);
      // The bare default means "whatever is installed": a downloaded copy wins over PATH.
      if (binPath === "yoakeland" && (await installedServer(dataDir))) binPath = managedBinPath(dataDir);
      // Otherwise only a binary the user picked (ConnectForm, Onboarding); the page can't name another.
      else if (binPath !== "yoakeland" && !isGranted(binPath)) throw new Error(`not a server binary you picked: ${binPath}`);
      return spawnDetached(dataDir, binPath, wanted === defaultSocketPath() ? [] : ["-listen", `unix:${wanted}`]);
    },

    server_installed: () => installedServer(dataDir),
    server_latest_release: () => latestRelease(),
    server_install: () => installServer(dataDir),

    connect_tcp: async ({ host, port, token, caPem, ...rest }) => {
      const sock = tls.connect({
        host,
        port,
        ca: trustedCAs(caPem),
        // SNI can't carry an IP address; hostname verification still checks `host`.
        servername: net.isIP(host) ? undefined : host,
      });
      await connected(sock, "secureConnect").catch((e) => {
        throw new Error(
          `TLS connection to ${host}:${port} failed: ${e.message}. Is the right CA certificate paired for this server?`,
        );
      });
      const id = adopt(sock, emit);
      send(sock, { type: "auth", data: { token, ...identity(rest) } });
      return id;
    },

    // Trades an address and the PIN the server printed for a one-device credential and the CA to
    // trust it with (pair.js); the renderer then connects with those like with any pairing code.
    pair_tcp: ({ host, port, pin, ...rest }) => pairWithPin({ host, port, pin, ...identity(rest) }),

    connect_unix: async ({ path: p, ...rest }) => {
      const sock = await openLocal(expandTilde(p));
      const id = adopt(sock, emit);
      const data = identity(rest);
      if (Object.keys(data).length) send(sock, { type: "auth", data });
      return id;
    },

    send_envelope: ({ connectionId, envelope }) => {
      const sock = connections.get(connectionId);
      if (!sock) throw new Error("not connected");
      send(sock, envelope);
    },

    disconnect: ({ connectionId }) => {
      const sock = connections.get(connectionId);
      connections.delete(connectionId);
      sock?.destroy();
    },

    // User app themes, one file each, validated renderer-side (theme.ts parseThemeFiles).
    load_themes: () => loadThemes(dataDir),
    themes_reveal_path: () => themesRevealPath(dataDir),

    read_text_file: ({ path: p }) => readGranted(p, "utf8"),
    read_file_bytes: ({ path: p }) => readGranted(p),
  };
}

export function disconnectAll() {
  for (const [id, sock] of connections) {
    connections.delete(id);
    sock.destroy();
  }
}

const THEME_EXAMPLE = {
  name: "My theme",
  dark: { bg: "#101014", panelBg: "#16161c", text: "#e6e6ef", accent: "#ff7a90" },
  light: { bg: "#ece9ee", panelBg: "#faf8fb", text: "#1d1b22", accent: "#c4304f" },
};

/** Every themes/*.json as raw text; the renderer parses and reports per file. */
export async function loadThemes(dir) {
  const themes = path.join(dir, "themes");
  let names;
  try {
    names = await readdir(themes);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const files = names.filter((n) => n.toLowerCase().endsWith(".json")).sort();
  return Promise.all(files.map(async (file) => ({ file, text: await readFile(path.join(themes, file), "utf8") })));
}

/** A file in the themes folder to reveal, seeding an example when the folder has none. */
export async function themesRevealPath(dir) {
  const themes = path.join(dir, "themes");
  await mkdir(themes, { recursive: true });
  const [first] = (await readdir(themes)).filter((n) => n.toLowerCase().endsWith(".json")).sort();
  if (first) return path.join(themes, first);
  const example = path.join(themes, "example.json");
  await writeFile(example, JSON.stringify(THEME_EXAMPLE, null, 2) + "\n");
  return example;
}

// Electron's safeStorage (main.js calls setSecretStore): when the OS keeps a key for it, tokens are
// written encrypted as { enc }; otherwise, and for files from before, plaintext strings at 0600.
let secrets = null;
/** @param {{ available(): boolean, encrypt(s: string): string, decrypt(b64: string): string } | null} store */
export function setSecretStore(store) {
  secrets = store;
}
const encodeCredential = (v) => (secrets?.available() ? { enc: secrets.encrypt(v) } : v);
function decodeCredential(v) {
  if (typeof v === "string") return v;
  if (typeof v?.enc !== "string" || !secrets) return null;
  try {
    return secrets.decrypt(v.enc);
  } catch {
    return null; // encrypted under a key the OS no longer has: the server needs pairing again
  }
}

async function readCredentials(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, "credentials.json"), "utf8"));
  } catch {
    return {};
  }
}

export async function loadCredential(dir, key) {
  checkKey(key);
  const v = (await readCredentials(dir))[key];
  return v == null ? null : decodeCredential(v);
}

// Server ids are short strings; anything else is a bad call, not a key to store.
function checkKey(key) {
  if (typeof key !== "string" || !key || key.length > 200) throw new Error("bad credential key");
}

async function writeCredential(dir, key, value) {
  const all = await readCredentials(dir);
  // Every plaintext entry is encrypted by this write too, which migrates an older file.
  for (const [k, v] of Object.entries(all)) if (typeof v === "string") all[k] = encodeCredential(v);
  if (value == null) delete all[key];
  else all[key] = encodeCredential(value);
  await mkdir(dir, { recursive: true });
  // Temp file and rename, so a crash can't leave a truncated file.
  const file = path.join(dir, "credentials.json");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
  await rename(tmp, file);
}

// Read-modify-write of one file: stores queue up so parallel ones (startup connects) don't read the same snapshot and drop each other's key.
let credentialQueue = Promise.resolve();

/** An absent `value` deletes the entry. */
export async function storeCredential(dir, key, value) {
  checkKey(key);
  if (value != null && typeof value !== "string") throw new Error("bad credential value");
  credentialQueue = credentialQueue.catch(() => {}).then(() => writeCredential(dir, key, value));
  return credentialQueue;
}

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// The server's per-project data dir: the sha256 of the project root (projectstore.DataDir).
const dataDir = (state, root) => path.join(state, "projects", createHash("sha256").update(root).digest("hex").slice(0, 16));

// What belongs to the user. Everything else stays behind: tls/ and server.json hold the server's
// identity and secrets (tokens, keys), which a copy must not share; logs, audit and caches are not data.
const COPIED = ["projects", "chats", "uploads", "snapshots", "providers.json", "mcp.json", "skills.json", "schedules.json", "projects.json", "spend.json", "usage.json"];
// server.json settings carried over: the name and icon stay, but a copy is a separate server, so no serverId, tokens or remote listener.
const SETTINGS = ["identity", "icon", "autoGenerateTitle", "modelRoles", "notify", "runtime", "defaultProvider"];

// Project and chat records name absolute paths inside the state dir (chat scratch roots, uploads).
async function rewritePaths(dir, from, to) {
  await Promise.all(
    (await readdir(dir, { withFileTypes: true })).map(async (e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return rewritePaths(f, from, to);
      if (!e.name.endsWith(".json")) return;
      const text = await readFile(f, "utf8");
      if (text.includes(`${from}/`)) await writeFile(f, text.replaceAll(`${from}/`, `${to}/`));
    }),
  );
}

// Present in the target while a copy runs, so a copy cut short (app closed) is redone, not mistaken for a decision.
const MARKER = ".copying";

/** Early's first run: stable has state to offer and early has none yet (or only a half-made copy). */
export const copyPending = (from, to) => existsSync(from) && (!existsSync(to) || existsSync(path.join(to, MARKER)));

// Copies a server state dir. A chat's scratch root lives inside it (<state>/chats/<id>), so its
// history is filed under the hash of that path; moving the state changes the path, so re-file them.
// Best done with the source server stopped: a file caught mid-write is copied torn.
export async function copyState(from, to, onProgress = () => {}) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await writeFile(path.join(to, MARKER), "");
  const items = COPIED.filter((n) => existsSync(path.join(from, n)));
  let done = 0;
  onProgress({ done, total: items.length + 1 });
  await Promise.all(items.map((n) => cp(path.join(from, n), path.join(to, n), { recursive: true }).then(() => onProgress({ done: ++done, total: items.length + 1 }))));

  const src = path.join(from, "server.json");
  if (existsSync(src)) {
    const old = JSON.parse(await readFile(src, "utf8"));
    const kept = Object.fromEntries(SETTINGS.filter((k) => old[k] != null).map((k) => [k, old[k]]));
    await writeFile(path.join(to, "server.json"), JSON.stringify(kept, null, 2), { mode: 0o600 });
  }

  const chats = path.join(from, "chats");
  if (existsSync(chats)) {
    for (const id of await readdir(chats)) {
      const stale = dataDir(to, path.join(chats, id));
      if (existsSync(stale)) await rename(stale, dataDir(to, path.join(to, "chats", id)));
    }
  }
  if (existsSync(path.join(to, "projects"))) await rewritePaths(path.join(to, "projects"), from, to);
  await rm(path.join(to, MARKER));
  onProgress({ done: items.length + 1, total: items.length + 1 });
}

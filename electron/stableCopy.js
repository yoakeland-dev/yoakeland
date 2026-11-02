import { cpSync, existsSync, readdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// The server's per-project data dir: the sha256 of the project root (projectstore.DataDir).
const dataDir = (state, root) => path.join(state, "projects", createHash("sha256").update(root).digest("hex").slice(0, 16));

// Copies a server state dir. A chat's scratch root lives inside it (<state>/chats/<id>), so its
// history is filed under the hash of that path; moving the state changes the path, so re-file them.
export function copyState(from, to) {
  cpSync(from, to, { recursive: true, filter: (f) => !/\.sock$|server\.log$/.test(f) });
  const chats = path.join(from, "chats");
  if (!existsSync(chats)) return;
  for (const id of readdirSync(chats)) {
    const old = dataDir(to, path.join(chats, id));
    if (existsSync(old)) renameSync(old, dataDir(to, path.join(to, "chats", id)));
  }
}

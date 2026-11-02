import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { copyPending, copyState } from "./stableCopy.js";

const hash = (root) => createHash("sha256").update(root).digest("hex").slice(0, 16);

test("copies user data, not identity or secrets, and moves chat paths to the new state dir", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "copy-"));
  const from = path.join(base, "a"), to = path.join(base, "b");
  const chat = path.join(from, "chats", "c1");
  mkdirSync(chat, { recursive: true });
  mkdirSync(path.join(from, "projects", hash(chat)), { recursive: true });
  writeFileSync(path.join(from, "projects", hash(chat), "project.json"), JSON.stringify({ path: chat }));
  mkdirSync(path.join(from, "tls"));
  writeFileSync(path.join(from, "tls", "ca.key"), "secret");
  writeFileSync(path.join(from, "yoakeland.sock"), "");
  writeFileSync(path.join(from, "providers.json"), "{}");
  writeFileSync(path.join(from, "server.json"), JSON.stringify({ identity: "fish", serverId: "abc", tokens: { default: {} }, remote: { enabled: true }, runtime: { x: 1 } }));

  await copyState(from, to);

  assert.ok(existsSync(path.join(to, "providers.json")));
  assert.ok(!existsSync(path.join(to, "tls")) && !existsSync(path.join(to, "yoakeland.sock")));
  assert.deepEqual(JSON.parse(readFileSync(path.join(to, "server.json"), "utf8")), { identity: "fish", runtime: { x: 1 } });
  const moved = path.join(to, "projects", hash(path.join(to, "chats", "c1")), "project.json");
  assert.deepEqual(JSON.parse(readFileSync(moved, "utf8")), { path: path.join(to, "chats", "c1") });
});

test("a copy is pending until one has finished", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "copy-"));
  const from = path.join(base, "a"), to = path.join(base, "b");
  assert.ok(!copyPending(from, to), "nothing to copy from");
  mkdirSync(from);
  assert.ok(copyPending(from, to));
  mkdirSync(to);
  writeFileSync(path.join(to, ".copying"), "");
  assert.ok(copyPending(from, to), "a cut-short copy is offered again");
  await copyState(from, to);
  assert.ok(!copyPending(from, to));
});

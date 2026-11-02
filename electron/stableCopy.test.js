import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { copyState } from "./stableCopy.js";

const hash = (root) => createHash("sha256").update(root).digest("hex").slice(0, 16);

test("copies state, skips sockets, and re-files a chat's history under its new path", () => {
  const base = mkdtempSync(path.join(tmpdir(), "copy-"));
  const from = path.join(base, "a"), to = path.join(base, "b");
  mkdirSync(path.join(from, "chats", "c1"), { recursive: true });
  mkdirSync(path.join(from, "projects", hash(path.join(from, "chats", "c1"))), { recursive: true });
  writeFileSync(path.join(from, "projects", hash(path.join(from, "chats", "c1")), "x"), "1");
  writeFileSync(path.join(from, "yoakeland.sock"), "");
  writeFileSync(path.join(from, "providers.json"), "{}");
  copyState(from, to);
  assert.ok(existsSync(path.join(to, "providers.json")));
  assert.ok(!existsSync(path.join(to, "yoakeland.sock")));
  assert.ok(existsSync(path.join(to, "projects", hash(path.join(to, "chats", "c1")), "x")));
});

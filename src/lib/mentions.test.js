// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { MENTION_RE, mentionText, resolveFileRef } from "./mentions.ts";

test("mentions with and without line ranges", () => {
  const all = (s) => [...s.matchAll(new RegExp(MENTION_RE.source, "g"))].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(all("see @src/a.ts#L10-20 and @b.go#L7, then @c.md."), [
    ["src/a.ts", "10", "20"],
    ["b.go", "7", undefined],
    ["c.md.", undefined, undefined],
  ]);
  assert.deepEqual(all("mail me@host.com"), []);
  assert.equal(mentionText("a.ts"), "@a.ts");
  assert.equal(mentionText("a.ts", 3, 3), "@a.ts#L3");
  assert.equal(mentionText("a.ts", 3, 9), "@a.ts#L3-9");
});

test("inline code naming a project file", () => {
  const files = ["src/lib/a.ts", "src/b/index.ts", "src/c/index.ts", "README.md"];
  assert.deepEqual(resolveFileRef("src/lib/a.ts", files), { path: "src/lib/a.ts", from: undefined, to: undefined });
  assert.deepEqual(resolveFileRef("a.ts:12-20", files), { path: "src/lib/a.ts", from: 12, to: 20 });
  assert.deepEqual(resolveFileRef("/home/me/p/README.md#L3", files, "/home/me/p"), { path: "README.md", from: 3, to: 3 });
  assert.deepEqual(resolveFileRef("@src/lib/a.ts#L4", files), { path: "src/lib/a.ts", from: 4, to: 4 });
  assert.equal(resolveFileRef("index.ts", files), null); // two of them
  assert.equal(resolveFileRef("const x = 1", files), null);
  assert.equal(resolveFileRef("npm", files), null);
});

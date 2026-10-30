// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { Marked } from "marked";
import { MENTION_RE, mentionText, resolveFileRef, chatMentionsToIds, chatLabel, withMentions, knownSkills } from "./mentions.ts";

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

test("chat mentions get their ID on send and render as a chip", () => {
  const ids = new Map([["Fix login", "s1"]]);
  assert.equal(chatMentionsToIds("see #[Fix login] and #[Other] and #L10", ids), "see #[Fix login](chat:s1) and #[Other] and #L10");
  assert.equal(chatMentionsToIds("#[Fix login](chat:s1)", ids), "#[Fix login](chat:s1)");
  assert.equal(chatLabel("a [b]\nc"), "a b c");
  const html = withMentions(new Marked()).parseInline("use #[Fix <login>](chat:s-1) please @src/a.ts");
  assert.match(html, /data-chat="s-1"[^>]*>Fix &lt;login&gt;<\/span>/);
  assert.match(html, /data-path="src\/a.ts"/);
});

test("$skill chips only for known skills", () => {
  knownSkills.current = new Set(["review"]);
  const md = withMentions(new Marked());
  assert.match(md.parseInline("run $review now"), /skill-ref">\$review</);
  assert.doesNotMatch(md.parseInline("costs $5 or $HOME"), /skill-ref/);
});

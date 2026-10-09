// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { briefOf, clip, continuationDraft, projectStarters } from "./chatBrief.ts";

const msg = (role, text, toolCalls = []) => ({ id: text, role, text, toolCalls, streaming: false, createdAt: 0 });

test("a brief reads the first and last ask, the last reply and the files", () => {
  const b = briefOf([
    msg("user", "make a plot"),
    msg("assistant", "Done.", [{ diffs: [{ filePath: "plot.py" }, { filePath: "plot.png" }] }]),
    msg("user", "now log scale"),
    msg("assistant", "Switched the y axis to log.", [{ diff: { filePath: "plot.py" } }]),
  ]);
  assert.equal(b.firstAsk, "make a plot");
  assert.equal(b.lastAsk, "now log scale");
  assert.equal(b.lastReply, "Switched the y axis to log.");
  assert.deepEqual(b.files, ["plot.py", "plot.png"]);
  assert.equal(briefOf([msg("user", "hi")]).lastAsk, undefined);
});

test("clip collapses whitespace and cuts with an ellipsis", () => {
  assert.equal(clip("a\n\n b", 10), "a b");
  assert.equal(clip("abcdefghij", 5), "abcd…");
});

test("the continuation draft names the copied files only when there are some", () => {
  const b = briefOf([msg("user", "hello"), msg("assistant", "hi")]);
  assert.match(continuationDraft("T", b, { dir: "chat-x", files: 2 }), /Its 2 files are in `chat-x\/`/);
  assert.doesNotMatch(continuationDraft("T", b), /are in/);
});

test("project starters follow what is there", () => {
  const s = projectStarters(["README.md", "a_test.go"], 3);
  assert.equal(s[0].title, "Review my uncommitted changes");
  assert.ok(s.some((x) => x.title === "Run the tests and fix failures"));
  assert.ok(projectStarters(undefined, 0).some((x) => x.title === "Find what's untested"));
  assert.ok(s.length <= 4);
});

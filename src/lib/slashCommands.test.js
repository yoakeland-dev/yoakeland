// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashCommand, parseTokens } from "./slashCommands.ts";

test("/compact takes the rest of the message as instructions", () => {
  assert.deepEqual(parseSlashCommand("/compact"), { kind: "compact", instructions: "" });
  assert.deepEqual(parseSlashCommand("/compact keep the schema\nand the failing test"), {
    kind: "compact",
    instructions: "keep the schema\nand the failing test",
  });
});

test("/autocompact on, off, default and sizes", () => {
  assert.deepEqual(parseSlashCommand("/autocompact off"), { kind: "autocompact", auto: false, tokens: null });
  assert.deepEqual(parseSlashCommand("/autocompact 400k"), { kind: "autocompact", auto: true, tokens: 400000 });
  assert.deepEqual(parseSlashCommand("/autocompact default"), { kind: "autocompact", auto: true, tokens: 0 });
  assert.deepEqual(parseSlashCommand("/autocompact"), { kind: "autocompact-help" });
  assert.equal(parseSlashCommand("/autocompact soon").kind, "invalid");
  assert.equal(parseSlashCommand("/autocompact 0").kind, "invalid");
});

test("anything else is an ordinary message", () => {
  assert.equal(parseSlashCommand("/etc/hosts is wrong"), null);
  assert.equal(parseSlashCommand("/compacted"), null);
  assert.equal(parseSlashCommand("please /compact"), null);
});

test("sizes", () => {
  assert.equal(parseTokens("1.5m"), 1500000);
  assert.equal(parseTokens("12000"), 12000);
  assert.equal(parseTokens("k"), null);
});

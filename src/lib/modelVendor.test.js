// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { titleFor } from "./modelVendor.ts";

const entry = (kind, id, displayName = "") => ({
  provider: { kind, name: kind.replace("cli_", ""), httpProvider: "" },
  model: { id, displayName },
});

test("cli ids with a vendor/ prefix read without it", () => {
  assert.equal(titleFor({ provider: { kind: "cli_opencode" }, model: { id: "opencode/grok-code", displayName: "" } }), "Grok Code");
  assert.equal(titleFor(entry("cli_opencode", "opencode/qwen3-coder")), "Qwen3 Coder");
  assert.equal(titleFor(entry("cli_opencode", "opencode/claude-sonnet-5-5")), "Claude Sonnet 5.5");
  // a displayName that merely repeats the id is still treated as the id
  assert.equal(titleFor(entry("cli_opencode", "opencode/grok-code", "opencode/grok-code")), "Grok Code");
});

test("cli displayNames that differ from the id are kept, minus a vendor prefix", () => {
  assert.equal(titleFor(entry("cli_opencode", "opencode/grok-code", "Grok Code")), "Grok Code");
  assert.equal(titleFor(entry("cli_opencode", "opencode/grok-code", "opencode/Grok Code")), "Grok Code");
});

test("cli ids without a vendor prefix are just title-cased", () => {
  assert.equal(titleFor(entry("cli_claude", "claude-subscription", "claude-subscription")), "Claude Subscription");
  assert.equal(titleFor(entry("cli_claude", "claude-sonnet-4-5", "claude-sonnet-4-5")), "Claude Sonnet 4 5");
  assert.equal(titleFor(entry("cli_codex", "gpt-5.1-codex")), "Gpt 5.1 Codex");
});

test("a slash id for a non-CLI provider is left alone", () => {
  assert.equal(titleFor(entry("api_key", "anthropic/claude-sonnet-4")), "anthropic/claude-sonnet-4");
});

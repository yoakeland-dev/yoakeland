// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { alwaysAnswer, defaultSuggestion, describeRule, legacyRemember, modesLabel, ruleFromForm, sortRules, toolLabel } from "./permissionRules.ts";

const rule = (over) => ({ id: "r", tool: "bash", pattern: ["x"], text: "x", decision: "allow", scope: "project", ...over });

test("deny sorts before ask before allow, wider scopes first", () => {
  const sorted = sortRules([
    rule({ id: "a", decision: "allow", scope: "global", text: "a" }),
    rule({ id: "b", decision: "deny", scope: "session", text: "b" }),
    rule({ id: "c", decision: "ask", scope: "project", text: "c" }),
    rule({ id: "d", decision: "deny", scope: "global", text: "d" }),
    rule({ id: "p", decision: "allow", scope: "builtin", text: "ls *", readonly: true }),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["d", "b", "c", "a", "p"]);
});

test("modes label: an allow with none applies in Ask, Edit and Auto, never read-only", () => {
  assert.equal(modesLabel({ decision: "allow" }), "Ask, Edit, Auto");
  assert.equal(modesLabel({ decision: "deny" }), "every mode");
  assert.equal(modesLabel({ decision: "allow", modes: ["accept_edits", "auto"] }), "Edit, Auto");
});

test("the default pick is the broadest suggestion, else the first", () => {
  assert.equal(defaultSuggestion(undefined), -1);
  assert.equal(defaultSuggestion([]), -1);
  assert.equal(defaultSuggestion([{ id: "exact", label: "" }]), 0);
  assert.equal(defaultSuggestion([{ id: "exact", label: "" }, { id: "prefix", label: "" }]), 1);
  assert.equal(defaultSuggestion([{ id: "dir", label: "" }, { id: "exact", label: "" }]), 0);
});

test("an always-allow answer names the suggestion and scope; a native one has no scope", () => {
  const sug = [{ id: "prefix", label: "" }, { id: "native:0", label: "", native: true }];
  assert.deepEqual(alwaysAnswer(sug, 0, "session"), { remember: false, ruleId: "prefix", scope: "session" });
  assert.deepEqual(alwaysAnswer(sug, 1, "session"), { remember: false, ruleId: "native:0" });
  assert.equal(alwaysAnswer(sug, 5, "project"), null);
  assert.equal(alwaysAnswer(undefined, 0, "project"), null);
});

test("legacy remember only for an older server: a cache key and no suggestions", () => {
  assert.equal(legacyRemember({ cacheKey: "file_write:a.go" }), true);
  assert.equal(legacyRemember({ cacheKey: "", suggestions: [] }), false);
  assert.equal(legacyRemember({ cacheKey: "file_write:a.go", suggestions: [{ id: "exact", label: "" }] }), false);
});

test("describeRule reads as a sentence", () => {
  assert.equal(describeRule(rule({ text: "go test *", modes: ["read_write", "accept_edits", "auto"] })), "Allow Command go test * — Ask, Edit, Auto");
  assert.equal(describeRule(rule({ decision: "deny", tool: "edit", text: ".env*" })), "Never allow Edit .env* — every mode");
});

test("MCP rules: the form's tool name becomes the rule's tool, and they read as server: tool", () => {
  assert.deepEqual(ruleFromForm("mcp", " mcp__github__* "), { tool: "mcp__github__*", text: "*" });
  assert.deepEqual(ruleFromForm("bash", " ls * "), { tool: "bash", text: "ls *" });
  assert.equal(toolLabel("mcp__github__*"), "github: any tool");
  assert.equal(toolLabel("mcp__github__create_issue"), "github: Create issue");
  assert.equal(toolLabel("bash"), "Command");
  assert.equal(describeRule(rule({ tool: "mcp__github__*", text: "mcp__github__*", pattern: ["*"] })), "Allow github: any tool — Ask, Edit, Auto");
});

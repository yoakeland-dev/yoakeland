// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_KINDS, auditIsRisky, auditKindLabel, describeAudit } from "./audit.ts";

const ev = (over) => ({ seq: 1, at: "2026-09-30T10:00:00Z", kind: "tool_exec", ...over });

test("every kind the server writes has a label (Go audit.Kinds)", () => {
  const kinds = [
    "perm_decision", "perm_auto", "tool_exec", "mode_change", "rule_add", "rule_remove", "limit_pause",
    "provider_add", "provider_remove", "settings_change", "remote_access", "remote_password", "token_add",
    "token_remove", "peer_join", "peer_leave", "peer_kick", "auth_fail", "snapshot_restore", "terminal_open",
    "file_write", "fs_op", "session_delete", "project_remove", "mcp_server", "skill_change", "server_restart",
  ];
  assert.deepEqual(AUDIT_KINDS.map((k) => k.kind), kinds);
  for (const k of kinds) assert.notEqual(auditKindLabel(k), k);
  assert.equal(auditKindLabel("future_kind"), "future_kind");
});

test("sentences name who did what", () => {
  assert.equal(
    describeAudit(ev({ kind: "perm_decision", actor: "laptop", tool: "bash", target: "rm -rf build", outcome: "allow", detail: { remember: true } })),
    "laptop allowed bash rm -rf build and remembered it",
  );
  assert.equal(
    describeAudit(ev({ kind: "perm_auto", tool: "bash", target: "ls", outcome: "allow", detail: { via: "autonomous" } })),
    "Allowed bash ls by autonomous mode",
  );
  assert.equal(
    describeAudit(ev({ kind: "perm_auto", tool: "bash", target: "rm x", outcome: "deny", detail: { ruleId: "abc" } })),
    "Denied bash rm x by rule abc",
  );
  assert.equal(describeAudit(ev({ kind: "settings_change", actor: "phone", detail: { keys: ["maxRoundsPerTurn", "a"] } })), "phone changed maxRoundsPerTurn, a");
  assert.equal(describeAudit(ev({ kind: "auth_fail", ip: "1.2.3.4", detail: { alsoRejected: 4 } })), "Wrong credential from 1.2.3.4 (+4 more)");
  assert.equal(describeAudit(ev({ kind: "mode_change", actor: "phone", detail: { from: "read_write", to: "autonomous" } })), "phone set the mode to autonomous (was read_write)");
  assert.equal(describeAudit(ev({ kind: "something_new", actor: "x" })), "x: something_new");
});

test("what widens access is flagged, routine work is not", () => {
  assert.equal(auditIsRisky(ev({ kind: "perm_auto", outcome: "allow", detail: { via: "autonomous" } })), true);
  assert.equal(auditIsRisky(ev({ kind: "perm_auto", outcome: "allow", detail: { ruleId: "r" } })), false);
  assert.equal(auditIsRisky(ev({ kind: "perm_decision", outcome: "allow", detail: { remember: true } })), true);
  assert.equal(auditIsRisky(ev({ kind: "perm_decision", outcome: "allow", detail: {} })), false);
  assert.equal(auditIsRisky(ev({ kind: "token_add" })), true);
  assert.equal(auditIsRisky(ev({ kind: "tool_exec" })), false);
});

test("MCP and skill events read as sentences, and adding a server is flagged", () => {
  const e = (d, target = "github") => ev({ kind: "mcp_server", actor: "laptop", target, outcome: "ok", detail: d });
  assert.equal(describeAudit(e({ action: "save", renamedFrom: "" })), "laptop added MCP server github");
  assert.equal(describeAudit(e({ action: "save", renamedFrom: "gh" })), "laptop changed MCP server gh (now github)");
  assert.equal(describeAudit(e({ action: "approve", enabled: true })), "laptop approved the project's MCP server github");
  assert.equal(describeAudit(e({ action: "tool", enabled: false, tool: "delete_repo" })), "laptop hid delete_repo from MCP server github");
  assert.equal(describeAudit(e({ action: "disable", enabled: false })), "laptop turned off MCP server github");
  assert.equal(describeAudit(ev({ kind: "skill_change", actor: "laptop", target: "review-pr", detail: { enabled: true } })), "laptop turned on skill review-pr");
  assert.equal(auditIsRisky(e({ action: "save" })), true);
});

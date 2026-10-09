// Wording for the server's audit log (yoakeland internal/audit): what each kind is called, which
// ones are worth a second look, and one plain sentence per event.
import type { AuditEvent } from "./types";

export interface AuditKind {
  kind: string;
  label: string;
  /** Kinds that widen what the agent or the network can do get the warning colour. */
  risky?: boolean;
}

export const AUDIT_KINDS: AuditKind[] = [
  { kind: "perm_decision", label: "Approvals" },
  { kind: "perm_auto", label: "Auto answers", risky: true },
  { kind: "tool_exec", label: "Commands & edits" },
  { kind: "mode_change", label: "Mode changes" },
  { kind: "rule_add", label: "Rules added", risky: true },
  { kind: "rule_remove", label: "Rules removed" },
  { kind: "limit_pause", label: "Limit pauses" },
  { kind: "provider_add", label: "Providers added" },
  { kind: "provider_remove", label: "Providers removed" },
  { kind: "settings_change", label: "Settings" },
  { kind: "remote_access", label: "Remote access", risky: true },
  { kind: "remote_password", label: "Password changes", risky: true },
  { kind: "token_add", label: "Tokens added", risky: true },
  { kind: "token_remove", label: "Tokens revoked" },
  { kind: "peer_join", label: "Connections" },
  { kind: "peer_leave", label: "Disconnections" },
  { kind: "peer_kick", label: "Kicked devices" },
  { kind: "auth_fail", label: "Failed logins", risky: true },
  { kind: "snapshot_restore", label: "Snapshot restores" },
  { kind: "terminal_open", label: "Terminals" },
  { kind: "file_write", label: "File saves" },
  { kind: "fs_op", label: "File operations" },
  { kind: "session_delete", label: "Chats deleted" },
  { kind: "project_remove", label: "Projects removed" },
  { kind: "mcp_server", label: "MCP servers", risky: true },
  { kind: "skill_change", label: "Skills" },
];

/** The filter row groups the kinds into a few chips; each one toggles all of its kinds. */
export const AUDIT_CATEGORIES: { label: string; kinds: string[] }[] = [
  { label: "Approvals", kinds: ["perm_decision", "perm_auto", "rule_add", "rule_remove", "mode_change", "limit_pause"] },
  { label: "Activity", kinds: ["tool_exec", "terminal_open", "file_write", "fs_op", "snapshot_restore", "session_delete", "project_remove"] },
  { label: "Access", kinds: ["remote_access", "remote_password", "token_add", "token_remove", "peer_join", "peer_leave", "peer_kick", "auth_fail"] },
  { label: "Config", kinds: ["settings_change", "provider_add", "provider_remove", "mcp_server", "skill_change"] },
];

export const auditKindLabel = (kind: string) => AUDIT_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** An event is risky when its kind widens access, or the agent was let through without being asked. */
export function auditIsRisky(e: AuditEvent): boolean {
  if (e.kind === "perm_auto") return e.outcome === "allow" && e.detail?.via === "autonomous";
  if (e.kind === "perm_decision") return e.detail?.remember === true && e.outcome === "allow";
  return !!AUDIT_KINDS.find((k) => k.kind === e.kind)?.risky && e.kind !== "perm_auto";
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One sentence: who did what, to what. */
export function describeAudit(e: AuditEvent): string {
  const who = e.actor || "someone";
  const on = e.target ? ` ${e.target}` : "";
  const d = e.detail ?? {};
  switch (e.kind) {
    case "perm_decision":
      return `${who} ${e.outcome === "allow" ? "allowed" : "denied"} ${e.tool ?? "a call"}${on}${d.remember ? " and remembered it" : ""}`;
    case "perm_auto": {
      const how = d.via === "autonomous" ? "autonomous mode" : d.ruleId ? `rule ${str(d.ruleId)}` : str(d.via) || "policy";
      return `${e.outcome === "allow" ? "Allowed" : "Denied"} ${e.tool ?? "a call"}${on} by ${how}`;
    }
    case "tool_exec":
      return `${e.tool ?? "A tool"} ran${on}`;
    case "mode_change":
      return `${who} set the mode to ${str(d.to) || e.target} (was ${str(d.from) || "?"})`;
    case "rule_add":
      return `${who} added ${e.outcome} rule for ${e.tool ?? "a tool"}${on}`;
    case "rule_remove":
      return `${who} removed ${e.outcome} rule for ${e.tool ?? "a tool"}${on}`;
    case "limit_pause":
      return e.outcome === "asked" ? `A turn paused at a limit: ${e.target ?? ""}` : `${who} chose to ${e.outcome} at a limit`;
    case "provider_add":
      return `${who} registered provider${on}`;
    case "provider_remove":
      return `${who} removed provider${on}`;
    case "settings_change": {
      const keys = Array.isArray(d.keys) ? d.keys.join(", ") : e.target;
      return `${who} changed ${keys}`;
    }
    case "remote_access":
      return `${who} turned remote access ${d.enabled ? "on" : "off"}`;
    case "remote_password":
      return `${who} replaced the shared password`;
    case "token_add":
      return `${who} created token${on}`;
    case "token_remove":
      return `${who} revoked token${on}`;
    case "peer_join":
      return `${who} connected${e.ip ? ` from ${e.ip}` : ""}`;
    case "peer_leave":
      return `${who} disconnected`;
    case "peer_kick":
      return `${who} disconnected${on}`;
    case "auth_fail":
      return `Wrong credential from ${e.ip || "an unknown address"}${typeof d.alsoRejected === "number" ? ` (+${d.alsoRejected} more)` : ""}`;
    case "snapshot_restore":
      return `${who} restored snapshot${on}${e.outcome === "error" ? " (failed)" : ""}`;
    case "terminal_open":
      return `${who} opened a terminal${on ? ` in${on}` : ""}`;
    case "file_write":
      return `${who} saved${on}`;
    case "fs_op":
      return `${who} ${str(d.op) || "changed"}${on}${str(d.to) ? ` to ${str(d.to)}` : ""}`;
    case "session_delete":
      return `${who} deleted a chat`;
    case "mcp_server": {
      const server = e.target ?? "a server";
      switch (str(d.action)) {
        case "save":
          return str(d.renamedFrom)
            ? `${who} changed MCP server ${str(d.renamedFrom)}${str(d.renamedFrom) !== server ? ` (now ${server})` : ""}`
            : `${who} added MCP server ${server}`;
        case "remove":
          return `${who} removed MCP server ${server}`;
        case "approve":
          return `${who} approved the project's MCP server ${server}`;
        case "deny":
          return `${who} declined the project's MCP server ${server}`;
        case "enable":
        case "disable":
          return `${who} turned ${d.enabled ? "on" : "off"} MCP server ${server}`;
        case "tool":
          return `${who} ${d.enabled ? "allowed" : "hid"} ${str(d.tool)} from MCP server ${server}`;
        case "sign_in":
          return `${who} signed in to MCP server ${server}`;
        case "sign_out":
          return `${who} signed out of MCP server ${server}`;
      }
      return `${who} changed MCP server ${server}`;
    }
    case "skill_change":
      return `${who} turned ${d.enabled ? "on" : "off"} skill${on}`;
    case "project_remove":
      return `${who} removed project${on || ` ${e.project ?? ""}`}`;
  }
  return `${who}: ${e.kind}${on}`;
}

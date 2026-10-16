// Pure helpers for permission rules (SPEC.md §3.1 "Permission rules"), kept apart from the
// components so they can be tested with `node --test src/lib/`.
import type { PermissionRule, PermissionScope, PermissionSuggestion } from "./types";

export const SCOPES: { value: PermissionScope; label: string; hint: string }[] = [
  { value: "project", label: "This project", hint: "Saved for this project" },
  { value: "session", label: "Until restart", hint: "Forgotten when yoakeland restarts" },
  { value: "global", label: "All projects", hint: "Saved for every project" },
];

export const TOOLS: { value: string; label: string; placeholder: string }[] = [
  { value: "bash", label: "Command", placeholder: "go test *" },
  { value: "edit", label: "File edits", placeholder: "internal/agent/**" },
  // Deny or ask only: reading needs no allow rule.
  { value: "read", label: "File reads", placeholder: "secrets/**" },
  { value: "web_fetch", label: "Web fetch", placeholder: "docs.python.org" },
  { value: "browser", label: "Browser", placeholder: "example.com" },
  { value: "web_search", label: "Web search", placeholder: "every search" },
  { value: "mcp", label: "MCP tool", placeholder: "mcp__github__* or mcp__github__create_issue" },
];

/** What add_permission_rule takes for the form's pick. An MCP rule covers a whole tool (or every tool of
 * one server), so the tool's name is the rule's tool and its pattern is always "*". A web_search rule
 * covers every query, so its pattern is "*" too. */
export function ruleFromForm(tool: string, text: string): { tool: string; text: string } {
  if (tool === "web_search") return { tool, text: "*" };
  return tool === "mcp" ? { tool: text.trim(), text: "*" } : { tool, text: text.trim() };
}

/** An MCP rule's tool, spoken: "github: any tool", "github: Create issue". (Kept free of imports so
 * node --test can load this file; extensions.ts has the same split for the rest of the UI.) */
export function mcpRuleLabel(tool: string): string | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!m) return null;
  const said = m[2].replace(/[_-]+/g, " ").trim();
  return `${m[1]}: ${m[2] === "*" ? "any tool" : said.charAt(0).toUpperCase() + said.slice(1).toLowerCase()}`;
}

const MODE_NAMES: Record<string, string> = { read_write: "Ask", accept_edits: "Edit", auto: "Auto" };

/** Where an allow applies: nothing named means Ask, Edit and Auto (never read-only or plan). */
export function modesLabel(rule: Pick<PermissionRule, "decision" | "modes">): string {
  const named = (rule.modes ?? []).map((m) => MODE_NAMES[m] ?? m);
  if (named.length) return named.join(", ");
  return rule.decision === "allow" ? "Ask, Edit, Auto" : "every mode";
}

export function toolLabel(tool: string): string {
  return mcpRuleLabel(tool) ?? { bash: "Command", edit: "Edit", file_write: "Write", file_edit: "Edit", web_fetch: "Fetch", browser: "Browser", read: "Read", web_search: "Web search" }[tool] ?? tool;
}

const SCOPE_ORDER: Record<string, number> = { global: 0, project: 1, session: 2, builtin: 3 };
const DECISION_ORDER: Record<string, number> = { deny: 0, ask: 1, allow: 2 };

/** Deny first (it wins), then ask, then allow; within that, wider scopes first. */
export function sortRules(rules: PermissionRule[]): PermissionRule[] {
  return [...rules].sort(
    (a, b) =>
      (DECISION_ORDER[a.decision] ?? 9) - (DECISION_ORDER[b.decision] ?? 9) ||
      (SCOPE_ORDER[a.scope] ?? 9) - (SCOPE_ORDER[b.scope] ?? 9) ||
      a.text.localeCompare(b.text),
  );
}

/** The suggestion an "Always allow" click applies unless another is picked: the broadest one offered. */
export function defaultSuggestion(suggestions: PermissionSuggestion[] | undefined): number {
  if (!suggestions?.length) return -1;
  const i = suggestions.findIndex((s) => s.id === "prefix" || s.id === "dir");
  return i >= 0 ? i : 0;
}

/** The permission_response fields for an "Always allow" pick. A native (CLI agent) suggestion is the
 * agent's own rule, so it carries no scope. */
export function alwaysAnswer(
  suggestions: PermissionSuggestion[] | undefined,
  pick: number,
  scope: PermissionScope,
): { remember: boolean; ruleId?: string; scope?: PermissionScope } | null {
  const s = suggestions?.[pick];
  if (!s) return null;
  return { remember: false, ruleId: s.id, ...(s.native ? {} : { scope }) };
}

/** A permission_request from a server that predates suggestions (SPEC v2.24) but offers a cache key. */
export function legacyRemember(p: { suggestions?: PermissionSuggestion[]; cacheKey?: string }): boolean {
  return !p.suggestions?.length && !!p.cacheKey;
}

/** One sentence for the list: "Allow `go test *` (Command) in Ask, Edit, Auto". */
export function describeRule(r: PermissionRule): string {
  const verb = { allow: "Allow", ask: "Always ask about", deny: "Never allow" }[r.decision];
  const what = r.text === r.tool ? toolLabel(r.tool) : `${toolLabel(r.tool)} ${r.text}`;
  return `${verb} ${what} · ${modesLabel(r)}`;
}

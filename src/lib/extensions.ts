// Pure helpers for the MCP and Skills screens: parsing what a person types into the shape the daemon
// takes, and the words for what the daemon reports. The daemon validates everything again; this is
// only so a mistake shows next to the field instead of as a refusal.
import type { McpImportCandidate, McpServerConfig, McpServerStatus, McpState, SkillInfo } from "./types";

export const REDACTED = "••••••";

/** Same rule as the daemon: 1-40 of letters, digits, - and _, first a letter or digit, no "__". */
export function serverNameError(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) return "1–40 letters, digits, - or _, starting with a letter or digit";
  if (name.includes("__")) return "No double underscore";
  return "";
}

/** Splits a command line the way a shell would for quotes and backslashes, with no expansion. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < line.length && '"\\'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
    }
  }
  if (quote) throw new Error("Unclosed quote");
  if (cur || has) out.push(cur);
  return out;
}

/** The inverse of splitCommand: quotes only the words that need it. */
export function joinCommand(command: string | undefined, args: string[] | undefined): string {
  const q = (s: string) => (s === "" ? '""' : /[\s"'\\]/.test(s) ? `"${s.replace(/(["\\])/g, "\\$1")}"` : s);
  return [command ?? "", ...(args ?? [])].filter((w, i) => i === 0 ? w !== "" : true).map(q).join(" ");
}

/** `KEY=value` per line; blank lines and # comments are skipped. Throws with the line number on a bad one. */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    const key = eq < 0 ? line : line.slice(0, eq).trim();
    if (eq < 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Line ${i + 1}: write NAME=value`);
    out[key] = line.slice(eq + 1);
  });
  return out;
}

export function formatEnvLines(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
}

/** `Name: value` per line, as an HTTP header is written. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const colon = line.indexOf(":");
    const key = colon < 0 ? "" : line.slice(0, colon).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error(`Line ${i + 1}: write Name: value`);
    out[key] = line.slice(colon + 1).trim();
  });
  return out;
}

export function formatHeaderLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** `mcp__github__create_issue` → { server: "github", tool: "create_issue" }; null for any other name. */
export function mcpToolParts(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice(5);
  const i = rest.indexOf("__");
  if (i <= 0) return rest ? { server: rest, tool: "" } : null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/** "Create issue" from `create_issue`: the server's own name, spoken. */
export function humanizeTool(raw: string): string {
  const s = raw.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : raw;
}

export const STATE_LABEL: Record<McpState, string> = {
  idle: "Not started",
  disabled: "Off",
  pending: "Needs approval",
  connecting: "Connecting…",
  ready: "Connected",
  needs_auth: "Sign in needed",
  failed: "Failed",
};

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export const STATE_TONE: Record<McpState, Tone> = {
  idle: "neutral",
  disabled: "neutral",
  pending: "warning",
  connecting: "accent",
  ready: "success",
  needs_auth: "warning",
  failed: "danger",
};

export function transportOf(c: McpServerConfig): "stdio" | "http" | "sse" {
  return c.type ?? (c.url ? "http" : "stdio");
}

/** One line saying what the server runs or where it is. Header and env values are never part of it. */
export function serverTarget(c: McpServerConfig): string {
  return transportOf(c) === "stdio" ? joinCommand(c.command, c.args) : (c.url ?? "");
}

/** Which of a project's servers wait on the user, for the badge on the tab and the banner. */
export function awaitingApproval(servers: McpServerStatus[] | undefined): McpServerStatus[] {
  return (servers ?? []).filter((s) => s.scope === "project" && (s.approval === "pending" || s.approval === "changed"));
}

export const SKILL_SOURCE_LABEL: Record<string, string> = {
  yoake: "Yoake",
  agents: ".agents",
  claude: "Claude Code",
  claude_desktop: "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  kimi: "Kimi",
  grok: "Grok Build",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "Oh My Pi",
  ohmypi: "Oh My Pi",
  amp: "Amp",
  native: "Yoake's own models",
};

export function agentLabel(kind: string): string {
  return SKILL_SOURCE_LABEL[kind] ?? kind;
}

/** Skills matching a search over name, description and folder family; active ones before shadowed. */
export function filterSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const q = query.trim().toLowerCase();
  return skills
    .filter((s) => !q || `${s.name} ${s.description} ${s.source}`.toLowerCase().includes(q))
    .sort((a, b) => Number(!!a.shadowed) - Number(!!b.shadowed) || a.name.localeCompare(b.name));
}

/** The name the daemon's skill folders know a chat's agent by: "native" for Yoake's own models, else the CLI's. */
export function skillKindOf(providerKind: string | undefined): string {
  return !providerKind || providerKind === "api_key" ? "native" : providerKind.replace(/^cli_/, "");
}

/** Skills the user can name with $ in the composer: on, not hidden from users, not shadowed by another
 * folder, and loadable by the chat's agent (`kind`), so a $name is never an unanswerable command. */
export function pickableSkills(skills: SkillInfo[] | undefined, query: string, kind?: string): SkillInfo[] {
  const q = query.toLowerCase();
  return (skills ?? [])
    .filter((s) => s.enabled && s.userInvocable && !s.shadowed && (!kind || s.agents.includes(kind)) && (!q || s.name.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
}

/** A message that opens with `/name` for a skill the agent can load is sent as `$name`, the one form the
 * daemon turns into each agent's own call (SPEC.md §4h). Any other leading slash (`/etc/hosts`) is left alone. */
export function slashToSkill(text: string, known: Set<string>): string {
  const m = /^\/([A-Za-z][A-Za-z0-9._:-]{0,63})(?=$|\s)/.exec(text);
  return m && known.has(m[1]) ? "$" + text.slice(1) : text;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Reads the JSON that a server's README tells you to paste: `{ "mcpServers": { name: config } }`, a bare
 * `{ name: config }`, or `{ "name": "x", ...config }`. Only the fields the daemon knows are kept. */
export function parseServersJson(text: string): { name: string; config: McpServerConfig }[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Expected a JSON object");
  let map = root as Record<string, unknown>;
  if (map.mcpServers && typeof map.mcpServers === "object") map = map.mcpServers as Record<string, unknown>;
  else if (typeof map.name === "string" && ("command" in map || "url" in map)) map = { [map.name]: map };
  const out: { name: string; config: McpServerConfig }[] = [];
  for (const [name, raw] of Object.entries(map)) {
    const bad = serverNameError(name);
    if (bad) throw new Error(`"${name}": ${bad}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`"${name}" isn't a server definition`);
    const r = raw as Record<string, unknown>;
    const strings = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined);
    const t = String(r.type ?? r.transport ?? "").toLowerCase().replace(/[-_]/g, "");
    const config: McpServerConfig = {};
    if (typeof r.url === "string") {
      config.type = t === "sse" ? "sse" : "http";
      config.url = r.url;
      config.headers = strings(r.headers);
    } else if (typeof r.command === "string") {
      config.type = "stdio";
      config.command = r.command;
      if (Array.isArray(r.args)) config.args = r.args.map(String);
      config.env = strings(r.env);
      if (typeof r.cwd === "string") config.cwd = r.cwd;
    } else {
      throw new Error(`"${name}" needs a command or a url`);
    }
    if (typeof r.disabled === "boolean") config.disabled = r.disabled;
    if (typeof r.agents === "boolean") config.agents = r.agents;
    if (Array.isArray(r.disabledTools)) config.disabledTools = r.disabledTools.map(String);
    if (typeof r.timeoutMs === "number" && r.timeoutMs > 0) config.timeoutMs = r.timeoutMs;
    const o = r.oauth as Record<string, unknown> | undefined;
    if (o && typeof o === "object" && typeof o.clientId === "string") {
      config.oauth = { clientId: o.clientId };
      if (typeof o.clientSecret === "string") config.oauth.clientSecret = o.clientSecret;
      if (typeof o.scope === "string") config.oauth.scope = o.scope;
    }
    out.push({ name, config });
  }
  if (!out.length) throw new Error("No servers in that JSON");
  return out;
}

/** What can be ticked in the import list: not already added, and the daemon can convert it. */
export const importable = (c: McpImportCandidate) => !c.alreadyAdded && !c.unsupported;

/** The request items for the ticked candidates. Only an id and a name go back; the daemon copies the secrets. */
export function importItems(candidates: McpImportCandidate[], ticked: Set<string>, names: Record<string, string>): { id: string; name?: string }[] {
  return candidates.filter((c) => ticked.has(c.id) && importable(c)).map((c) => {
    const name = (names[c.id] ?? c.suggestedName).trim();
    return name && name !== c.suggestedName ? { id: c.id, name } : { id: c.id };
  });
}

/** Why a ticked set can't go yet: a name outside the rule, or two chosen with the same name. */
export function importNameError(candidates: McpImportCandidate[], ticked: Set<string>, names: Record<string, string>): string {
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!ticked.has(c.id) || !importable(c)) continue;
    const name = (names[c.id] ?? c.suggestedName).trim();
    const bad = serverNameError(name);
    if (bad) return `"${name}": ${bad}`;
    if (seen.has(name)) return `Two servers are called "${name}"`;
    seen.add(name);
  }
  return "";
}

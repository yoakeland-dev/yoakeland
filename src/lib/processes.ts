// The server's process tree (SPEC.md §3.1 list_processes) as rows for the diagnostics page.
import type { ProcessInfo, ProcessList, ProcessRow } from "./types";

const key = (p: ProcessInfo) => `${p.pid}:${p.startTimeMs}`; // pid alone can be reused

/** CPU % per process from the cumulative CPU time between two samples (100 = one full core). */
export function withCpu(prev: ProcessList | null, next: ProcessList): ProcessList {
  const before = new Map((prev?.processes ?? []).map((p) => [key(p), p.cpuTimeMs]));
  const dt = prev ? next.sampledAtMs - prev.sampledAtMs : 0;
  return {
    ...next,
    processes: next.processes.map((p) => {
      const b = before.get(key(p));
      return { ...p, cpuPercent: b != null && dt > 0 ? Math.max(0, ((p.cpuTimeMs - b) / dt) * 100) : 0 };
    }),
  };
}

/** Depth-first tree order starting at the server itself, children by pid; `collapsed` hides descendants. */
export function treeRows(list: ProcessList, collapsed: ReadonlySet<string> = new Set()): ProcessRow[] {
  const kids = new Map<number, ProcessInfo[]>();
  const pids = new Set(list.processes.map((p) => p.pid));
  for (const p of list.processes) {
    const k = pids.has(p.ppid) ? p.ppid : -1; // the root's parent isn't in the list
    kids.set(k, [...(kids.get(k) ?? []), p]);
  }
  const out: ProcessRow[] = [];
  const walk = (p: ProcessInfo, depth: number) => {
    const children = kids.get(p.pid) ?? [];
    out.push({ ...p, depth, key: key(p), hasChildren: children.length > 0 });
    if (!collapsed.has(key(p))) for (const c of children) walk(c, depth + 1);
  };
  for (const r of kids.get(-1) ?? []) walk(r, 0);
  return out;
}

export type ProcessKind = "Server" | "Agent" | "MCP" | "Terminal" | "Subprocess";
const AGENT = /\b(claude|codex|opencode|cursor)\b/i;
const SHELL = /^-?(bash|zsh|fish|sh|dash)$/;

/** A row's kind from its command line; `mcp` holds the command lines of the configured MCP servers. Rows must be
 * in tree order (treeRows). A shell started by the server is a terminal, and so is everything it runs, up to the
 * next agent or MCP server. */
export function kindsOf(rows: ProcessRow[], mcp: string[]): Map<string, ProcessKind> {
  const out = new Map<string, ProcessKind>();
  const above: ProcessKind[] = []; // the kind of the nearest row at each depth
  for (const r of rows) {
    const cmd = r.command || r.name;
    const inTerminal = r.depth > 0 && above[r.depth - 1] === "Terminal";
    const kind: ProcessKind =
      r.depth === 0
        ? "Server"
        : AGENT.test(cmd)
          ? "Agent"
          : /mcp/i.test(cmd) || mcp.some((m) => m && cmd.includes(m))
            ? "MCP"
            : inTerminal || (r.depth === 1 && SHELL.test(r.name))
              ? "Terminal"
              : "Subprocess";
    out.set(r.key, kind);
    above[r.depth] = kind;
    above.length = r.depth + 1;
  }
  return out;
}

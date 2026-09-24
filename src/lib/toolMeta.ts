// Backend's tool set is a small fixed list (SPEC.md §5) — shared between
// ToolCallCard (single call) and ToolCallGroup (collapsed run) so both
// render the same icon/label/summary for a given tool name.
import type { NativeToolFields, NativeToolKind } from "./types";

export type ToolIconName =
  | "file-text"
  | "file-plus"
  | "pencil"
  | "terminal-2"
  | "search"
  | "world"
  | "square"
  | "tool"
  | "trash"
  | "arrows-exchange"
  | "brain";

export const toolMeta: Record<string, { icon: ToolIconName; label: string }> = {
  file_read: { icon: "file-text", label: "Read" },
  file_write: { icon: "file-plus", label: "Write" },
  file_edit: { icon: "pencil", label: "Edit" },
  bash: { icon: "terminal-2", label: "Bash" },
  web_search: { icon: "search", label: "Web Search" },
  web_fetch: { icon: "world", label: "Web Fetch" },
};

// CLI agents (§6b) use their own tool names (`Bash`, `Edit`,
// `commandExecution`, …), so a native call is identified by its ACP `kind`.
const KIND_META: Record<NativeToolKind, { icon: ToolIconName; label: string; verb: (n: number) => string }> = {
  read: { icon: "file-text", label: "Read", verb: (n) => `read ${n} file${n === 1 ? "" : "s"}` },
  edit: { icon: "pencil", label: "Edit", verb: (n) => `made ${n} edit${n === 1 ? "" : "s"}` },
  delete: { icon: "trash", label: "Delete", verb: (n) => `deleted ${n} file${n === 1 ? "" : "s"}` },
  move: { icon: "arrows-exchange", label: "Move", verb: (n) => `moved ${n} file${n === 1 ? "" : "s"}` },
  search: { icon: "search", label: "Search", verb: (n) => (n === 1 ? "searched" : `searched ${n} times`) },
  execute: { icon: "terminal-2", label: "Run", verb: (n) => `ran ${n} command${n === 1 ? "" : "s"}` },
  think: { icon: "brain", label: "Think", verb: (n) => (n === 1 ? "thought" : `thought ${n} times`) },
  fetch: { icon: "world", label: "Fetch", verb: (n) => (n === 1 ? "fetched a page" : `fetched ${n} pages`) },
  other: { icon: "tool", label: "Tool", verb: (n) => `used ${n} tool${n === 1 ? "" : "s"}` },
};

type CallLike = { name: string; args?: Record<string, unknown> } & NativeToolFields;

/** Icon/label for any call — yoakeland's own tools by name, a native one by
 * its kind. */
export function metaFor(call: CallLike): { icon: ToolIconName; label: string } {
  if (call.native) {
    // The kind's label, not the agent's tool name — `commandExecution` and
    // `Bash` should read the same.
    const k = KIND_META[call.kind ?? "other"] ?? KIND_META.other;
    return { icon: k.icon, label: k.label };
  }
  return toolMeta[call.name] ?? { icon: "square", label: call.name };
}

/** Short "what it's doing" line for a sidebar row — the agent's own title
 * for a native call, else "Edit Sidebar.svelte" style from the summary. */
export function activityFor(call: CallLike): string {
  if (call.title) return call.title;
  const summary = summaryFor(call);
  const label = metaFor(call).label;
  return summary ? `${label} ${summary.split("/").pop()}` : label;
}

/** A one-line preview of what a call is doing — the file path for file
 * tools, the command for bash, the query for web search, falling back to
 * the raw args for anything else. Args come off the wire/persisted history,
 * so a missing or malformed value here shouldn't be able to crash a card. */
export function summaryFor(call: { args?: Record<string, unknown> } & NativeToolFields): string {
  if (call.native) {
    // The agent's own title already reads as a sentence ("Edit /repo/x.ts");
    // otherwise its first location is the most useful thing to show.
    // otherwise its first location is the most useful thing to show. A
    // title that repeats the label ("Edit /x" next to "Edit") drops it.
    if (call.title) {
      const label = (KIND_META[call.kind ?? "other"] ?? KIND_META.other).label;
      return call.title.startsWith(label + " ") ? call.title.slice(label.length + 1) : call.title;
    }
    if (call.locations?.length) return call.locations[0];
  }
  const args = call.args ?? {};
  if (typeof args.path === "string") {
    const { startLine, endLine } = args;
    if (typeof startLine === "number" || typeof endLine === "number") {
      const range = startLine === endLine ? `${startLine}` : `${startLine ?? ""}-${endLine ?? ""}`;
      return `${args.path}:${range}`;
    }
    return args.path;
  }
  if (typeof args.command === "string") return args.command;
  if (typeof args.query === "string") return args.query;
  if (typeof args.url === "string") return args.url;
  return Object.keys(args).length ? JSON.stringify(args) : "";
}

const VERB: Record<string, (n: number) => string> = {
  file_read: (n) => `read ${n} file${n === 1 ? "" : "s"}`,
  file_write: (n) => `wrote ${n} file${n === 1 ? "" : "s"}`,
  file_edit: (n) => `edited ${n} file${n === 1 ? "" : "s"}`,
  bash: (n) => `ran ${n} command${n === 1 ? "" : "s"}`,
  web_search: (n) => (n === 1 ? "searched the web" : `searched the web ${n} times`),
  web_fetch: (n) => (n === 1 ? "fetched a page" : `fetched ${n} pages`),
};

/** Natural-language brief for a closed run of calls, grouped by tool name so
 * "3 edits + 1 read" reads as one clause each rather than five lines. Shared
 * by ToolCallGroup (a plain run) and WorkGroup (a run that also had
 * reasoning interleaved, which prefixes its own "Thought, then " and wants
 * this lowercase to follow it as one sentence). */
export function briefFor(calls: CallLike[], opts: { capitalize?: boolean } = {}): string {
  // Native calls group by kind — agents disagree on tool names but not kinds.
  const keyOf = (c: CallLike) => (c.native ? `kind:${c.kind ?? "other"}` : c.name);
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(keyOf(c), (counts.get(keyOf(c)) ?? 0) + 1);
  const text = [...counts.entries()]
    .map(([key, n]) => {
      if (key.startsWith("kind:")) return (KIND_META[key.slice(5) as NativeToolKind] ?? KIND_META.other).verb(n);
      return (VERB[key] ?? ((count: number) => `ran ${count} ${key} call${count === 1 ? "" : "s"}`))(n);
    })
    .join(", ");
  if (opts.capitalize === false) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

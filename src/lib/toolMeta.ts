// Shared between ToolCallCard and ToolCallGroup so both render the same icon/label for a tool name.
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
  | "brain"
  | "robot"
  | "world-www"
  | "player-stop"
  | "message-question";

export const toolMeta: Record<string, { icon: ToolIconName; label: string }> = {
  file_read: { icon: "file-text", label: "Read" },
  file_write: { icon: "file-plus", label: "Write" },
  file_edit: { icon: "pencil", label: "Edit" },
  bash: { icon: "terminal-2", label: "Bash" },
  web_search: { icon: "search", label: "Web Search" },
  web_fetch: { icon: "world", label: "Web Fetch" },
  terminal_start: { icon: "terminal-2", label: "Terminal" },
  terminal_output: { icon: "terminal-2", label: "Terminal" },
  terminal_stop: { icon: "player-stop", label: "Stop terminal" },
  browser: { icon: "world-www", label: "Browser" },
  subagent: { icon: "robot", label: "Subagent" },
  ask_user_question: { icon: "message-question", label: "Question" },
  write_plan: { icon: "file-text", label: "Plan" },
};

// CLI agents use their own tool names (`Bash`, `commandExecution`, …), so a native call is identified by its ACP `kind`.
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

/** Icon/label for any call: yoakeland's own tools by name, a native one by
 * its kind. */
export function metaFor(call: CallLike): { icon: ToolIconName; label: string } {
  // A CLI agent's own subagent (Claude Code's Task) reads the same as ours.
  if (call.native && (call.name === "Task" || call.name === "Agent")) return toolMeta.subagent;
  if (call.native) {
    // The kind's label, not the agent's tool name: `commandExecution` and `Bash` should read the same.
    const k = KIND_META[call.kind ?? "other"] ?? KIND_META.other;
    return { icon: k.icon, label: k.label };
  }
  return toolMeta[call.name] ?? { icon: "square", label: call.name };
}

/** Short "what it's doing" line for a sidebar row: the agent's own title
 * for a native call, else "Edit Sidebar.svelte" style from the summary. */
export function activityFor(call: CallLike): string {
  if (call.title) return call.title;
  const summary = summaryFor(call);
  const label = metaFor(call).label;
  return summary ? `${label} ${summary.split("/").pop()}` : label;
}

/** One-line preview of a call's args. Args come off the wire/persisted history, so a
 * missing or malformed value here shouldn't be able to crash a card. */
export function summaryFor(call: { args?: Record<string, unknown> } & NativeToolFields): string {
  if (call.native) {
    // A title that repeats the label ("Edit /x" next to "Edit") drops it.
    if (call.title) {
      const label = (KIND_META[call.kind ?? "other"] ?? KIND_META.other).label;
      return call.title.startsWith(label + " ") ? call.title.slice(label.length + 1) : call.title;
    }
    if (call.locations?.length) return call.locations[0];
  }
  const args = call.args ?? {};
  if (typeof args.description === "string" && args.prompt !== undefined) return args.description; // subagent
  if (typeof args.action === "string") {
    // browser: "navigate localhost:3000", "click 12"
    const target = [args.url, args.ref && `#${args.ref}`, args.key, args.text].find((v) => typeof v === "string" && v);
    return target ? `${args.action} ${String(target).replace(/^https?:\/\//, "")}` : args.action;
  }
  if (typeof args.name === "string" && typeof args.command === "string") return `${args.name}: ${args.command}`; // terminal_start
  if (typeof args.id === "string") return typeof args.input === "string" && args.input ? `${args.id} ← ${JSON.stringify(args.input)}` : args.id; // terminal_output/stop
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
  terminal_start: (n) => `started ${n} terminal${n === 1 ? "" : "s"}`,
  terminal_output: (n) => (n === 1 ? "checked a terminal" : `checked terminals ${n} times`),
  terminal_stop: (n) => `stopped ${n} terminal${n === 1 ? "" : "s"}`,
  browser: (n) => (n === 1 ? "used the browser" : `used the browser ${n} times`),
  subagent: (n) => `ran ${n} subagent${n === 1 ? "" : "s"}`,
};

/** Natural-language brief for a closed run of calls, grouped by tool name ("3 edits + 1 read").
 * `capitalize: false` lets WorkGroup prefix its own "Thought, then " as one sentence. */
export function briefFor(calls: CallLike[], opts: { capitalize?: boolean } = {}): string {
  // Native calls group by kind: agents disagree on tool names but not kinds.
  const keyOf = (c: CallLike) =>
    c.native && (c.name === "Task" || c.name === "Agent") ? "subagent" : c.native ? `kind:${c.kind ?? "other"}` : c.name;
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

const NAME_KIND: Record<string, NativeToolKind> = {
  file_read: "read",
  file_write: "edit",
  file_edit: "edit",
  web_search: "search",
  web_fetch: "fetch",
};

/** Which DotMatrix pattern a running call shows. */
export function dotModeFor(call: CallLike): "thinking" | "reading" | "editing" | "tools" {
  const kind = call.native ? call.kind : NAME_KIND[call.name];
  if (kind === "think") return "thinking";
  if (kind === "read" || kind === "search" || kind === "fetch") return "reading";
  if (kind === "edit" || kind === "delete" || kind === "move") return "editing";
  return "tools";
}

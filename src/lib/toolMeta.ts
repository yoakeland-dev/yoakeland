// Backend's tool set is a small fixed list (SPEC.md §5) — shared between
// ToolCallCard (single call) and ToolCallGroup (collapsed run) so both
// render the same icon/label/summary for a given tool name.
export type ToolIconName = "file-text" | "file-plus" | "pencil" | "terminal-2" | "search" | "world" | "square" | "tool";

export const toolMeta: Record<string, { icon: ToolIconName; label: string }> = {
  file_read: { icon: "file-text", label: "Read" },
  file_write: { icon: "file-plus", label: "Write" },
  file_edit: { icon: "pencil", label: "Edit" },
  bash: { icon: "terminal-2", label: "Bash" },
  web_search: { icon: "search", label: "Web Search" },
  web_fetch: { icon: "world", label: "Web Fetch" },
};

/** A one-line preview of what a call is doing — the file path for file
 * tools, the command for bash, the query for web search, falling back to
 * the raw args for anything else. Args come off the wire/persisted history,
 * so a missing or malformed value here shouldn't be able to crash a card. */
export function summaryFor(call: { args?: Record<string, unknown> }): string {
  const args = call.args ?? {};
  if (typeof args.path === "string") return args.path;
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
export function briefFor(calls: { name: string }[], opts: { capitalize?: boolean } = {}): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const text = [...counts.entries()]
    .map(([name, n]) => (VERB[name] ?? ((count: number) => `ran ${count} ${name} call${count === 1 ? "" : "s"}`))(n))
    .join(", ");
  if (opts.capitalize === false) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

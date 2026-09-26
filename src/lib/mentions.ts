import type { Marked } from "marked";

// Only matches at start-of-text or after whitespace (so `user@host` doesn't count) and requires
// a `/` or `.` (so a plain `@someone` doesn't either). An optional `#L10` or `#L10-20` suffix
// names lines of the file (groups 2 and 3).
const PATH = String.raw`(\/?(?:[\w.~-]+\/)*[\w-][\w.-]*)(?:#L(\d+)(?:-L?(\d+))?)?`;
export const MENTION_RE = new RegExp(String.raw`(?:^|(?<=\s))@` + PATH);
const TOKEN_RE = new RegExp("^@" + PATH);

/** `@path`, `@path#L10` or `@path#L10-20`: the mention syntax agents are told about (SPEC.md §3.1). */
export function mentionText(path: string, from?: number, to?: number): string {
  if (!from) return `@${path}`;
  return `@${path}#L${from}` + (to && to !== from ? `-${to}` : "");
}

// A sentence-ending period isn't part of the file name.
const trimPath = (p: string) => p.replace(/\.+$/, "");

function isPathLike(p: string): boolean {
  return p.includes("/") || /\.\w/.test(p);
}

/** Short labels for a message's mentions: `@name`, or `@parent/name` when
 * two different paths in the same message share a file name. */
export function mentionLabelsFor(paths: string[]): Map<string, string> {
  const unique = [...new Set(paths.map(trimPath).filter(isPathLike))];
  const byName = new Map<string, number>();
  const name = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
  for (const p of unique) byName.set(name(p), (byName.get(name(p)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of unique) {
    const parts = p.split("/").filter(Boolean);
    out.set(p, byName.get(name(p))! > 1 && parts.length > 1 ? parts.slice(-2).join("/") : name(p));
  }
  return out;
}

// Set by Markdown.svelte just before it parses; read by the renderer below.
export const mentionLabels: { current: Map<string, string> } = { current: new Map() };

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** `iconUrl` gives a file name's icon; passed in since the icon table only loads under Vite. */
export function withMentions(md: Marked, iconUrl?: (name: string) => string): Marked {
  md.use({
    extensions: [
      {
        name: "mention",
        level: "inline",
        start(src: string) {
          const m = src.match(/(?:^|\s)@/);
          return m ? m.index! + (m[0].length - 1) : undefined;
        },
        tokenizer(src: string) {
          const m = TOKEN_RE.exec(src);
          if (!m) return undefined;
          // A trailing sentence period isn't part of the name, unless a line suffix follows it.
          const path = m[2] ? m[1] : trimPath(m[1]);
          if (!isPathLike(path)) return undefined;
          const from = m[2] ? Number(m[2]) : undefined;
          const to = m[3] ? Number(m[3]) : from;
          return { type: "mention", raw: m[2] ? m[0] : "@" + path, path, from, to };
        },
        renderer(token) {
          const path = token.path as string;
          const { from, to } = token as { from?: number; to?: number };
          const lines = from ? `:${from}` + (to && to !== from ? `-${to}` : "") : "";
          const name = path.split("/").pop() ?? path;
          const label = (mentionLabels.current.get(path) ?? name) + lines;
          const data = `data-path="${escape(path)}"` + (from ? ` data-from="${from}" data-to="${to}"` : "");
          // The icon (Markdown.svelte draws it from --icon) stands in for the `@`.
          const icon = iconUrl ? ` style="--icon: url(&quot;${escape(iconUrl(name))}&quot;)"` : "";
          return `<span class="mention" role="link" tabindex="0" ${data}${icon} title="${escape(path + lines)}">${iconUrl ? "" : "@"}${escape(label)}</span>`;
        },
      },
    ],
  });
  return md;
}

/** The project file an inline `code` span in a reply names, if exactly one fits: a relative
 * path (`@`-prefixed too, a mention the model wrapped in backticks), an absolute one under `root`, or a bare file name only one file has, each optionally
 * with `:12`, `:12-20` or `#L12-20`. */
export function resolveFileRef(
  text: string,
  files: string[],
  root?: string,
): { path: string; from?: number; to?: number } | null {
  const m = /^(\S+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/.exec(text.trim());
  if (!m) return null;
  let p = m[1].replace(/^@/, "").replace(/^\.\//, "");
  if (root && p.startsWith(root.replace(/\/?$/, "/"))) p = p.slice(root.replace(/\/?$/, "/").length);
  if (!isPathLike(p)) return null;
  const hits = files.includes(p) ? [p] : files.filter((f) => f.endsWith("/" + p));
  if (hits.length !== 1) return null;
  const from = Number(m[2] ?? m[4]) || undefined;
  const to = Number(m[3] ?? m[5]) || from;
  return { path: hits[0], from, to };
}

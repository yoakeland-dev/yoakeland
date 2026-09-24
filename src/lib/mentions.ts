import type { Marked } from "marked";

// Only matches at start-of-text or after whitespace (so `user@host` doesn't count) and requires
// a `/` or `.` (so a plain `@someone` doesn't either).
export const MENTION_RE = /(?:^|(?<=\s))@(\/?(?:[\w.~-]+\/)*[\w-][\w.-]*)/;

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

export function withMentions(md: Marked): Marked {
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
          const m = /^@(\/?(?:[\w.~-]+\/)*[\w-][\w.-]*)/.exec(src);
          if (!m) return undefined;
          const path = trimPath(m[1]);
          if (!isPathLike(path)) return undefined;
          return { type: "mention", raw: "@" + path, path };
        },
        renderer(token) {
          const path = token.path as string;
          const label = mentionLabels.current.get(path) ?? path.split("/").pop();
          return `<span class="mention" title="${escape(path)}">@${escape(label ?? path)}</span>`;
        },
      },
    ],
  });
  return md;
}

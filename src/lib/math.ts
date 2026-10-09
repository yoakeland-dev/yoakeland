// LaTeX math in markdown: $x$, $$x$$, \(x\), \[x\]. This file only finds the math (pure, so
// node --test can run it); mathRender.ts typesets it. Marked runs extension tokenizers before its
// own, and only where its inline/block lexer stands, so code spans and fences never reach us.
import type { MarkedExtension } from "marked";

export type MathMatch = { raw: string; tex: string; display: boolean };

/** Index of `close` at or after `from`, skipping backslash-escaped characters, or -1. */
function scanClose(src: string, from: number, close: string): number {
  for (let i = from; i < src.length; i++) {
    if (src.startsWith(close, i)) return i;
    if (src[i] === "\\") i++;
  }
  return -1;
}

/** `src` starts with a delimiter; the math it opens, if it closes and reads as math. Pandoc's
 * rules for a lone `$`, so prose money survives: the opener needs a non-space after it, the
 * closer a non-space before it and no word character after it ("$5 and $10", "$HOME/bin:$PATH"
 * are text), and a stray `$` inside means it isn't math. */
export function matchInlineMath(src: string): MathMatch | undefined {
  if (src.startsWith("$$")) {
    const end = scanClose(src, 2, "$$");
    const tex = end < 0 ? "" : src.slice(2, end);
    return tex.trim() && !/\n[ \t]*\n/.test(tex) ? { raw: src.slice(0, end + 2), tex, display: true } : undefined;
  }
  if (src[0] === "$") {
    if (!src[1] || /\s/.test(src[1])) return undefined;
    for (let i = 1; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") i++;
      else if (c === "$") {
        if (/\s/.test(src[i - 1]) || /\w/.test(src[i + 1] ?? "")) return undefined;
        return { raw: src.slice(0, i + 1), tex: src.slice(1, i), display: false };
      }
    }
    return undefined;
  }
  const close = src.startsWith("\\(") ? "\\)" : src.startsWith("\\[") ? "\\]" : "";
  if (!close) return undefined;
  const end = scanClose(src, 2, close);
  const tex = end < 0 ? "" : src.slice(2, end);
  return tex.trim() ? { raw: src.slice(0, end + 2), tex, display: close === "\\]" } : undefined;
}

/** A display block: `$$` or `\[` opening a line, and its closer ending a line. `$$x$$ and more`
 * is not one; the inline rule takes it. No blank line inside, so a stray `$$` can't swallow the
 * rest of the message, and an unclosed one (still streaming) stays text. */
export function matchBlockMath(src: string): MathMatch | undefined {
  const open = /^ {0,3}(\$\$|\\\[)/.exec(src);
  if (!open) return undefined;
  const from = open[0].length;
  const end = scanClose(src, from, open[1] === "$$" ? "$$" : "\\]");
  if (end < 0) return undefined;
  const tail = /^[ \t]*(?:\n|$)/.exec(src.slice(end + 2));
  const tex = src.slice(from, end);
  if (!tail || !tex.trim() || /\n[ \t]*\n/.test(tex)) return undefined;
  return { raw: src.slice(0, end + 2 + tail[0].length), tex, display: true };
}

/** Where math might start in `src` (marked cuts its text there): an unescaped `$`, `\(` or `\[`. */
function findInlineStart(src: string): number | undefined {
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "$" || (src[i] === "\\" && (src[i + 1] === "(" || src[i + 1] === "["))) return i;
    if (src[i] === "\\") i++;
  }
  return undefined;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Shown as the TeX source until KaTeX has loaded (mathRender.ts), then swapped for the real thing. */
export function pendingMath(tex: string, display: boolean): string {
  return display
    ? `<div class="math-pending" data-display>${escapeHtml(tex)}</div>\n`
    : `<span class="math-pending">${escapeHtml(tex)}</span>`;
}

/** `render` returns typeset HTML, or undefined while KaTeX is still loading. */
export function mathExtension(render: (tex: string, display: boolean) => string | undefined): MarkedExtension {
  return {
    extensions: [
      {
        name: "inlineMath",
        level: "inline",
        start: findInlineStart,
        tokenizer(src) {
          const m = matchInlineMath(src);
          return m && { type: "inlineMath", ...m };
        },
        renderer: (t) => render(t.tex, t.display) ?? pendingMath(t.tex, t.display),
      },
      {
        name: "blockMath",
        level: "block",
        start(src) {
          const i = src.search(/(?:^|(?<=\n)) {0,3}(?:\$\$|\\\[)/);
          return i < 0 ? undefined : i;
        },
        tokenizer(src) {
          const m = matchBlockMath(src);
          return m && { type: "blockMath", ...m };
        },
        renderer: (t) => {
          const html = render(t.tex, true);
          return html === undefined ? pendingMath(t.tex, true) : html + "\n";
        },
      },
    ],
  };
}

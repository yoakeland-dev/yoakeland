// Typesets TeX with KaTeX, loaded on first use so it costs nothing until a message has math in it.
// Standalone: anything that needs a formula as HTML (markdown, a future chart mode) can call it.
import type KaTeX from "katex";

let katex: typeof KaTeX | undefined;
let loading: Promise<void> | undefined;
const cache = new Map<string, string>();
const CACHE_MAX = 500;

/** Resolves once KaTeX and its stylesheet (woff2 fonts only, see vite.config.js) are in. */
export function loadKatex(): Promise<void> {
  return (loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([m]) => void (katex = m.default),
    (e) => {
      loading = undefined; // let a later formula try again
      throw e;
    },
  ));
}

/** The formula as HTML, or undefined while KaTeX is still loading (the caller shows the source
 * and re-renders when loadKatex() resolves). Results are cached, so a growing paragraph doesn't
 * re-typeset its earlier formulas on every streamed word. Still to be sanitized by the caller. */
export function renderMath(tex: string, display: boolean): string | undefined {
  if (!katex) {
    loadKatex().catch(() => {});
    return undefined;
  }
  const key = (display ? "D" : "I") + tex;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: "htmlAndMathml",
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        errorColor: "var(--danger)",
      });
    } catch {
      // ParseError with throwOnError:false can't happen; a too-deep expansion can.
      html = `<span class="katex-error">${tex.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, html);
  }
  return html;
}

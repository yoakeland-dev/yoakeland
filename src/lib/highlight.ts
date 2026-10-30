// Core build + hand-picked languages, not highlight.js's full ~190-language bundle.
// Colors come from the user's terminal palette via --syn-* variables (AppState.applySettings), not a hljs theme.
import hljs from "highlight.js/lib/core";
import type { MarkedExtension, Tokens } from "marked";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nix from "highlight.js/lib/languages/nix";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import copyIcon from "@tabler/icons/outline/copy.svg?raw";
import checkIcon from "@tabler/icons/outline/check.svg?raw";
import chevronIcon from "@tabler/icons/outline/chevron-right.svg?raw";
import codeIcon from "@tabler/icons/outline/code.svg?raw";
import eyeIcon from "@tabler/icons/outline/eye.svg?raw";
import downloadIcon from "@tabler/icons/outline/download.svg?raw";
import expandIcon from "@tabler/icons/outline/arrows-maximize.svg?raw";
import { matchInlineMath, pendingMath } from "./math";
import { renderMath } from "./mathRender";

for (const [name, lang] of Object.entries({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua, makefile,
  markdown, nix, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}
// Common fence names the language modules don't already alias.
hljs.registerAliases(["svelte", "vue"], { languageName: "xml" });
hljs.registerAliases(["toml"], { languageName: "ini" });

// Fence id -> [full name, a file extension the icon theme knows]. Unlisted ids show as written, with the generic file icon.
const LANGS: Record<string, [string, string]> = {
  bash: ["Bash", "sh"], sh: ["Shell", "sh"], zsh: ["Zsh", "sh"], shell: ["Shell", "sh"], console: ["Shell", "sh"],
  c: ["C", "c"], cpp: ["C++", "cpp"], "c++": ["C++", "cpp"], csharp: ["C#", "cs"], cs: ["C#", "cs"],
  css: ["CSS", "css"], scss: ["SCSS", "scss"], diff: ["Diff", "diff"], dockerfile: ["Dockerfile", "dockerfile"],
  go: ["Go", "go"], ini: ["INI", "ini"], toml: ["TOML", "toml"], java: ["Java", "java"],
  javascript: ["JavaScript", "js"], js: ["JavaScript", "js"], jsx: ["JSX", "jsx"],
  typescript: ["TypeScript", "ts"], ts: ["TypeScript", "ts"], tsx: ["TSX", "tsx"],
  json: ["JSON", "json"], jsonc: ["JSON", "json"], kotlin: ["Kotlin", "kt"], kt: ["Kotlin", "kt"], lua: ["Lua", "lua"],
  makefile: ["Makefile", "makefile"], make: ["Makefile", "makefile"], markdown: ["Markdown", "md"], md: ["Markdown", "md"],
  nix: ["Nix", "nix"], php: ["PHP", "php"], python: ["Python", "py"], py: ["Python", "py"], ruby: ["Ruby", "rb"], rb: ["Ruby", "rb"],
  rust: ["Rust", "rs"], rs: ["Rust", "rs"], sql: ["SQL", "sql"], swift: ["Swift", "swift"],
  xml: ["XML", "xml"], html: ["HTML", "html"], svelte: ["Svelte", "svelte"], vue: ["Vue", "vue"],
  yaml: ["YAML", "yaml"], yml: ["YAML", "yml"], text: ["Text", "txt"], txt: ["Text", "txt"],
};

/** One .cl span per line, reopening any highlight span a line break cut through, so a line can
 * carry its own number (a CSS counter, see Markdown.svelte) and wrapped lines stay under it. */
function perLine(html: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let line = "";
  for (const tok of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (tok === "\n") {
      out.push(`<span class="cl">${line}${"</span>".repeat(open.length)}\n</span>`);
      line = open.join("");
    } else {
      if (tok.startsWith("<span")) open.push(tok);
      else if (tok === "</span>") open.pop();
      line += tok;
    }
  }
  if (line !== open.join("")) out.push(`<span class="cl">${line}</span>`);
  return out.join("");
}

const langLabel = (id: string) => {
  const [name, ext] = LANGS[id || "text"] ?? [id, id];
  // An <img src> wouldn't survive sanitize.ts; Markdown.svelte sets the icon from data-ext.
  return `<span class="code-ico" data-ext="${ext}"></span><span class="code-lang">${escapeHtml(name)}</span>`;
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const button = (cls: string, title: string, icons: string) =>
  `<button type="button" class="${cls}" title="${title}" aria-label="${title}">${icons}</button>`;

/** A ```mermaid fence: its source, exactly like any code block, plus a slot (.mermaid-out) that
 * Markdown.svelte fills with the diagram once the fence is closed and the source parses. The
 * view/save/expand buttons only show once it has (see the CSS there). data-opaque keeps morph
 * out of the parts that script fills in. */
function mermaidBlock(text: string): string {
  const lines = text.split("\n").length;
  return (
    `<div class="code-block mermaid-block" data-mermaid><div class="code-head">` +
    `<button type="button" class="code-toggle" title="Collapse or expand">${chevronIcon}` +
    `<span class="code-lang">mermaid</span><span class="code-lines">${lines} line${lines === 1 ? "" : "s"}</span>` +
    `<span class="mm-error" data-opaque></span></button>` +
    button("mm-btn mm-view", "Show source or diagram", codeIcon + eyeIcon) +
    button("mm-btn mm-save", "Save as SVG", downloadIcon) +
    button("mm-btn mm-expand", "Expand", expandIcon) +
    button("code-copy", "Copy source", copyIcon + checkIcon) +
    `</div><div class="mermaid-out" data-opaque></div>` +
    `<div class="code-body"><div class="code-clip"><pre><code class="hljs">${escapeHtml(text)}</code></pre></div></div></div>\n`
  );
}

/** A ```artifact fence: an HTML page the agent wrote, shown in a sandboxed frame (.artifact-out, filled in
 * by Markdown.svelte once the fence has closed) with its source folded away underneath. */
function artifactBlock(text: string): string {
  const lines = text.split("\n").length;
  return (
    `<div class="code-block artifact-block" data-artifact><div class="code-head">` +
    `<button type="button" class="code-toggle" title="Show or hide the source">${chevronIcon}` +
    `<span class="code-lang">artifact</span><span class="code-lines">${lines} line${lines === 1 ? "" : "s"}</span></button>` +
    button("code-copy", "Copy source", copyIcon + checkIcon) +
    `</div><div class="artifact-out" data-opaque></div>` +
    `<div class="code-body"><div class="code-clip"><pre><code class="hljs">${escapeHtml(text)}</code></pre></div></div></div>\n`
  );
}

// Models put formulas in fences too. A whole LaTeX document is still code.
const MATH_FENCES = new Set(["math", "katex", "mhchem", "latex", "tex"]);
const LATEX_DOCUMENT = /\\(?:documentclass|usepackage|begin\{document\}|section|begin\{(?:itemize|enumerate|tabular)\})/;
function fencedMath(text: string): string | undefined {
  if (LATEX_DOCUMENT.test(text)) return undefined;
  const tex = text.trim().replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\\\[([\s\S]*)\\\]$/, "$1").trim();
  return tex ? (renderMath(tex, true) ?? pendingMath(tex, true)) + "\n" : undefined;
}

// A diagram written without its fence: a first line that is just the diagram's type, then its body.
const MERMAID_HEAD =
  "(?:(?:flowchart|graph)[ \\t]+(?:TB|TD|BT|RL|LR)|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|timeline|gitGraph|pie(?:[ \\t]+showData)?(?:[ \\t]+title[^\\n]*)?)[ \\t]*;?";
const bareMermaidStart = new RegExp(`^ {0,3}${MERMAID_HEAD}\\n(?=[^\\n]*\\S)`);
export const bareMermaid: MarkedExtension = {
  extensions: [
    {
      name: "bareMermaid",
      level: "block",
      start(src) {
        const i = src.search(new RegExp(`(?:^|(?<=\\n)) {0,3}${MERMAID_HEAD}\\n`));
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const head = bareMermaidStart.exec(src);
        if (!head) return undefined;
        const body = /^(?:[^\n]+(?:\n|$))+/.exec(src.slice(head[0].length)); // up to the first blank line
        if (!body) return undefined;
        const raw = head[0] + body[0];
        return { type: "bareMermaid", raw, text: raw.trim() };
      },
      renderer: (t) => mermaidBlock(t.text),
    },
  ],
};

/** No highlightAuto: it re-guesses on every streamed token and guesses wrong on short snippets.
 * The toggle and copy clicks are handled by Markdown.svelte's delegated onClick, since this is raw HTML,
 * not a component. .code-clip is the grid row the collapse animates (see Markdown.svelte). */
export const highlightCode: MarkedExtension = {
  renderer: {
    // `$x$` or `\ce{H2O}` written as inline code is still a formula; anything else stays code.
    codespan({ text }: Tokens.Codespan) {
      const m = matchInlineMath(text);
      if (m && m.raw === text) return renderMath(m.tex, m.display) ?? pendingMath(m.tex, m.display);
      return `<code>${escapeHtml(text)}</code>`;
    },
    code({ text, lang }: Tokens.Code) {
      const id = (lang ?? "").trim().split(/\s/)[0].toLowerCase();
      if (id === "mermaid" || id === "mmd") return mermaidBlock(text);
      if (id === "artifact") return artifactBlock(text);
      if (MATH_FENCES.has(id)) {
        const math = fencedMath(text);
        if (math) return math;
      }
      const known = !!id && !!hljs.getLanguage(id);
      const body = known ? hljs.highlight(text, { language: id, ignoreIllegals: true }).value : escapeHtml(text);
      const lines = text.split("\n").length;
      return (
        `<div class="code-block" data-digits="${String(lines).length}"><div class="code-head">` +
        `<button type="button" class="code-toggle" title="Collapse or expand">${chevronIcon}` +
        `${langLabel(id)}<span class="code-lines">${lines} line${lines === 1 ? "" : "s"}</span></button>` +
        `<button type="button" class="code-copy" title="Copy" aria-label="Copy code">${copyIcon}${checkIcon}</button></div>` +
        `<div class="code-body"><div class="code-clip"><pre><code class="hljs${known ? ` language-${id}` : ""}">${perLine(body)}</code></pre></div></div></div>\n`
      );
    },
  },
};

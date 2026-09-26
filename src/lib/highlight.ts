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

for (const [name, lang] of Object.entries({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua, makefile,
  markdown, nix, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}
// Common fence names the language modules don't already alias.
hljs.registerAliases(["svelte", "vue"], { languageName: "xml" });
hljs.registerAliases(["toml"], { languageName: "ini" });

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** No highlightAuto: it re-guesses on every streamed token and guesses wrong on short snippets.
 * The toggle and copy clicks are handled by Markdown.svelte's delegated onClick, since this is raw HTML,
 * not a component. .code-clip is the grid row the collapse animates (see Markdown.svelte). */
export const highlightCode: MarkedExtension = {
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const id = (lang ?? "").trim().split(/\s/)[0].toLowerCase();
      const known = !!id && !!hljs.getLanguage(id);
      const body = known ? hljs.highlight(text, { language: id, ignoreIllegals: true }).value : escapeHtml(text);
      const lines = text.split("\n").length;
      return (
        `<div class="code-block"><div class="code-head">` +
        `<button type="button" class="code-toggle" title="Collapse or expand">${chevronIcon}` +
        `<span class="code-lang">${escapeHtml(id || "text")}</span><span class="code-lines">${lines} line${lines === 1 ? "" : "s"}</span></button>` +
        `<button type="button" class="code-copy" title="Copy" aria-label="Copy code">${copyIcon}${checkIcon}</button></div>` +
        `<div class="code-body"><div class="code-clip"><pre><code class="hljs${known ? ` language-${id}` : ""}">${body}</code></pre></div></div></div>\n`
      );
    },
  },
};

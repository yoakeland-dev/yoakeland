<script lang="ts" module>
  import { Marked } from "marked";
  import { highlightCode } from "../highlight";
  import { mathExtension } from "../math";
  import { renderMath } from "../mathRender";
  // Own instance rather than marked's global, so the extensions aren't registered app-wide.
  const math = mathExtension(renderMath);
  const plain = new Marked(highlightCode, math);
  let mentioning: Marked | undefined;
</script>

<script lang="ts">
  import type { Token, Links } from "marked";
  import { sanitizeMarkdown } from "../sanitize";
  import { hasOpenFence } from "../fences";
  import { loadKatex } from "../mathRender";
  import { cachedMermaid, renderMermaid, downloadSvg, mermaidThemeFromCss } from "../mermaidRender";
  import DiagramViewer from "./DiagramViewer.svelte";
  import { openUrl } from "../platform";
  import { app } from "../state.svelte";
  import { mentionLabels, mentionLabelsFor, MENTION_RE, withMentions, resolveFileRef } from "../mentions";
  import { morph, settleFade } from "../morph";
  import { fileIconUrl } from "../fileIcons";

  // `live`: this text is still streaming in, so new words fade in and an unclosed code fence
  // stays collapsed until it closes.
  let { text, mentions = false, live = false }: { text: string; mentions?: boolean; live?: boolean } = $props();
  const PARSE_OPTS = { breaks: true, gfm: true };
  const md = $derived(mentions ? (mentioning ??= withMentions(new Marked(highlightCode, math), fileIconUrl)) : plain);
  // Passing options to lexer/parser *replaces* the instance's defaults
  // (where md.use() put the mention extension), so merge instead.
  const opts = $derived({ ...md.defaults, ...PARSE_OPTS });

  // `marked.lexer`'s block split gives each top-level block its own wrapper (display: contents),
  // re-rendered only when that block's raw text changes, which while streaming is just the last
  // one. That one is morphed rather than replaced, so only its new tail touches the DOM.
  //
  // Known ceiling: a block caches using whatever `links` (reference-style
  // definitions) existed at that moment; one streaming in later won't
  // retroactively fix an already-cached block. Rare enough not to handle.
  let root: HTMLDivElement;
  const cache: string[] = [];
  let raf = 0;

  // The chat this text is in (read off the DOM once mounted), for its project's file list.
  let sid = $state<string | undefined>();
  const project = $derived.by(() => {
    const id = sid ?? app.active?.currentSessionId;
    return id ? app.active?.rootOf(id) : undefined;
  });
  const files = $derived(project ? app.active?.filesByProject[project] : undefined);
  let markedWith: string[] | undefined;

  function render(t: string, fade: boolean) {
    if (mentions) mentionLabels.current = labelsFor(t);
    // The file list can land after a block was cached; link those blocks' file names then.
    const remark = files !== markedWith;
    markedWith = files;
    const allTokens = md.lexer(t, opts);
    const links = allTokens.links;
    const tokens = allTokens.filter((tok) => tok.type !== "space");
    const wrappers = root.children;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      let el = wrappers[i];
      if (el && cache[i] === tok.raw) {
        if (remark) markFileRefs(el);
        continue;
      }
      const sub = Object.assign([tok], { links }) as Token[] & { links: Links };
      const frag = sanitizeMarkdown(md.parser(sub, opts) as string);
      if (!el) {
        el = document.createElement("div");
        el.className = "md-block";
        root.append(el);
      }
      morph(el, frag, fade);
      markFileRefs(el);
      cache[i] = tok.raw;
    }
    while (wrappers.length > tokens.length) wrappers[wrappers.length - 1].remove();
    cache.length = tokens.length;

    // An unclosed fence in the last block means its code is still coming in.
    const lastRaw = tokens[tokens.length - 1]?.raw ?? "";
    const open = fade && hasOpenFence(lastRaw);
    const streaming = open ? [...(wrappers[wrappers.length - 1]?.querySelectorAll(".code-block") ?? [])].pop() : undefined;
    for (const b of root.querySelectorAll(".code-block[data-streaming]")) if (b !== streaming) b.removeAttribute("data-streaming");
    streaming?.setAttribute("data-streaming", "");

    finishAsync();
  }

  // Formulas typeset once KaTeX has loaded; until then they show their TeX (mathRender.ts).
  // Blocks still holding some are marked stale and re-rendered.
  let waitingOnMath = false;
  function finishAsync() {
    if (!waitingOnMath && root.querySelector(".math-pending")) {
      waitingOnMath = true;
      loadKatex()
        .then(() => {
          for (let i = 0; i < root.children.length; i++) if (root.children[i].querySelector(".math-pending")) cache[i] = "";
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => render(text, live));
        })
        .catch(() => {})
        .finally(() => (waitingOnMath = false));
    }
    drawDiagrams();
  }

  // A ```mermaid fence turns into its diagram once it has closed (an open one is still
  // [data-streaming]) and parses; until then, or if it never does, the source stays.
  // `drawn` remembers, per block, the theme and source it was last handled for.
  const drawn = new WeakMap<Element, string>();
  function drawDiagrams() {
    const blocks = root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-streaming])");
    if (!blocks.length) return;
    const theme = mermaidThemeFromCss(app.resolvedTheme === "dark");
    const themeKey = JSON.stringify(theme);
    for (const block of blocks) {
      const src = block.querySelector("code")?.textContent ?? "";
      const key = themeKey + "\0" + src;
      if (!src.trim() || drawn.get(block) === key) continue;
      drawn.set(block, key);
      const hit = cachedMermaid(src, theme);
      if (hit !== undefined) {
        showDiagram(block, hit);
        continue;
      }
      renderMermaid(src, theme).then(
        (svg) => drawn.get(block) === key && showDiagram(block, svg),
        (err) => drawn.get(block) === key && showDiagramError(block, err),
      );
    }
  }

  function showDiagram(block: HTMLElement, svg: string) {
    block.querySelector(".mermaid-out")!.innerHTML = svg; // sanitized by renderMermaid
    block.removeAttribute("data-error");
    block.setAttribute("data-rendered", "");
    if (!block.hasAttribute("data-view")) block.setAttribute("data-view", "diagram");
  }

  function showDiagramError(block: HTMLElement, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    block.querySelector(".mermaid-out")!.replaceChildren();
    block.removeAttribute("data-rendered");
    block.setAttribute("data-error", "");
    const el = block.querySelector<HTMLElement>(".mm-error");
    if (el) {
      el.textContent = msg.split("\n")[0];
      el.title = msg;
    }
  }

  // A theme change repaints the diagrams already drawn (the cache is keyed by theme).
  $effect(() => {
    void app.resolvedTheme;
    void app.settings.accent;
    const id = requestAnimationFrame(() => root.querySelector(".mermaid-block[data-rendered]") && drawDiagrams());
    return () => cancelAnimationFrame(id);
  });

  let viewing = $state<string | undefined>();

  // Inline code naming a project file (`src/lib/a.ts:12`) opens it, like a mention does, and
  // looks like one: its icon in front, standing in for a leading `@` if the model wrote one.
  function markFileRefs(el: Element) {
    if (!files?.length) return;
    for (const code of el.querySelectorAll<HTMLElement>("code")) {
      if (code.closest("pre") || code.classList.contains("file-ref")) continue;
      const text = code.textContent ?? "";
      const ref = resolveFileRef(text, files, project);
      if (!ref) continue;
      if (text.startsWith("@")) code.replaceChildren(text.slice(1));
      code.style.setProperty("--icon", `url("${fileIconUrl(ref.path.split("/").pop()!)}")`);
      code.classList.add("file-ref");
      code.dataset.path = ref.path;
      if (ref.from) Object.assign(code.dataset, { from: String(ref.from), to: String(ref.to) });
      code.setAttribute("role", "link");
      code.tabIndex = 0;
      code.title = `Open ${ref.path}`;
    }
  }

  function labelsFor(t: string): Map<string, string> {
    return mentionLabelsFor([...t.matchAll(new RegExp(MENTION_RE.source, "g"))].map((m) => m[1]));
  }

  $effect(() => {
    sid = root.closest<HTMLElement>("[data-session-id]")?.dataset.sessionId;
  });

  $effect(() => {
    const t = text;
    const fade = live;
    void files;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(t, fade));
    return () => cancelAnimationFrame(raf);
  });

  // Links must never navigate the app's own page away.
  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const toggle = target.closest?.<HTMLElement>(".code-toggle");
    if (toggle) {
      const collapsed = !!toggle.closest(".code-block")?.toggleAttribute("data-collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      return;
    }
    const mm = target.closest?.<HTMLElement>(".mm-btn");
    if (mm) {
      const block = mm.closest<HTMLElement>(".mermaid-block")!;
      const svg = block.querySelector(".mermaid-out")!.innerHTML;
      if (mm.classList.contains("mm-view")) block.setAttribute("data-view", block.getAttribute("data-view") === "source" ? "diagram" : "source");
      else if (mm.classList.contains("mm-save")) downloadSvg(svg);
      else viewing = svg;
      return;
    }
    const copy = target.closest?.<HTMLElement>(".code-copy");
    if (copy) {
      const code = copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard?.writeText(code);
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 1500);
      return;
    }
    if (openMention(e.target)) return;
    const a = target.closest?.("a");
    const href = a?.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    openUrl(href).catch(() => {});
  }

  // A file mention opens that file (and its lines) in the chat's side panel explorer.
  function openMention(target: EventTarget | null): boolean {
    const m = (target as HTMLElement).closest?.<HTMLElement>(".mention[data-path], .file-ref[data-path]");
    const server = app.active;
    if (!m || !server) return false;
    const sid = m.closest<HTMLElement>("[data-session-id]")?.dataset.sessionId ?? server.currentSessionId;
    if (!sid) return false;
    const { path, from, to } = m.dataset;
    server.revealFile(sid, path!, from ? Number(from) : undefined, to ? Number(to) : undefined);
    return true;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="markdown selectable"
  bind:this={root}
  onclick={onClick}
  onanimationend={settleFade}
  onkeydown={(e) => e.key === "Enter" && openMention(e.target) && e.preventDefault()}
></div>
{#if viewing}
  <DiagramViewer svg={viewing} onclose={() => (viewing = undefined)} />
{/if}

<style>
  .markdown {
    font-size: inherit;
    line-height: 1.55;
    /* Long URLs, identifiers and the like wrap instead of stretching the chat. */
    overflow-wrap: anywhere;
  }
  .markdown :global(.md-block) {
    display: contents;
  }
  .markdown :global(> :first-child > :first-child) {
    margin-top: 0;
  }
  .markdown :global(> :last-child > :last-child) {
    margin-bottom: 0;
  }
  /* New streamed words and blocks (morph.ts). Opacity only, so it stays on the compositor. */
  .markdown :global([data-f]) {
    animation: md-fade-in calc(0.5s * var(--anim-speed, 1)) ease-out both;
  }
  @keyframes -global-md-fade-in {
    from {
      opacity: 0;
    }
  }
  .markdown :global(p) {
    margin: 0.5em 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 0.9em 0 0.4em;
    line-height: 1.3;
    font-weight: 700;
  }
  .markdown :global(h1) {
    font-size: 1.25em;
  }
  .markdown :global(h2) {
    font-size: 1.12em;
  }
  .markdown :global(h3),
  .markdown :global(h4) {
    font-size: 1.02em;
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.4em;
  }
  .markdown :global(li) {
    margin: 0.2em 0;
  }
  .markdown :global(li > p) {
    margin: 0.2em 0;
  }
  .markdown :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .markdown :global(strong) {
    font-weight: 700;
  }
  .markdown :global(blockquote) {
    margin: 0.5em 0;
    padding: 0.1em 0 0.1em 0.8em;
    border-left: 2px solid var(--panel-border);
    color: var(--text-dim);
  }
  .markdown :global(blockquote p) {
    margin: 0.3em 0;
  }
  .markdown :global(hr) {
    margin: 0.8em 0;
    border: none;
    border-top: 1px solid var(--panel-border);
  }
  .markdown :global(code) {
    font-family: var(--code-font-family);
    font-size: var(--code-font-size);
    background: rgba(255, 255, 255, 0.08);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-sm);
  }
  /* File mentions, and inline code naming a file: a chip like inline code, tinted, with the
     file's icon (--icon) in its left padding, so the two can't wrap apart. The composer draws
     the same chip (PromptInput.svelte's .m-chip). After the code rule so it wins. */
  .markdown :global(.mention),
  .markdown :global(code.file-ref) {
    /* Toward --text, so a muted theme accent still reads. */
    color: color-mix(in srgb, var(--accent) 60%, var(--text));
    padding: 0.1em 0.35em 0.1em 1.55em;
    background: var(--icon) no-repeat 0.35em 50% / 1.05em, var(--accent-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .markdown :global(.mention:hover),
  .markdown :global(code.file-ref:hover) {
    background-color: color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .markdown :global(pre) {
    margin: 0.5em 0;
    padding: var(--space-1);
    background: var(--code-bg);
    color: var(--code-fg);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .markdown :global(.code-block) {
    margin: 0.5em 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--panel-border);
    background: var(--code-bg);
    overflow: hidden;
  }
  .markdown :global(.code-block pre) {
    margin: 0;
    border-radius: 0;
  }
  .markdown :global(.code-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.14rem 0.29rem;
    color: color-mix(in srgb, var(--code-fg) 55%, transparent);
    font-size: var(--text-label-size);
    user-select: none;
  }
  .markdown :global(.code-toggle) {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.36rem;
    height: 1.57rem;
    padding: 0 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .markdown :global(.code-toggle:hover) {
    color: var(--code-fg);
  }
  .markdown :global(.code-toggle svg) {
    width: 13px;
    height: 13px;
    flex: none;
    transform: rotate(90deg);
    transition: transform calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .markdown :global(.code-lang) {
    font-family: var(--code-font-family);
  }
  /* The line count only says something when the code itself is hidden. */
  .markdown :global(.code-lines) {
    opacity: 0;
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .markdown :global(.code-lines::before) {
    content: "· ";
  }
  /* Same zero-JS accordion as ThinkingBlock: 0fr/1fr rows track the code's real height. Forced
     shut while it's still streaming in, and opens by itself once the fence closes. */
  .markdown :global(.code-body) {
    display: grid;
    grid-template-rows: 1fr;
    border-top: 1px solid color-mix(in srgb, var(--code-fg) 10%, transparent);
    transition:
      grid-template-rows calc(0.24s * var(--anim-speed, 1)) ease,
      border-color calc(0.24s * var(--anim-speed, 1)) ease;
  }
  .markdown :global(.code-clip) {
    min-height: 0;
    overflow: hidden;
  }
  .markdown :global(.code-block[data-collapsed] .code-body),
  .markdown :global(.code-block[data-streaming] .code-body) {
    grid-template-rows: 0fr;
    border-top-color: transparent;
  }
  .markdown :global(.code-block[data-collapsed] .code-toggle svg),
  .markdown :global(.code-block[data-streaming] .code-toggle svg) {
    transform: none;
  }
  .markdown :global(.code-block[data-collapsed] .code-lines),
  .markdown :global(.code-block[data-streaming] .code-lines) {
    opacity: 1;
  }
  /* Nothing to open yet, so the toggle stops looking like one. */
  .markdown :global(.code-block[data-streaming] .code-toggle) {
    pointer-events: none;
  }
  .markdown :global(.code-copy),
  .markdown :global(.mm-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.57rem;
    height: 1.57rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  .markdown :global(.code-copy:hover),
  .markdown :global(.mm-btn:hover) {
    background: color-mix(in srgb, var(--code-fg) 10%, transparent);
    color: var(--code-fg);
  }
  .markdown :global(.code-copy svg),
  .markdown :global(.mm-btn svg) {
    width: 14px;
    height: 14px;
  }
  /* Copy icon, swapped for a check for a moment after copying. */
  .markdown :global(.code-copy svg + svg),
  .markdown :global(.code-copy.copied svg:first-child) {
    display: none;
  }
  .markdown :global(.code-copy.copied svg + svg) {
    display: block;
    color: var(--success);
  }
  .markdown :global(pre code) {
    background: none;
    padding: 0;
    border-radius: 0;
    white-space: var(--code-wrap, pre);
    word-break: break-word;
  }
  /* Token classes to ANSI slots of the picked palette (see highlight.ts). */
  .markdown :global(.hljs-comment),
  .markdown :global(.hljs-quote),
  .markdown :global(.hljs-meta) {
    color: var(--syn-comment);
    font-style: italic;
  }
  .markdown :global(.hljs-keyword),
  .markdown :global(.hljs-selector-tag),
  .markdown :global(.hljs-doctag) {
    color: var(--syn-keyword);
  }
  .markdown :global(.hljs-string),
  .markdown :global(.hljs-regexp),
  .markdown :global(.hljs-addition),
  .markdown :global(.hljs-char) {
    color: var(--syn-string);
  }
  .markdown :global(.hljs-number),
  .markdown :global(.hljs-literal),
  .markdown :global(.hljs-symbol),
  .markdown :global(.hljs-attr),
  .markdown :global(.hljs-attribute),
  .markdown :global(.hljs-selector-attr) {
    color: var(--syn-number);
  }
  .markdown :global(.hljs-title),
  .markdown :global(.hljs-section),
  .markdown :global(.hljs-selector-id) {
    color: var(--syn-function);
  }
  .markdown :global(.hljs-type),
  .markdown :global(.hljs-built_in),
  .markdown :global(.hljs-title.class_),
  .markdown :global(.hljs-selector-class) {
    color: var(--syn-type);
  }
  .markdown :global(.hljs-variable),
  .markdown :global(.hljs-template-variable),
  .markdown :global(.hljs-name),
  .markdown :global(.hljs-deletion),
  .markdown :global(.hljs-selector-pseudo) {
    color: var(--syn-variable);
  }
  .markdown :global(.hljs-emphasis) {
    font-style: italic;
  }
  .markdown :global(.hljs-strong) {
    font-weight: 700;
  }
  /* A wide table scrolls inside its own box (sanitize.ts wraps it) rather than stretching the chat. */
  .markdown :global(.table-wrap) {
    margin: 0.5em 0;
    max-width: 100%;
    overflow-x: auto;
  }
  .markdown :global(table) {
    margin: 0;
    border-collapse: collapse;
    font-size: 0.92em;
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 0.3em 0.6em;
    border: 1px solid var(--panel-border);
    /* break-word, not anywhere: a narrow column shouldn't be crushed to a letter wide. */
    overflow-wrap: break-word;
  }
  .markdown :global(th) {
    font-weight: 700;
    background: rgba(255, 255, 255, 0.03);
  }
  .markdown :global(tbody tr:nth-child(even) td) {
    background: rgba(255, 255, 255, 0.02);
  }
  .markdown :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
  /* sanitize.ts drops the src of an image it won't load (not https or inline). */
  .markdown :global(img:not([src])) {
    display: none;
  }
  /* GFM task lists: the checkbox stands in for the bullet. */
  .markdown :global(li:has(> input[type="checkbox"])),
  .markdown :global(li:has(> p:first-child > input[type="checkbox"])) {
    list-style: none;
  }
  .markdown :global(li > input[type="checkbox"]),
  .markdown :global(li > p:first-child > input[type="checkbox"]) {
    margin: 0 0.4em 0 -1.4em;
    vertical-align: -0.2em;
    width: 1.05em;
    height: 1.05em;
  }

  /* Math (mathRender.ts). KaTeX's own stylesheet loads with it; these fit it into the chat. */
  .markdown :global(.katex) {
    font-size: 1.08em;
    overflow-wrap: normal;
  }
  .markdown :global(.katex-display) {
    margin: 0.6em 0;
    padding: 0.15em 0;
    overflow: auto hidden;
  }
  .markdown :global(.math-pending) {
    font-family: var(--code-font-family);
    font-size: var(--code-font-size);
    color: var(--text-dim);
  }
  .markdown :global(div.math-pending) {
    margin: 0.5em 0;
    white-space: pre-wrap;
  }
  .markdown :global(.katex-error) {
    color: var(--danger);
  }

  /* Mermaid (see mermaidBlock in highlight.ts). Until the diagram is in, it's an ordinary code
     block; then the diagram shows and the source is one click away. */
  .markdown :global(.mm-btn),
  .markdown :global(.mm-error),
  .markdown :global(.mermaid-out) {
    display: none;
  }
  .markdown :global(.mermaid-block[data-rendered] .mm-btn) {
    display: inline-flex;
  }
  .markdown :global(.mm-view svg + svg),
  .markdown :global(.mermaid-block[data-view="source"] .mm-view svg:first-child) {
    display: none;
  }
  .markdown :global(.mermaid-block[data-view="source"] .mm-view svg + svg) {
    display: block;
  }
  .markdown :global(.mermaid-block[data-error] .mm-error) {
    display: inline;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--danger);
  }
  .markdown :global(.mermaid-block[data-rendered][data-view="diagram"] .mermaid-out) {
    display: flex;
    justify-content: center;
    padding: var(--space-1);
    overflow: auto;
    border-top: 1px solid color-mix(in srgb, var(--code-fg) 10%, transparent);
  }
  .markdown :global(.mermaid-block[data-rendered][data-view="diagram"] .code-body) {
    display: none;
  }
  .markdown :global(.mermaid-block[data-rendered][data-collapsed] .mermaid-out) {
    display: none;
  }
  .markdown :global(.mermaid-out svg) {
    max-width: 100%;
    height: auto;
  }
</style>

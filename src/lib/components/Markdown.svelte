<script lang="ts" module>
  import { Marked } from "marked";
  import { highlightCode } from "../highlight";
  // One shared instance for plain (non-mention) Markdown — its own rather
  // than marked's global, so the highlighting extension isn't registered
  // app-wide.
  const plain = new Marked(highlightCode);
</script>

<script lang="ts">
  import type { Token, Links } from "marked";
  import DOMPurify from "dompurify";
  import { openUrl } from "../platform";
  import { mentionLabels, mentionLabelsFor, MENTION_RE, withMentions } from "../mentions";

  // `mentions`: render `@path/to/file` tokens as file chips (user messages —
  // that's where the composer's @-autocomplete puts them).
  let { text, mentions = false }: { text: string; mentions?: boolean } = $props();
  const PARSE_OPTS = { breaks: true, gfm: true };
  const md = $derived(mentions ? withMentions(new Marked(highlightCode)) : plain);
  // Passing options to lexer/parser *replaces* the instance's defaults —
  // which is where md.use() put the mention extension — so merge instead.
  const opts = $derived({ ...md.defaults, ...PARSE_OPTS });


  // Re-parsing/re-sanitizing the *whole* message on every streamed token is
  // wasted work that only gets worse the longer a reply runs — the same
  // problem Vercel's Streamdown solves by splitting into block-level tokens
  // and only re-rendering whichever one is still growing. `marked.lexer`
  // already gives us that split (no new dependency): every earlier block is
  // cached by its own raw text, so once a paragraph/list/code-fence closes,
  // it's parsed and sanitized exactly once no matter how much streams in
  // after it. Keyed by index in the template below, so Svelte only touches
  // the one DOM node that actually changed each tick.
  //
  // Known ceiling: a block is cached the moment its raw text stops changing,
  // using whatever `links` (reference-style `[x]: url` definitions) existed
  // in the stream *at that moment* — a definition that streams in later
  // won't retroactively fix an already-cached block that referenced it
  // earlier. Vanishingly rare in model output; not worth the bookkeeping to
  // detect and re-render.
  let blocks = $state<string[]>([]);
  const cache: { raw: string; html: string }[] = [];
  let raf = 0;

  function render(t: string) {
    if (mentions) mentionLabels.current = labelsFor(t);
    const allTokens = md.lexer(t, opts);
    const links = allTokens.links;
    const tokens = allTokens.filter((tok) => tok.type !== "space");
    const next: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const cached = cache[i];
      if (i < tokens.length - 1 && cached?.raw === tok.raw) {
        next.push(cached.html);
        continue;
      }
      const sub = Object.assign([tok], { links }) as Token[] & { links: Links };
      const rendered = DOMPurify.sanitize(md.parser(sub, opts) as string);
      next.push(rendered);
      cache[i] = { raw: tok.raw, html: rendered };
    }
    cache.length = tokens.length;
    blocks = next;
  }

  function labelsFor(t: string): Map<string, string> {
    return mentionLabelsFor([...t.matchAll(new RegExp(MENTION_RE.source, "g"))].map((m) => m[1]));
  }

  $effect(() => {
    const t = text;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(t));
    return () => cancelAnimationFrame(raf);
  });

  // Links must never navigate the app's own page away.
  function onClick(e: MouseEvent) {
    const copy = (e.target as HTMLElement).closest?.<HTMLElement>(".code-copy");
    if (copy) {
      const code = copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard?.writeText(code);
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 1500);
      return;
    }
    const a = (e.target as HTMLElement).closest?.("a");
    const href = a?.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    openUrl(href).catch(() => {});
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown selectable" onclick={onClick}>
  {#each blocks as blockHtml, i (i)}
    {@html blockHtml}
  {/each}
</div>

<style>
  .markdown {
    font-size: inherit;
    line-height: 1.55;
  }
  .markdown :global(> *:first-child) {
    margin-top: 0;
  }
  .markdown :global(> *:last-child) {
    margin-bottom: 0;
  }
  .markdown :global(.mention) {
    color: var(--accent);
    font-weight: 500;
    cursor: default;
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
    padding: 0.14rem 0.29rem 0.14rem var(--space-1);
    border-bottom: 1px solid color-mix(in srgb, var(--code-fg) 10%, transparent);
    color: color-mix(in srgb, var(--code-fg) 55%, transparent);
    font-size: var(--text-label-size);
    user-select: none;
  }
  .markdown :global(.code-lang) {
    font-family: var(--code-font-family);
  }
  .markdown :global(.code-copy) {
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
  .markdown :global(.code-copy:hover) {
    background: color-mix(in srgb, var(--code-fg) 10%, transparent);
    color: var(--code-fg);
  }
  .markdown :global(.code-copy svg) {
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
  /* Token classes → ANSI slots of the picked palette (see highlight.ts). */
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
  .markdown :global(table) {
    margin: 0.5em 0;
    border-collapse: collapse;
    font-size: 0.92em;
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 0.3em 0.6em;
    border: 1px solid var(--panel-border);
  }
  .markdown :global(th) {
    font-weight: 700;
    background: rgba(255, 255, 255, 0.03);
  }
  .markdown :global(img) {
    max-width: 100%;
    border-radius: var(--radius-sm);
  }
</style>

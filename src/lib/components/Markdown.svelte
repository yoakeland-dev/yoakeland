<script lang="ts">
  import { marked, type Token, type Links } from "marked";
  import DOMPurify from "dompurify";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let { text }: { text: string } = $props();

  const PARSE_OPTS = { breaks: true, gfm: true };

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
    const allTokens = marked.lexer(t, PARSE_OPTS);
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
      const rendered = DOMPurify.sanitize(marked.parser(sub, PARSE_OPTS) as string);
      next.push(rendered);
      cache[i] = { raw: tok.raw, html: rendered };
    }
    cache.length = tokens.length;
    blocks = next;
  }

  $effect(() => {
    const t = text;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(t));
    return () => cancelAnimationFrame(raf);
  });

  // Links must never navigate the app's own webview away from itself.
  function onClick(e: MouseEvent) {
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
    background: rgba(0, 0, 0, 0.25);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .markdown :global(pre code) {
    background: none;
    padding: 0;
    border-radius: 0;
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

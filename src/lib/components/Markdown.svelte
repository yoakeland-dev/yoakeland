<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let { text }: { text: string } = $props();

  // Re-parsing markdown on every streamed token is wasted work — the screen
  // only repaints ~60x/sec regardless. Coalescing to one parse per animation
  // frame keeps a fast token stream from ever falling behind.
  let html = $state("");
  let raf = 0;

  $effect(() => {
    const t = text;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const parsed = marked.parse(t, { async: false, breaks: true, gfm: true }) as string;
      html = DOMPurify.sanitize(parsed);
    });
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
<div class="markdown selectable" onclick={onClick}>{@html html}</div>

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

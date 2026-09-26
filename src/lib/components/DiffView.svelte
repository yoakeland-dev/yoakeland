<script lang="ts">
  import type { FileDiff } from "../types";

  // `numbered` adds hunk headers and old/new line numbers; `limit` cuts the rendering off after
  // that many lines behind a "show more" button, so a huge diff doesn't stall the panel.
  let {
    diff,
    numbered = false,
    showPath = true,
    limit = Infinity,
  }: { diff: FileDiff; numbered?: boolean; showPath?: boolean; limit?: number } = $props();

  let expanded = $state(false);

  type Row =
    | { kind: "hunk"; text: string }
    | { kind: "line"; type: string; content: string; old?: number; new?: number };

  const rows = $derived.by(() => {
    const out: Row[] = [];
    for (const h of diff.hunks) {
      if (numbered) out.push({ kind: "hunk", text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` });
      let o = h.oldStart;
      let n = h.newStart;
      for (const l of h.lines) {
        out.push({
          kind: "line",
          type: l.type,
          content: l.content,
          old: l.type === "+" ? undefined : o++,
          new: l.type === "-" ? undefined : n++,
        });
      }
    }
    return out;
  });
  const shown = $derived(expanded ? rows : rows.slice(0, limit));
  // Rows go out in fixed-size chunks that each skip layout and paint while offscreen
  // (content-visibility), so a long diff costs about a screenful however long it is.
  const CHUNK = 60;
  const chunks = $derived(Array.from({ length: Math.ceil(shown.length / CHUNK) }, (_, i) => shown.slice(i * CHUNK, (i + 1) * CHUNK)));
</script>

<div class="diff">
  {#if showPath}<div class="path">{diff.filePath}</div>{/if}
  {#each chunks as chunk}
    <div class="chunk">
      {#each chunk as row}
        {#if row.kind === "hunk"}
          <div class="hunk-head">{row.text}</div>
        {:else}
          <div class="line type-{row.type === ' ' ? 'ctx' : row.type === '+' ? 'add' : 'del'}">
            {#if numbered}<span class="num">{row.old ?? ""}</span><span class="num">{row.new ?? ""}</span>{/if}
            <span class="marker">{row.type}</span><span class="content selectable">{row.content}</span>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="hunk-head">No changes</div>
  {/each}
  {#if shown.length < rows.length}
    <button type="button" class="more" onclick={() => (expanded = true)}>
      Show {rows.length - shown.length} more lines
    </button>
  {/if}
</div>

<style>
  .diff {
    margin-top: 0.43rem;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-family: var(--code-font-family);
    font-size: var(--code-font-size);
  }
  /* Settings > Appearance > Code blocks: long lines scroll sideways instead of wrapping. */
  :global(:root[data-code-wrap="off"]) .diff {
    overflow-x: auto;
  }
  :global(:root[data-code-wrap="off"]) .chunk,
  :global(:root[data-code-wrap="off"]) .line {
    width: max-content;
    min-width: 100%;
  }
  /* Roughly CHUNK lines tall until first measured, then its real size is remembered. */
  .chunk {
    content-visibility: auto;
    contain-intrinsic-size: auto 90em;
  }
  .path {
    padding: 0.43rem 0.71rem;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
  }
  .hunk-head {
    padding: 0.21rem 0.71rem;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-dim);
  }
  .line {
    display: flex;
    padding: 0.07rem 0.71rem;
    white-space: var(--code-wrap, pre-wrap);
    word-break: break-word;
  }
  .num {
    width: 2.6rem;
    flex-shrink: 0;
    padding-right: 0.5rem;
    text-align: right;
    color: var(--text-dim);
    opacity: 0.6;
    user-select: none;
  }
  .marker {
    width: 1rem;
    flex-shrink: 0;
    opacity: 0.6;
  }
  .type-add {
    background: rgba(88, 214, 141, 0.14);
  }
  .type-del {
    background: rgba(255, 107, 107, 0.14);
  }
  .more {
    width: 100%;
    padding: 0.36rem;
    background: rgba(255, 255, 255, 0.04);
    border: none;
    border-top: 1px solid var(--panel-border);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .more:hover {
    background: var(--sidebar-hover);
  }
</style>

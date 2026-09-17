<script lang="ts">
  import type { FileDiff } from "../types";

  let { diff }: { diff: FileDiff } = $props();
</script>

<div class="diff">
  <div class="path">{diff.filePath}</div>
  {#each diff.hunks as hunk}
    <div class="hunk">
      {#each hunk.lines as line}
        <div class="line type-{line.type === ' ' ? 'ctx' : line.type === '+' ? 'add' : 'del'}">
          <span class="marker">{line.type}</span><span class="content selectable">{line.content}</span>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .diff {
    margin-top: 0.43rem;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  .path {
    padding: 0.43rem 0.71rem;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
  }
  .line {
    display: flex;
    padding: 0.07rem 0.71rem;
    white-space: pre-wrap;
    word-break: break-word;
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
</style>

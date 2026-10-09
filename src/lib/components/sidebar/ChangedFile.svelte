<script lang="ts" module>
  import type { GitChange } from "../../types";

  /** Porcelain letter to what the row shows: untracked reads as "U" like VS Code, conflicts as "!". */
  export function statusOf(letter: string, conflict = false) {
    if (conflict) return { badge: "!", tone: "conflict" as const };
    if (letter === "?") return { badge: "U", tone: "added" as const };
    if (letter === "A") return { badge: "A", tone: "added" as const };
    if (letter === "D") return { badge: "D", tone: "deleted" as const };
    return { badge: letter, tone: "modified" as const };
  }

  /** The most recent side of a change: the worktree's, else the staged one. */
  export const latest = (f: GitChange) => (f.worktree !== "." ? f.worktree : f.index);
</script>

<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // One changed file: a row that expands into its diff (against HEAD, or a snapshot's copy),
  // refetched while open whenever the project's files change.
  import { app } from "../../state.svelte";
  import { getFileDiff } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import { mentionText } from "../../mentions";
  import { fileIconUrl } from "../../fileIcons";
  import type { FileDiff } from "../../types";
  import ContextMenu from "../ContextMenu.svelte";
  import DiffView from "../DiffView.svelte";
  import Icon from "../Icon.svelte";

  let {
    sessionId,
    projectPath,
    path,
    badge,
    tone = "modified",
    basePath,
    snapshotId,
    visible = true,
    // No fallback: a parent may bind an unset entry (undefined reads as collapsed).
    expanded = $bindable(),
  }: {
    sessionId: string;
    projectPath: string;
    path: string;
    badge: string;
    tone?: "added" | "deleted" | "modified" | "conflict";
    basePath?: string;
    snapshotId?: string;
    visible?: boolean;
    expanded?: boolean;
  } = $props();

  const server = $derived(app.active);
  const name = $derived(path.split("/").pop() ?? path);
  const dir = $derived(path.split("/").slice(0, -1).join("/"));

  let diff = $state<FileDiff | null>(null);
  let note = $state("");
  let loading = $state(false);

  const counts = $derived.by(() => {
    let add = 0;
    let del = 0;
    for (const h of diff?.hunks ?? []) for (const l of h.lines) l.type === "+" ? add++ : l.type === "-" && del++;
    return { add, del };
  });

  async function load() {
    const cid = app.activeConnectionId;
    if (!cid) return;
    loading = true;
    try {
      const r = await getFileDiff(cid, projectPath, path, { snapshotId, basePath });
      diff = r.diff ?? null;
      note = r.error ?? (r.binary ? "Binary file" : "");
    } catch (e) {
      note = String(e);
    } finally {
      loading = false;
    }
  }

  // Loads on expanding, then again as files change, while this is on screen.
  refreshWhenVisible(() => server?.fsTickByProject[projectPath] ?? 0, () => visible && !!expanded, load, { delay: 0 });
</script>

<ContextMenu
  items={[
    { label: "Open file", icon: "file-text", onSelect: () => server?.revealFile(sessionId, path) },
    { label: "Mention in chat", icon: "at-sign", onSelect: () => server?.insertIntoComposer(sessionId, mentionText(path)) },
    { label: "Copy relative path", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(path) },
  ]}
>
  <button type="button" class="row" {@attach tip(basePath ? `${basePath} → ${path}` : path)} onclick={() => (expanded = !expanded)}>
    <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
    <img class="ficon" src={fileIconUrl(name)} alt="" />
    <span class="name">{name}</span>
    <span class="dir">{dir}</span>
    {#if diff}
      <span class="counts"><span class="add">+{counts.add}</span> <span class="del">−{counts.del}</span></span>
    {/if}
    <span class="badge {tone}">{badge}</span>
  </button>
</ContextMenu>
{#if expanded}
  <div class="body">
    {#if note}
      <div class="note">{note}</div>
    {:else if diff}
      <DiffView {diff} numbered showPath={false} limit={300} />
    {:else if loading}
      <div class="note">Loading…</div>
    {/if}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    width: 100%;
    padding: 0.21rem var(--space-1);
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover {
    background: var(--sidebar-hover);
  }
  .row :global(.icon) {
    color: var(--text-dim);
  }
  .ficon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .name {
    flex-shrink: 0;
  }
  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-dim);
    direction: rtl;
    text-align: left;
  }
  .counts {
    font-variant-numeric: tabular-nums;
  }
  .add {
    color: var(--diff-add);
  }
  .del {
    color: var(--diff-del);
  }
  .badge {
    width: 1rem;
    text-align: center;
    font-weight: 600;
    font-family: ui-monospace, monospace;
  }
  .badge.added {
    color: var(--diff-add);
  }
  .badge.deleted {
    color: var(--diff-del);
  }
  .badge.modified {
    color: var(--warning);
  }
  .badge.conflict {
    color: var(--danger);
  }
  /* Offscreen diffs skip layout and paint, so "Expand all" on a big change set doesn't re-wrap
     thousands of lines on every frame of a resize. */
  .body {
    padding: 0 var(--space-1) var(--space-1);
    content-visibility: auto;
    contain-intrinsic-size: auto 20rem;
  }
  .note {
    padding: 0.36rem 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
</style>

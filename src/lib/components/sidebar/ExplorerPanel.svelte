<script lang="ts">
  import { tip } from "../../tooltip.svelte";
  // The project tree plus an editor with tabs. Narrow (beside the chat) it's either the tree or
  // the open files; wide (the tools column swapped into the main area) it's both side by side.
  // Ctrl+P filters every project file by name; Ctrl+W closes the current tab.
  import { tick as domTick, untrack } from "svelte";
  import { app } from "../../state.svelte";
  import { fsOp, listFiles, listTree } from "../../ipc";
  import { refreshWhenVisible } from "../../refresh.svelte";
  import { isDesktop, revealItemInDir } from "../../platform";
  import { mentionText } from "../../mentions";
  import { fileIconUrl, folderIcon } from "../../fileIcons";
  import { fuzzyFilter } from "../../fuzzy";
  import { keyLabel, matches as keyMatches } from "../../keybinds.svelte";
  import type { TreeEntry } from "../../types";
  import ContextMenu, { type ContextMenuItem } from "../ContextMenu.svelte";
  import Icon from "../Icon.svelte";
  import FileEditor from "./FileEditor.svelte";
  import EmptyState from "./EmptyState.svelte";

  let {
    sessionId,
    projectPath,
    wide = false,
    visible = true,
  }: { sessionId: string; projectPath: string; wide?: boolean; visible?: boolean } = $props();

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);

  // Folder contents by project-relative path ("" is the root), loaded as folders open.
  let children = $state<Record<string, TreeEntry[]>>({});
  let expanded = $state<Record<string, boolean>>({ "": true });
  let error = $state("");
  let opError = $state("");
  let selected = $state<string | null>(null);

  // Open files. Every tab keeps its editor mounted, so undo history and scroll survive switching.
  type Tab = { path: string; from?: number; to?: number };
  let tabs = $state<Tab[]>([]);
  let active = $state<string | null>(null);
  let dirty = $state<Record<string, boolean>>({});
  // Narrow only: which of the two is showing.
  let showing = $state<"tree" | "editor">("tree");

  // An inline name input: a new entry inside `dir`, or renaming `path`.
  let naming = $state<{ kind: "file" | "folder" | "rename"; dir: string; path?: string; value: string } | null>(null);
  let nameInput = $state<HTMLInputElement | null>(null);

  // Quick open: a flat, fuzzy-matched list of every file replaces the tree while there's a query.
  let query = $state("");
  let queryInput = $state<HTMLInputElement | null>(null);
  let hit = $state(0);
  const allFiles = $derived(server?.filesByProject[projectPath]);
  const matches = $derived(query.trim() ? fuzzyFilter(allFiles ?? [], query.trim()) : []);
  $effect(() => {
    void matches;
    hit = 0;
  });

  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
  /** A typed name may be a path ("docs/api/intro.md"); null if it's empty or climbs out of the project. */
  function normalize(p: string): string | null {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "..") {
        if (!out.pop()) return null;
      } else if (seg && seg !== ".") out.push(seg);
    }
    return out.join("/") || null;
  }
  const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const under = (p: string, root: string) => p === root || p.startsWith(root + "/");

  async function load(dir: string) {
    if (!cid) return;
    try {
      const r = await listTree(cid, projectPath, dir);
      if (r.error) {
        if (dir === "") error = r.error;
        delete children[dir];
        return;
      }
      if (dir === "") error = "";
      children[dir] = r.entries;
    } catch (e) {
      if (dir === "") error = String(e);
    }
  }

  const refreshAll = () => Promise.all(Object.keys(children).filter((d) => d === "" || expanded[d]).map(load));

  // Only a project change resets the tree; a reconnect (new connection id) mustn't.
  $effect(() => {
    void projectPath;
    untrack(() => {
      children = {};
      expanded = { "": true };
      tabs = [];
      active = null;
      dirty = {};
      showing = "tree";
      query = "";
      void load("");
    });
  });

  // Files changed on disk (our own ops, an agent's turn, another device): refetch open folders.
  refreshWhenVisible(
    () => server?.fsTickByProject[projectPath] ?? 0,
    () => visible,
    () => {
      void refreshAll();
      if (allFiles && cid) listFiles(cid, projectPath);
    },
    { delay: 300, skipFirst: true },
  );

  function toggle(dir: string) {
    expanded[dir] = !expanded[dir];
    if (expanded[dir]) void load(dir);
  }

  function open(path: string, from?: number, to?: number) {
    selected = path;
    const tab = tabs.find((t) => t.path === path);
    if (tab) Object.assign(tab, { from, to });
    else {
      dirty[path] = false; // bound below; FileEditor's prop can't bind to undefined
      tabs.push({ path, from, to });
    }
    active = path;
    showing = "editor";
  }

  function closeTab(path: string) {
    if (dirty[path] && !confirm(`Discard unsaved changes to ${path.split("/").pop()}?`)) return;
    dropTabs((p) => p === path);
  }

  function dropTabs(match: (path: string) => boolean) {
    const i = tabs.findIndex((t) => t.path === active);
    tabs = tabs.filter((t) => !match(t.path));
    for (const p of Object.keys(dirty)) if (match(p)) delete dirty[p];
    if (active && match(active)) active = tabs[Math.min(Math.max(i, 0), tabs.length - 1)]?.path ?? null;
    if (!active) showing = "tree";
  }

  /** Opens every folder above `path`, so its row is in the tree. */
  function expandTo(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      expanded[dir] = true;
      void load(dir);
    }
  }

  // A mention click or another panel asked for a file: open its folders, then the file.
  $effect(() => {
    const r = server?.revealFileBySession[sessionId];
    if (!r || !server) return;
    delete server.revealFileBySession[sessionId];
    untrack(() => {
      expandTo(r.path);
      open(r.path, r.from, r.to);
    });
  });

  async function startNaming(n: NonNullable<typeof naming>) {
    if (n.kind !== "rename" && n.dir && !expanded[n.dir]) toggle(n.dir);
    query = "";
    showing = "tree";
    naming = n;
    await domTick();
    nameInput?.focus();
    if (n.kind === "rename") nameInput?.setSelectionRange(0, n.value.lastIndexOf(".") > 0 ? n.value.lastIndexOf(".") : n.value.length);
  }

  async function commitNaming() {
    const n = naming;
    naming = null;
    const value = n?.value.trim();
    if (!n || !value || !cid) return;
    // The server makes any missing folders on the way.
    const target = normalize(join(n.dir, value));
    if (!target) return void (opError = "That path is outside the project.");
    if (n.kind === "rename" && target === n.path) return;
    const r = await fsOp(cid, projectPath, n.kind === "file" ? "create" : n.kind === "folder" ? "mkdir" : "rename", n.path ?? target, n.kind === "rename" ? target : undefined).catch((e) => ({ error: String(e) }));
    if (r.error) return void (opError = r.error);
    opError = "";
    expandTo(target);
    void load(parentOf(target));
    selected = target;
    if (n.kind === "file") open(target);
    // Open tabs follow a renamed file, or anything inside a renamed folder.
    if (n.kind === "rename" && n.path) {
      const old = n.path;
      const moved = (p: string) => target + p.slice(old.length);
      for (const t of tabs) {
        if (!under(t.path, old)) continue;
        dirty[moved(t.path)] = dirty[t.path] ?? false;
        t.path = moved(t.path);
      }
      if (active && under(active, old)) active = moved(active);
    }
  }

  async function remove(path: string, isDir: boolean) {
    if (!cid || !confirm(`Delete ${isDir ? "folder" : "file"} "${path}"${isDir ? " and everything in it" : ""}? This can't be undone.`)) return;
    const r = await fsOp(cid, projectPath, "delete", path).catch((e) => ({ error: String(e) }));
    if (r.error) return void (opError = r.error);
    opError = "";
    dropTabs((p) => under(p, path));
  }

  const absolute = (rel: string) => (rel ? `${projectPath.replace(/\/+$/, "")}/${rel}` : projectPath);
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  // The file manager and absolute paths only mean something on the machine the files are on.
  const local = $derived(isDesktop && server?.connectionMode === "local");

  // One menu for the whole tree; rows set the target on right-click, before it opens.
  let menuTarget = $state<{ path: string; isDir: boolean } | null>(null);
  function menuItems(): ContextMenuItem[] {
    const { path, isDir } = menuTarget ?? { path: "", isDir: true };
    const dir = isDir ? path : parentOf(path);
    const items: ContextMenuItem[] = [
      { label: "New file", icon: "file-plus", onSelect: () => startNaming({ kind: "file", dir, value: "" }) },
      { label: "New folder", icon: "folder-plus", onSelect: () => startNaming({ kind: "folder", dir, value: "" }) },
    ];
    if (path) {
      items.push(
        { label: "Mention in chat", icon: "at-sign", onSelect: () => server?.insertIntoComposer(sessionId, mentionText(path)) },
        { label: "Rename", icon: "pencil", onSelect: () => startNaming({ kind: "rename", dir: parentOf(path), path, value: path.split("/").pop()! }) },
        { label: "Copy relative path", icon: "copy", onSelect: () => copy(path) },
      );
    }
    if (local) items.push({ label: "Copy path", icon: "copy", onSelect: () => copy(absolute(path)) });
    items.push({ label: "Open terminal here", icon: "terminal-2", onSelect: () => openTerminal(dir) });
    if (local) items.push({ label: "Reveal in file manager", icon: "folder-open", onSelect: () => void revealItemInDir(absolute(path)) });
    if (path) items.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => remove(path, isDir) });
    return items;
  }

  function openTerminal(dir: string) {
    server?.newTerminal(sessionId, dir || undefined);
  }

  // Wide only: the tree's width, dragged from its right edge and kept across restarts.
  const TREE_W_KEY = "yoake.explorerTreeWidth";
  let treeW = $state(Number((() => { try { return localStorage.getItem(TREE_W_KEY); } catch { return null; } })()) || 260);
  let treeDrag: { x: number; w: number; max: number } | null = null;
  let treeResizing = $state(false);
  function startTreeResize(e: PointerEvent) {
    const files = (e.currentTarget as HTMLElement).parentElement!;
    treeDrag = { x: e.clientX, w: files.offsetWidth, max: files.parentElement!.clientWidth - 240 };
    treeResizing = true;
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onTreeResize(e: PointerEvent) {
    if (treeDrag) treeW = Math.round(Math.max(160, Math.min(treeDrag.max, treeDrag.w + e.clientX - treeDrag.x)));
  }
  function stopTreeResize() {
    if (!treeDrag) return;
    treeDrag = null;
    treeResizing = false;
    document.body.style.cursor = "";
    try {
      localStorage.setItem(TREE_W_KEY, String(treeW));
    } catch {
      // best-effort only
    }
  }

  // A plain wheel scrolls the sideways-only tab strip sideways.
  function wheelSideways(e: WheelEvent) {
    const el = e.currentTarget as HTMLElement;
    if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }

  function collapseAll() {
    expanded = { "": true };
  }

  function focusQuickOpen() {
    showing = "tree";
    if (!allFiles && cid) listFiles(cid, projectPath);
    requestAnimationFrame(() => {
      queryInput?.focus();
      queryInput?.select();
    });
  }

  function onQueryKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length) hit = (hit + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
    } else if (e.key === "Enter" && matches[hit]) {
      open(matches[hit]);
      query = "";
    } else if (e.key === "Escape") {
      query = "";
      queryInput?.blur();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (keyMatches(e, "files.quickOpen")) {
      e.preventDefault();
      focusQuickOpen();
    } else if (keyMatches(e, "files.close") && active) {
      e.preventDefault();
      closeTab(active);
    }
  }
</script>

{#snippet nameRow(depth: number)}
  <div class="row naming" style="--depth: {depth}">
    <span class="twisty"></span>
    <Icon name={naming?.kind === "folder" ? "folder" : "file"} size={14} />
    <input
      bind:this={nameInput}
      bind:value={naming!.value}
      placeholder={naming?.kind === "folder" ? "name, or path/to/folder" : "name, or path/to/file"}
      spellcheck="false"
      onkeydown={(e) => {
        if (e.key === "Enter") void commitNaming();
        if (e.key === "Escape") naming = null;
      }}
      onblur={() => void commitNaming()}
    />
  </div>
{/snippet}

{#snippet folder(dir: string, depth: number)}
  {#if naming && naming.kind !== "rename" && naming.dir === dir}{@render nameRow(depth)}{/if}
  {#each children[dir] ?? [] as e (e.name)}
    {@const path = join(dir, e.name)}
    {#if naming?.kind === "rename" && naming.path === path}
      {@render nameRow(depth)}
    {:else}
      <button
        type="button"
        class="row"
        class:selected={selected === path}
        class:current={path === active}
        style="--depth: {depth}"
        {@attach tip(path)}
        oncontextmenu={() => (menuTarget = { path, isDir: e.isDir })}
        onclick={() => {
          selected = path;
          if (e.isDir) toggle(path);
          else open(path);
        }}
      >
        <span class="twisty">{#if e.isDir}<Icon name={expanded[path] ? "chevron-down" : "chevron-right"} size={12} />{/if}</span>
        {#if e.isDir}
          <Icon name={folderIcon(e.name, !!expanded[path]) as any} size={14} />
        {:else}
          <img class="ficon" src={fileIconUrl(e.name)} alt="" />
        {/if}
        <span class="label" class:link={e.isSymlink}>{e.name}</span>
      </button>
    {/if}
    {#if e.isDir && expanded[path]}{@render folder(path, depth + 1)}{/if}
  {/each}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="explorer" class:wide onkeydown={onKeydown}>
  {#if wide || showing === "tree"}
    <div class="files" style:flex-basis={wide ? `${treeW}px` : null}>
      <div class="toolbar">
        <label class="quick">
          <Icon name="search" size={13} />
          <input
            bind:this={queryInput}
            bind:value={query}
            placeholder="Go to file…"
            {@attach tip("Go to file", "files.quickOpen")}
            spellcheck="false"
            onfocus={() => !allFiles && cid && listFiles(cid, projectPath)}
            onkeydown={onQueryKey}
          />
        </label>
        <button type="button" class="btn" {@attach tip("New file")} onclick={() => startNaming({ kind: "file", dir: "", value: "" })}>
          <Icon name="file-plus" size={14} />
        </button>
        <button type="button" class="btn" {@attach tip("New folder")} onclick={() => startNaming({ kind: "folder", dir: "", value: "" })}>
          <Icon name="folder-plus" size={14} />
        </button>
        <button type="button" class="btn" {@attach tip("Refresh")} onclick={() => void refreshAll()}><Icon name="refresh" size={14} /></button>
        <button type="button" class="btn" {@attach tip("Collapse all")} onclick={collapseAll}><Icon name="arrows-minimize" size={14} /></button>
      </div>
      {#if opError}
        <button type="button" class="op-error" {@attach tip("Dismiss")} onclick={() => (opError = "")}>{opError}</button>
      {/if}
      {#if query.trim()}
        <div class="tree">
          {#each matches as path, i (path)}
            <button type="button" class="row match" class:selected={i === hit} {@attach tip(path)} onclick={() => (open(path), (query = ""))}>
              <img class="ficon" src={fileIconUrl(path)} alt="" />
              <span class="label">{path.split("/").pop()}</span>
              <span class="dir">{parentOf(path)}</span>
            </button>
          {:else}
            {#if allFiles}
              <EmptyState icon="list-search" title="No matching files" body="Searches file names only, not contents." />
            {:else}
              <EmptyState icon="loader-2" title="Listing files…" />
            {/if}
          {/each}
        </div>
      {:else}
        <ContextMenu items={menuItems} restoreFocus={false}>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="tree" oncontextmenu={(e) => e.target === e.currentTarget && (menuTarget = null)}>
            {#if error}
              <EmptyState icon="alert-circle" tone="danger" title="Couldn't list this folder" body={error}>
                <button type="button" onclick={() => void load("")}><Icon name="refresh" size={12} /> Try again</button>
              </EmptyState>
            {:else if children[""] && !children[""].length && !naming}
              <EmptyState icon="folder" title="This project is empty" body="Create a file, or ask the agent to scaffold one.">
                <button type="button" onclick={() => startNaming({ kind: "file", dir: "", value: "" })}><Icon name="file-plus" size={12} /> New file</button>
              </EmptyState>
            {/if}
            {@render folder("", 0)}
          </div>
        </ContextMenu>
      {/if}
      {#if wide}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resize-handle"
          class:active={treeResizing}
          onpointerdown={startTreeResize}
          onpointermove={onTreeResize}
          onpointerup={stopTreeResize}
          onpointercancel={stopTreeResize}
        ></div>
      {/if}
    </div>
  {/if}

  {#if wide || showing === "editor"}
    <div class="editors">
      {#if tabs.length || !wide}
        <div class="tabs" onwheel={wheelSideways}>
          {#if !wide}
            <button type="button" class="btn" {@attach tip("Files", "files.quickOpen")} onclick={() => (showing = "tree")}>
              <Icon name="chevron-left" size={14} />
            </button>
          {/if}
          {#each tabs as t (t.path)}
            {@const name = t.path.split("/").pop() ?? t.path}
            <div class="tab" class:active={t.path === active} {@attach tip(t.path)}>
              <button
                type="button"
                class="tab-main"
                onclick={() => (active = t.path)}
                onauxclick={(e) => e.button === 1 && closeTab(t.path)}
              >
                <img class="ficon" src={fileIconUrl(name)} alt="" />
                <span>{name}</span>
              </button>
              <button type="button" class="tab-x" class:dirty={dirty[t.path]} {@attach tip("Close", "files.close")} onclick={() => closeTab(t.path)}>
                <span class="dot">●</span>
                <Icon name="xmark" size={11} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
      {#each tabs as t (t.path)}
        <div class="editor-slot" hidden={t.path !== active}>
          <FileEditor
            {sessionId}
            {projectPath}
            path={t.path}
            from={t.from}
            to={t.to}
            visible={visible && t.path === active && (wide || showing === "editor")}
            bind:dirty={dirty[t.path]}
          />
        </div>
      {/each}
      {#if !tabs.length}
        <EmptyState icon="file" title="No file open" body={keyLabel("files.quickOpen") ? `Pick one from the tree, or press ${keyLabel("files.quickOpen")} and type part of its name.` : "Pick one from the tree, or search for it by name."} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .explorer {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .files,
  .editors {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .wide .files {
    position: relative;
    flex-grow: 0;
    flex-shrink: 0;
    max-width: calc(100% - 15rem);
    border-right: 1px solid var(--panel-border);
  }
  .resize-handle {
    position: absolute;
    top: 0;
    right: -0.21rem;
    width: 0.43rem;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    z-index: 5;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    top: 0;
    left: 50%;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
    transition: background calc(0.1s * var(--anim-speed, 1)) ease;
  }
  .resize-handle:hover::after,
  .resize-handle.active::after {
    background: var(--accent);
  }
  .quick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.36rem;
    height: 1.71rem;
    padding: 0 0.43rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .quick:focus-within {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
  }
  .quick input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
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
  .tabs {
    display: flex;
    align-items: stretch;
    min-height: 2.14rem;
    border-bottom: 1px solid var(--panel-border);
    overflow-x: auto;
    scrollbar-width: none;
    flex-shrink: 0;
  }
  .tabs > .btn {
    align-self: center;
    margin: 0 0.14rem;
  }
  .tab {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    max-width: 12rem;
    border-right: 1px solid var(--panel-border);
    color: var(--text-dim);
  }
  .tab.active {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .tab-main {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    min-width: 0;
    padding: 0 0.29rem 0 0.64rem;
    height: 100%;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .tab-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-x {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 1.29rem;
    margin-right: 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    color: inherit;
    cursor: pointer;
  }
  .tab-x:hover {
    background: var(--sidebar-hover);
  }
  /* Unsaved: a dot where the close button is, until hovered. */
  .tab-x .dot {
    display: none;
    font-size: 0.6rem;
    color: var(--accent);
  }
  .tab-x.dirty:not(:hover) .dot {
    display: block;
  }
  .tab-x.dirty:not(:hover) :global(.icon) {
    display: none;
  }
  .tab-x:not(.dirty) {
    opacity: 0;
  }
  .tab:hover .tab-x,
  .tab.active .tab-x {
    opacity: 1;
  }
  .editor-slot {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .editor-slot[hidden] {
    display: none;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.14rem;
    padding: 0.29rem var(--space-1);
    border-bottom: 1px solid var(--panel-border);
  }
  .btn {
    display: flex;
    padding: 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .btn:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-half) 0 var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    width: 100%;
    padding: 0.14rem var(--space-1) 0.14rem calc(var(--space-1) + var(--depth) * 0.86rem);
    background: none;
    border: none;
    color: var(--sidebar-fg, var(--text));
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover {
    background: var(--sidebar-hover);
  }
  .row.selected {
    background: var(--sidebar-hover);
  }
  .row.match.selected {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  /* The file in the editor. */
  .row.current {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text);
  }
  .row.current .label {
    color: var(--accent);
  }
  .row :global(.icon) {
    color: var(--text-dim);
  }
  .twisty {
    display: flex;
    width: 0.86rem;
    flex-shrink: 0;
  }
  .ficon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label.link {
    font-style: italic;
  }
  .naming input {
    flex: 1;
    min-width: 0;
    padding: 0.07rem 0.29rem;
    background: var(--input-bg, rgba(0, 0, 0, 0.2));
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
  }
  .op-error {
    padding: 0.36rem var(--space-1);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    border: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    cursor: pointer;
  }
</style>

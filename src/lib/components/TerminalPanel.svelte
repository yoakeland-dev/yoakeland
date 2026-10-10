<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Per-chat terminal drawer (SPEC.md §3.1/§3.2 terminal_*), laid out like VS Code's panel: a top
  // bar that is both the toolbar and the active terminal's status line, and a list of terminals
  // on the right once there's more than one. `overflow: hidden` + height:0 when closed means the
  // content genuinely isn't reachable, not just moved off-screen.
  //
  // Resizable up to half the panel's height, same clamp(min, ratio%, 50%) trick as
  // RightSidebar.svelte but vertical and without slide-off/collapse-by-drag: this panel
  // already has an explicit open/close toggle (ChatHeader.svelte).
  import { tick } from "svelte";
  import { app, TERMINAL_MIN_HEIGHT } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import TerminalView from "./TerminalView.svelte";
  import TerminalStatusIcon, { terminalState } from "./TerminalStatusIcon.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import { terminalAttach, terminalClose } from "../ipc";
  import { basename, terminalTitle } from "../format";
  import { swipe, commits } from "../gestures";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const open = $derived(server?.terminalOpenBySession[sessionId] ?? false);
  const tabIds = $derived(server?.terminalsBySession[sessionId] ?? []);
  const activeId = $derived(server?.activeTerminalBySession[sessionId]);
  const active = $derived(activeId ? server?.terminalById[activeId] : undefined);
  const activeState = $derived(active && terminalState(active));
  const splitOn = $derived(server?.terminalSplitBySession[sessionId] ?? false);
  const splitId = $derived(server?.splitTerminalBySession[sessionId]);
  // A brand-new chat's sessionId is minted locally and never told to the server until its
  // first message goes out, so there's no session for a terminal to run in yet.
  const isDraft = $derived(!(server?.messagesBySession[sessionId] ?? []).length);
  const home = $derived(server?.rootOf(sessionId) ?? server?.currentProjectPath);

  let views = $state<Record<string, TerminalView>>({});
  let draggingId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let slotEl = $state<HTMLDivElement | null>(null);

  // Phone: the top bar is the handle. Pull it down to shrink, then hide; push it up to fill the screen.
  const pull = {
    axis: "y",
    onMove: (d: number) => {
      if (slotEl) (slotEl.style.transition = "none"), (slotEl.style.transform = `translateY(${Math.max(0, d)}px)`);
    },
    onEnd: (d: number, v: number) => {
      if (slotEl) (slotEl.style.transition = ""), (slotEl.style.transform = "");
      if (d < -40 || v < -0.4) app.terminalMaximized = true;
      else if (commits(d / (slotEl?.offsetHeight || 1), v, 1)) {
        if (app.terminalMaximized) app.terminalMaximized = false;
        else server?.toggleTerminal(sessionId);
      }
    },
    onCancel: () => slotEl && (slotEl.style.transform = ""),
  } as const;

  // Spins up a first terminal when the drawer opens with nothing running, rather than showing an
  // empty pane with no way back in. Gated on `terminalsListedBySession` so it can't fire
  // before terminal_list confirms nothing's already running, or it'd race a redundant one.
  $effect(() => {
    if (open && !isDraft && server?.terminalsListedBySession[sessionId] && tabIds.length === 0 && !activeId) newTerminal();
  });

  // Opening the drawer hands the keyboard to the terminal, like VS Code's Ctrl+`.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && activeId) void tick().then(() => requestAnimationFrame(() => views[activeId]?.focus()));
    wasOpen = open;
  });

  // Inline, not custom properties on the slot, which would restyle the terminals inside on
  // every pointermove of a resize.
  const height = $derived(`clamp(${TERMINAL_MIN_HEIGHT}px, ${app.terminalHeightRatio * 100}%, 50%)`);

  // Measured once per drag, not per pointermove (a read right after a resize forces layout).
  let dragBox: DOMRect | null = null;
  function startResize(e: PointerEvent) {
    if (!open || !slotEl) return;
    dragBox = (slotEl.parentElement as HTMLElement).getBoundingClientRect();
    app.terminalMaximized = false;
    app.terminalResizing = true;
    document.body.style.cursor = "row-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!app.terminalResizing || !dragBox) return;
    const container = dragBox;
    const fromBottom = container.bottom - e.clientY;
    const clamped = Math.min(container.height * 0.5, Math.max(TERMINAL_MIN_HEIGHT, fromBottom));
    app.terminalHeightRatio = Math.min(0.5, Math.max(0, clamped / container.height));
  }
  function stopResize() {
    if (!app.terminalResizing) return;
    dragBox = null;
    app.terminalResizing = false;
    document.body.style.cursor = "";
    app.setTerminalHeightRatio(app.terminalHeightRatio);
  }

  function newTerminal() {
    if (server && !isDraft) server.newTerminal(sessionId);
  }

  /** Alt/Cmd-click while split is on loads the terminal into the split pane instead. */
  function select(id: string, e?: MouseEvent | KeyboardEvent) {
    if (!server) return;
    if (splitOn && e && (e.altKey || e.metaKey)) server.setSplitTerminalTab(sessionId, id);
    else server.setActiveTerminalTab(sessionId, id);
    requestAnimationFrame(() => views[id]?.focus());
  }

  function kill(id: string) {
    const cid = app.activeConnectionId;
    if (cid) terminalClose(cid, sessionId, id);
  }

  function restart(id: string) {
    const cid = app.activeConnectionId;
    const tab = server?.terminalById[id];
    if (cid && tab) terminalAttach(cid, sessionId, id, tab.cols, tab.rows, true);
    requestAnimationFrame(() => views[id]?.focus());
  }

  async function startRename(id: string) {
    const tab = server?.terminalById[id];
    if (!tab) return;
    renamingId = id;
    renameValue = terminalTitle(tab);
    await tick();
    const input = document.querySelector<HTMLInputElement>(".term-list .rename");
    input?.focus();
    input?.select();
  }
  function commitRename() {
    if (renamingId) server?.renameTerminal(renamingId, renameValue);
    renamingId = null;
  }

  function menuFor(id: string): ContextMenuItem[] {
    const tab = server?.terminalById[id];
    return [
      { label: "Rename", icon: "pencil", onSelect: () => void startRename(id) },
      ...(splitOn && id !== splitId && id !== activeId
        ? [{ label: "Show in split pane", icon: "layout-columns", onSelect: () => server?.setSplitTerminalTab(sessionId, id) } satisfies ContextMenuItem]
        : []),
      ...(tab?.status === "exited" ? [{ label: "Restart", icon: "refresh", onSelect: () => restart(id) } satisfies ContextMenuItem] : []),
      { label: "Kill terminal", icon: "trash", danger: true, onSelect: () => kill(id) },
    ];
  }

  function dragStart(id: string, e: DragEvent) {
    draggingId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  }
  function dropOn(id: string, e: DragEvent) {
    e.preventDefault();
    if (draggingId && draggingId !== id) server?.reorderTerminalTabs(sessionId, draggingId, id);
    draggingId = null;
  }

  // Paths under the project start at its name, the way the sidebar names it.
  function shortPath(path?: string) {
    if (!path) return "";
    if (home && (path === home || path.startsWith(home + "/"))) return basename(home) + path.slice(home.length);
    return path;
  }
</script>

<div
  class="terminal-slot"
  class:open
  class:max={open && app.terminalMaximized}
  class:resizing={app.terminalResizing}
  style:height={open && !app.terminalMaximized ? height : null}
  bind:this={slotEl}
>
  {#if open && isDraft}
    <div class="empty-state">
      <Icon name="terminal-2" size={20} />
      <p>Terminal isn't available yet</p>
      <span>This chat hasn't started — send a message first, then open a terminal here.</span>
    </div>
  {:else if open}
    <div class="bar" {@attach swipe(() => pull)}>
      <div class="status" {@attach tip(active?.cwd)}>
        {#if active && activeState}
          <TerminalStatusIcon tab={active} />
          <span class="name">{terminalTitle(active)}</span>
          {#if active.cwd}<span class="meta cwd">{shortPath(active.cwd)}</span>{/if}
          <span class="meta state {activeState.tone}">{activeState.text}</span>
          {#if active.sandboxTier}<span class="badge" {@attach tip("Sandbox tier")}>{active.sandboxTier}</span>{/if}
        {/if}
      </div>
      <div class="bar-actions">
        <button class="bar-btn" {@attach tip("New terminal", "terminal.new")} aria-label="New terminal" onclick={newTerminal}>
          <Icon name="plus" size={14} />
        </button>
        <button
          class="bar-btn desk-only"
          class:on={splitOn}
          {@attach tip(splitOn ? "Unsplit" : "Split", "terminal.split")}
          aria-label="Split"
          disabled={tabIds.length < 2 && !splitOn}
          onclick={() => server?.toggleTerminalSplit(sessionId)}
        >
          <Icon name="layout-columns" size={14} />
        </button>
        <span class="sep desk-only"></span>
        <button class="bar-btn desk-only" {@attach tip("Find", "terminal.find")} aria-label="Find" disabled={!activeId} onclick={() => activeId && views[activeId]?.openFind()}>
          <Icon name="search" size={14} />
        </button>
        <button class="bar-btn" {@attach tip("Clear")} aria-label="Clear" disabled={!activeId} onclick={() => activeId && views[activeId]?.clear()}>
          <Icon name="clear-all" size={14} />
        </button>
        {#if active?.status === "exited"}
          <button class="bar-btn" {@attach tip("Restart")} aria-label="Restart" onclick={() => restart(active.terminalId)}>
            <Icon name="refresh" size={14} />
          </button>
        {/if}
        <button class="bar-btn danger" {@attach tip("Kill terminal")} aria-label="Kill terminal" disabled={!activeId} onclick={() => activeId && kill(activeId)}>
          <Icon name="trash" size={14} />
        </button>
        <span class="sep"></span>
        <button
          class="bar-btn"
          {@attach tip(app.terminalMaximized ? "Restore panel size" : "Maximize panel", "terminal.maximize")}
          aria-label="Maximize"
          onclick={() => (app.terminalMaximized = !app.terminalMaximized)}
        >
          <Icon name={app.terminalMaximized ? "arrows-minimize" : "maximize"} size={14} />
        </button>
        <button class="bar-btn" {@attach tip("Hide", "terminal.toggle")} aria-label="Hide terminal" onclick={() => server?.toggleTerminal(sessionId)}>
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
    </div>
    <div class="body">
      <div class="panes" class:split={splitOn}>
        {#each tabIds as id (id)}
          {@const isSplit = splitOn && id === splitId}
          <!-- A flat, single-parent list positioned via grid-column (not two separately-nested
               lists): reassigning which pane an id fills is then just a style change, never a
               reparent, so its TerminalView (and live xterm) never remounts. Every terminal in
               the chat mounts as soon as the drawer is open, so switching is instant and a
               background one keeps receiving output. -->
          <div class="pane-slot" class:right={isSplit} style:display={id === activeId || isSplit ? "block" : "none"}>
            <TerminalView bind:this={views[id]} {sessionId} terminalId={id} visible={id === activeId || isSplit} />
          </div>
        {/each}
      </div>
      {#if tabIds.length > 1}
        <ul class="term-list" role="tablist" aria-label="Terminals" aria-orientation="vertical">
          {#each tabIds as id (id)}
            {@const tab = server?.terminalById[id]}
            {#if tab}
              <li
                class="term"
                class:active={id === activeId}
                class:in-split={splitOn && id === splitId}
                class:exited={tab.status === "exited"}
                class:dragging={draggingId === id}
                draggable={renamingId !== id}
                ondragstart={(e) => dragStart(id, e)}
                ondragover={(e) => e.preventDefault()}
                ondrop={(e) => dropOn(id, e)}
                ondragend={() => (draggingId = null)}
              >
                {#if renamingId === id}
                  <div class="term-main">
                    <TerminalStatusIcon {tab} />
                    <input
                      class="rename"
                      bind:value={renameValue}
                      onblur={commitRename}
                      onkeydown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") renamingId = null;
                      }}
                    />
                  </div>
                {:else}
                  {#snippet termCard()}
                    <div class="tip-title">{terminalTitle(tab)}</div>
                    <dl class="tip-rows">
                      <dt>Status</dt><dd>{terminalState(tab).text}</dd>
                      {#if tab.cwd}<dt>Folder</dt><dd>{tab.cwd}</dd>{/if}
                    </dl>
                    {#if splitOn}<div class="tip-dim tip-foot">Alt+click to show it in the split pane</div>{/if}
                  {/snippet}
                  <ContextMenu items={() => menuFor(id)}>
                    <button
                      type="button"
                      class="term-main"
                      role="tab"
                      aria-selected={id === activeId}
                      {@attach tip(termCard, { side: "bottom" })}
                      onclick={(e) => select(id, e)}
                      ondblclick={() => void startRename(id)}
                      onkeydown={(e) => {
                        if (e.key === "F2") void startRename(id);
                        else if (e.key === "Delete") kill(id);
                      }}
                    >
                      <TerminalStatusIcon {tab} />
                      <span class="label">{terminalTitle(tab)}</span>
                      {#if splitOn && id === splitId}<span class="split-mark" {@attach tip("In the split pane")}><Icon name="layout-columns" size={11} /></span>{/if}
                    </button>
                  </ContextMenu>
                  <button type="button" class="term-close" {@attach tip("Kill terminal")} aria-label="Kill terminal" onclick={() => kill(id)}>
                    <Icon name="xmark" size={12} />
                  </button>
                {/if}
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      class:active={app.terminalResizing}
      onpointerdown={startResize}
      onpointermove={onResize}
      onpointerup={stopResize}
      onpointercancel={stopResize}
    ></div>
  {/if}
</div>

<style>
  .terminal-slot {
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid transparent;
    /* Same fill as the chat panel, no blur: this drawer is part of the page, not a surface
       floating over it (see --panel-bg's doc comment in app.css). */
    background: var(--panel-bg);
    transition:
      height calc(0.2s * var(--anim-speed, 1)) ease,
      border-color calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .terminal-slot.open {
    border-top-color: var(--panel-border);
  }
  /* Everything below the chat header, which overlays the panel. */
  .terminal-slot.max {
    height: calc(100% - var(--header-height));
  }
  .terminal-slot.resizing {
    transition: none;
  }

  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 1.9rem;
    padding: 0 0.29rem 0 0.64rem;
    border-bottom: 1px solid var(--panel-border);
    font-size: var(--text-label-size);
  }
  .status {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }
  .status .name {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 2rem;
  }
  .status .meta {
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .status .cwd {
    font-family: var(--code-font-family, monospace);
    flex-shrink: 2;
  }
  .status .state {
    flex-shrink: 3;
  }
  .status .state.info {
    color: var(--info);
  }
  .status .state.danger {
    color: var(--danger);
  }
  .badge {
    flex-shrink: 0;
    padding: 0 0.36rem;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    color: var(--text-dim);
    font-size: 0.68rem;
    line-height: 1.3;
  }

  .bar-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .sep {
    width: 1px;
    height: 0.9rem;
    margin: 0 0.21rem;
    background: var(--panel-border);
  }
  .bar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .bar-btn:hover:not(:disabled) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .bar-btn.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .bar-btn.on {
    color: var(--accent);
  }
  .bar-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .panes {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    min-height: 0;
    min-width: 0;
  }
  .panes.split {
    grid-template-columns: 1fr 1fr;
  }
  .pane-slot {
    grid-column: 1;
    /* Else a split pane earlier in tab order pushes the main one onto a second row. */
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pane-slot.right {
    grid-column: 2;
    border-left: 1px solid var(--panel-border);
  }

  /* VS Code's terminal tabs list: only there with two or more. */
  .term-list {
    flex-shrink: 0;
    width: clamp(8.5rem, 18%, 13rem);
    margin: 0;
    padding: 0.21rem;
    list-style: none;
    overflow-y: auto;
    scrollbar-gutter: stable;
    border-left: 1px solid var(--panel-border);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .term {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    transition: background-color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .term:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .term.active {
    background: var(--sidebar-active);
    color: var(--text);
  }
  .term.in-split {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .term.exited .label {
    opacity: 0.6;
  }
  .term.dragging {
    opacity: 0.45;
  }
  .term-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.29rem 0.43rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    cursor: pointer;
  }
  .term-main .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .split-mark {
    display: flex;
    color: var(--accent);
  }
  .rename {
    flex: 1;
    min-width: 0;
    background: var(--input-bg, transparent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-xs);
    color: var(--text);
    font: inherit;
    padding: 0 0.21rem;
    outline: none;
  }
  .term-close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.14rem;
    height: 1.14rem;
    margin-right: 0.21rem;
    background: transparent;
    border: none;
    border-radius: var(--radius-xs);
    color: inherit;
    cursor: pointer;
    opacity: 0;
  }
  .term:hover .term-close,
  .term-close:focus-visible {
    opacity: 0.7;
  }
  .term-close:hover {
    opacity: 1;
    color: var(--danger);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.36rem;
    padding: 1rem;
    text-align: center;
    color: var(--text-dim);
  }
  .empty-state p {
    margin: 0.29rem 0 0;
    font-size: var(--text-body-size);
    color: var(--text);
  }
  .empty-state span {
    max-width: 22rem;
    font-size: var(--text-label-size);
  }

  .resize-handle {
    position: absolute;
    top: -0.21rem;
    left: 0;
    width: 100%;
    height: 0.43rem;
    cursor: row-resize;
    touch-action: none;
    z-index: 5;
  }
  /* Same centered-indicator idea as RightSidebar.svelte's own handle, just on
     the horizontal axis. */
  .resize-handle::after {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    height: 2px;
    width: 100%;
    transform: translateY(-50%);
    background: transparent;
    transition: background calc(0.1s * var(--anim-speed, 1)) ease;
  }
  .resize-handle:hover::after,
  .resize-handle.active::after {
    background: var(--accent);
  }

  /* Phone: a sheet over the bottom of the chat. */
  @media (max-width: 700px) {
    :global(.panel) .terminal-slot {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 12;
      height: 0;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      box-shadow: none;
      transition:
        height calc(0.2s * var(--anim-speed, 1)) var(--ui-ease),
        transform calc(0.2s * var(--anim-speed, 1)) var(--ui-ease);
    }
    :global(.panel) .terminal-slot.open {
      height: 58% !important;
      padding-bottom: var(--safe-bottom);
      box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
    }
    :global(.panel) .terminal-slot.max {
      height: calc(100% - var(--header-height)) !important;
    }
    .desk-only {
      display: none;
    }
    .bar {
      position: relative;
      height: 2.9rem;
      padding: 0.7rem 0.4rem 0 0.9rem;
      touch-action: none;
    }
    /* The grabber. */
    .bar::before {
      content: "";
      position: absolute;
      top: 0.35rem;
      left: 50%;
      width: 2.4rem;
      height: 4px;
      transform: translateX(-50%);
      border-radius: var(--radius-pill);
      background: color-mix(in srgb, var(--text) 22%, transparent);
    }
    .bar-btn {
      width: 2.3rem;
      height: 2.3rem;
    }
    .status .cwd,
    .status .badge {
      display: none;
    }
    .body {
      flex-direction: column-reverse;
    }
    .term-list {
      width: auto;
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      border-top: 1px solid var(--panel-border);
    }
    .term-list > :global(*) {
      flex-shrink: 0;
    }
  }
</style>

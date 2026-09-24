<script lang="ts">
  // Per-chat multi-tab terminal drawer (SPEC.md §3.1/§3.2 terminal_*), independent per
  // session. `overflow: hidden` + height:0 when closed means the content genuinely isn't
  // reachable, not just moved off-screen.
  //
  // Resizable up to half the panel's height, same clamp(min, ratio%, 50%) trick as
  // RightSidebar.svelte but vertical and without slide-off/collapse-by-drag: this panel
  // already has an explicit open/close toggle (ChatHeader.svelte).
  import { app, TERMINAL_MIN_HEIGHT } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import TerminalView from "./TerminalView.svelte";
  import { terminalAttach, terminalClose } from "../ipc";
  import type { TerminalStatus } from "../types";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const open = $derived(server?.terminalOpenBySession[sessionId] ?? false);
  const tabIds = $derived(server?.terminalsBySession[sessionId] ?? []);
  const activeId = $derived(server?.activeTerminalBySession[sessionId]);
  const splitOn = $derived(server?.terminalSplitBySession[sessionId] ?? false);
  const splitId = $derived(server?.splitTerminalBySession[sessionId]);
  // A brand-new chat's sessionId is minted locally and never told to the server until its
  // first message goes out, so there's no session for a terminal to run in yet.
  const isDraft = $derived(!(server?.messagesBySession[sessionId] ?? []).length);

  // Ids minted by this client via "+ New Tab" send terminal_open on first mount; every
  // other id (from terminal_list, or opened by a peer) sends terminal_attach instead. An id
  // is dropped once its TerminalView has sent terminal_open, since a remount must attach,
  // not re-open (the server rejects a second terminal_open for a live id). Plain Set, not
  // $state: only read at mount.
  const freshIds = new Set<string>();
  let draggingId = $state<string | null>(null);
  let slotEl = $state<HTMLDivElement | null>(null);

  // Spins up a first tab when the drawer opens with nothing running, rather than showing an
  // empty pane with no way back in. Gated on `terminalsListedBySession` so it can't fire
  // before terminal_list confirms nothing's already running, or it'd race a redundant tab.
  $effect(() => {
    if (open && !isDraft && server?.terminalsListedBySession[sessionId] && tabIds.length === 0 && !activeId) newTerminal();
  });

  const sizeVars = $derived(`--term-pct: ${app.terminalHeightRatio * 100}%; --term-min: ${TERMINAL_MIN_HEIGHT}px`);

  function startResize(e: PointerEvent) {
    if (!open) return;
    app.terminalResizing = true;
    document.body.style.cursor = "row-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!app.terminalResizing || !slotEl) return;
    const container = (slotEl.parentElement as HTMLElement).getBoundingClientRect();
    const fromBottom = container.bottom - e.clientY;
    const clamped = Math.min(container.height * 0.5, Math.max(TERMINAL_MIN_HEIGHT, fromBottom));
    app.terminalHeightRatio = Math.min(0.5, Math.max(0, clamped / container.height));
  }
  function stopResize() {
    if (!app.terminalResizing) return;
    app.terminalResizing = false;
    document.body.style.cursor = "";
    app.setTerminalHeightRatio(app.terminalHeightRatio);
  }

  function newTerminal() {
    if (!server || isDraft) return;
    const id = `term-${crypto.randomUUID().slice(0, 8)}`;
    freshIds.add(id);
    server.registerTerminalTab(sessionId, id);
    server.setActiveTerminalTab(sessionId, id);
  }

  /** Alt/Cmd-click a tab while split is on to load it into the split pane
   * instead of the main one. A plain click always targets the main pane. */
  function selectTab(id: string, e: MouseEvent) {
    if (!server) return;
    if (splitOn && (e.altKey || e.metaKey)) server.setSplitTerminalTab(sessionId, id);
    else server.setActiveTerminalTab(sessionId, id);
  }

  function closeTab(id: string, e: MouseEvent) {
    e.stopPropagation();
    const cid = app.activeConnectionId;
    if (cid) terminalClose(cid, sessionId, id);
  }

  function restartTab(id: string, e: MouseEvent) {
    e.stopPropagation();
    const cid = app.activeConnectionId;
    const tab = server?.terminalById[id];
    if (cid && tab) terminalAttach(cid, sessionId, id, tab.cols, tab.rows, true);
  }

  function dragStart(id: string, e: DragEvent) {
    draggingId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  }
  function dragOver(e: DragEvent) {
    e.preventDefault();
  }
  function dropOn(id: string, e: DragEvent) {
    e.preventDefault();
    if (draggingId && draggingId !== id) server?.reorderTerminalTabs(sessionId, draggingId, id);
    draggingId = null;
  }

  function statusLabel(status: TerminalStatus, exitCode?: number) {
    if (status === "exited") return `exited (${exitCode ?? 0})`;
    if (status === "error") return "terminal error";
    if (status === "starting") return "starting…";
    return "running";
  }
</script>

<div class="terminal-slot" class:open class:resizing={app.terminalResizing} style={sizeVars} bind:this={slotEl}>
  {#if open && isDraft}
    <div class="empty-state">
      <Icon name="terminal-2" size={20} />
      <p>Terminal isn't available yet</p>
      <span>This chat hasn't started — send a message first, then open a terminal here.</span>
    </div>
  {:else if open}
    <div class="bar">
      {#if tabIds.length > 1}
        <div class="tabs">
          {#each tabIds as id (id)}
            {@const tab = server?.terminalById[id]}
            {#if tab}
              <div
                class="tab"
                class:active={id === activeId}
                class:split-active={splitOn && id === splitId}
                class:dragging={draggingId === id}
                role="tab"
                tabindex="0"
                aria-selected={id === activeId}
                title="{tab.title || tab.label} — {statusLabel(tab.status, tab.exitCode)}"
                draggable="true"
                onclick={(e) => selectTab(id, e)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectTab(id, e as unknown as MouseEvent);
                  }
                }}
                ondragstart={(e) => dragStart(id, e)}
                ondragover={dragOver}
                ondrop={(e) => dropOn(id, e)}
                ondragend={() => (draggingId = null)}
              >
                <span class="status-dot {tab.status}"></span>
                <span class="label">{tab.title || tab.label}</span>
                {#if tab.status === "exited"}
                  <button class="tab-btn" title="Reopen terminal" onclick={(e) => restartTab(id, e)}>
                    <Icon name="refresh" size={12} />
                  </button>
                {/if}
                <button class="tab-btn" title="Close terminal" onclick={(e) => closeTab(id, e)}>
                  <Icon name="xmark" size={12} />
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
      <div class="bar-actions">
        <button class="bar-btn" title="New terminal" onclick={newTerminal}>
          <Icon name="plus" size={13} />
        </button>
        <button
          class="bar-btn"
          class:active={splitOn}
          title={splitOn ? "Unsplit terminal" : "Split terminal"}
          onclick={() => server?.toggleTerminalSplit(sessionId)}
        >
          <Icon name="layout-columns" size={13} />
        </button>
      </div>
    </div>
    <div class="panes" class:split={splitOn}>
      {#each tabIds as id (id)}
        {@const isSplit = splitOn && id === splitId}
        <!-- A flat, single-parent list positioned via grid-column (not two
             separately-nested lists): reassigning which pane an id fills
             (main/split, via setActiveTerminalTab/setSplitTerminalTab) is
             then just a style change, never a reparent, so the id's
             TerminalView (and its live xterm instance) never remounts. Every
             tab in the session mounts (and attaches/opens) as soon as the
             drawer is open, not just the one(s) currently in a pane, so
             switching tabs is instant and a backgrounded tab keeps
             receiving output while this drawer stays open. -->
        <div class="pane-slot" class:right={isSplit} style:display={id === activeId || isSplit ? "block" : "none"}>
          <TerminalView {sessionId} terminalId={id} fresh={freshIds.has(id)} onopened={() => freshIds.delete(id)} visible={id === activeId || isSplit} />
        </div>
      {/each}
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
    height: clamp(var(--term-min), var(--term-pct), 50%);
    border-top-color: var(--panel-border);
  }
  .terminal-slot.resizing {
    transition: none;
  }

  /* Compact, always-there control row once open: the tab strip itself
     (`.tabs`) is the part that disappears down to nothing with only one
     terminal running (`{#if tabIds.length > 1}` above), not this row. */
  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    gap: var(--space-half);
    min-height: 1.8rem;
    padding: 0.21rem 0.36rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .tabs {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    flex-shrink: 0;
    max-width: 12rem;
    padding: 0.21rem 0.36rem;
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    font-weight: var(--text-label-weight);
    cursor: pointer;
    transition:
      background-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      opacity calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .tab:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .tab.active {
    background: var(--sidebar-active);
    color: var(--text);
  }
  /* The tab currently filling the split pane gets its own accent underline
     so which-tab-is-where reads at a glance once two are on screen at once. */
  .tab.split-active {
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .tab.dragging {
    opacity: 0.45;
  }
  .tab .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
  }
  .status-dot.starting {
    background: var(--warning);
    animation: pulse calc(1s * var(--anim-speed, 1)) ease-in-out infinite;
  }
  .status-dot.exited {
    background: var(--text-dim);
  }
  .status-dot.error {
    background: var(--danger);
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.14rem;
    height: 1.14rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.1s * var(--anim-speed, 1)) ease,
      background-color calc(0.1s * var(--anim-speed, 1)) ease;
  }
  .tab:hover .tab-btn,
  .tab.active .tab-btn {
    opacity: 0.7;
  }
  .tab-btn:hover {
    opacity: 1 !important;
    background: var(--sidebar-hover);
  }

  .bar-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .bar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .bar-btn:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .bar-btn.active {
    color: var(--accent);
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

  .panes {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .panes.split {
    grid-template-columns: 1fr 1fr;
  }
  .pane-slot {
    grid-column: 1;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .pane-slot.right {
    grid-column: 2;
    border-left: 1px solid var(--panel-border);
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
</style>

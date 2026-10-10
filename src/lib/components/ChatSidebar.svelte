<script lang="ts" module>
  import type { SidebarPanel } from "../types";

  export const PANELS: { id: SidebarPanel; label: string; icon: string; hint: string }[] = [
    { id: "browser", label: "Browser", icon: "browser", hint: "Preview a page beside the chat" },
    { id: "snapshots", label: "Snapshots", icon: "history", hint: "Rewind the agent's edits" },
    { id: "diffs", label: "Diffs", icon: "arrows-diff", hint: "Everything changed since the last commit" },
    { id: "subagents", label: "Subagents", icon: "robot", hint: "Follow the agent's helpers" },
    { id: "explorer", label: "Explorer", icon: "files", hint: "Browse and edit project files" },
    { id: "git", label: "Git", icon: "git-branch", hint: "Branch and working tree status" },
  ];
</script>

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Not to be confused with the "split view" feature (ServerState.sidebarSessionId
  // / RightSidebar.svelte), a second independent chat shown side by side.
  //
  // Its first row shares the chat header's band (the chat header stops at this column's
  // edge, ChatPanel.svelte), so the tabs sit level with the window chrome instead of below an
  // empty strip. "Swapped" trades the two columns' roles: tools take the main width and the
  // chat becomes the narrow column on the right (ChatPanel.svelte lays that out).
  import { DropdownMenu } from "bits-ui";
  import { app, CHAT_PROJECT, CHAT_SIDEBAR_MIN_WIDTH, chatSidebarMinCss } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import BrowserPanel from "./sidebar/BrowserPanel.svelte";
  import SnapshotsPanel from "./sidebar/SnapshotsPanel.svelte";
  import DiffsPanel from "./sidebar/DiffsPanel.svelte";
  import ExplorerPanel from "./sidebar/ExplorerPanel.svelte";
  import GitPanel from "./sidebar/GitPanel.svelte";
  import SubagentsPanel from "./sidebar/SubagentsPanel.svelte";
  import EmptyState from "./sidebar/EmptyState.svelte";
  import { agentBrowsers } from "../browserAgent.svelte";

  let {
    sessionId,
    ownsChrome = true,
    sidePanel = false,
    reserveLeft = 0,
  }: { sessionId: string; ownsChrome?: boolean; sidePanel?: boolean; reserveLeft?: number } = $props();

  const server = $derived(app.active);
  const open = $derived(server?.chatSidebarOpenBySession[sessionId] ?? false);
  const swapped = $derived(open && !!server?.chatSidebarSwappedBySession[sessionId]);
  const panel = $derived(server?.chatSidebarPanelBySession[sessionId]);
  const projectPath = $derived(server?.rootOf(sessionId) ?? server?.currentProjectPath ?? null);
  // A chat's scratch directory isn't a repo: its files come first, and git and diffs have nothing to show.
  const isChat = $derived(server?.projectBySession[sessionId] === CHAT_PROJECT);
  const panels = $derived(
    isChat
      ? [
          { ...PANELS.find((p) => p.id === "explorer")!, label: "Files", hint: "What this chat has made, and what you can add" },
          ...PANELS.filter((p) => p.id !== "explorer" && p.id !== "git" && p.id !== "diffs"),
        ]
      : PANELS,
  );
  const current = $derived(panels.find((p) => p.id === panel));

  // Panels stay mounted once opened, per session, so switching tabs *or chats* keeps each
  // chat's own browser pages, open files and unsaved edits. This component outlives session
  // switches (+page.svelte reuses one ChatPanel), so it holds every session's panes and shows
  // only the current one's.
  // ponytail: hidden sessions' panes (webviews included) stay live until the session is gone;
  // evict least-recently-used ones if that ever costs too much memory.
  let visited = $state<Record<string, Partial<Record<SidebarPanel, boolean>>>>({});
  $effect(() => {
    if (panel) (visited[sessionId] ??= {})[panel] = true;
  });
  // A chat whose agent is using the browser gets its pane even while it's off screen.
  $effect(() => {
    // Only chats the next effect keeps, or the two undo each other forever (a deleted chat).
    for (const sid of Object.keys(agentBrowsers)) if (sid in (server?.messagesBySession ?? {})) (visited[sid] ??= {}).browser = true;
  });
  $effect(() => {
    // Drop a deleted chat's panes (forgetSessionState clears its messages entry).
    for (const id of Object.keys(visited)) if (id !== sessionId && !(id in (server?.messagesBySession ?? {}))) delete visited[id];
  });

  const pick = (id: SidebarPanel | undefined) => server?.openSidebarPanel(sessionId, id);

  // Tabs that don't fit the strip go behind a "…" menu; the open one always stays in view. The
  // title only shows when every tab fits with room to spare for it.
  let stripW = $state(0);
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  const shown = $derived.by(() => {
    const fit = Math.floor((stripW + 0.14 * rem()) / (2 * rem())); // .tab width + gap
    if (fit >= panels.length) return panels;
    const list = panels.slice(0, Math.max(1, fit - 1));
    if (current && !list.includes(current)) list[list.length - 1] = current;
    return list;
  });
  const overflow = $derived(panels.filter((p) => !shown.includes(p)));
  const showTitle = $derived(stripW >= (panels.length * 2 + 5) * rem());

  // Whatever floats over this column's top row: the window's (or this chat's own) chrome
  // island on the right, or, once swapped to the left edge, the chat header's left end
  // (reserveLeft: the back/forward/title island), which stays where it was.
  const rowReserve = $derived(
    swapped
      ? `padding-left: calc(${sidePanel ? "var(--header-pad-x)" : app.sidebarCollapsed ? "var(--toggle-reserve-in-panel)" : "var(--chrome-inset-in-panel)"} + ${reserveLeft}px + var(--space-1))`
      : `padding-right: var(${ownsChrome ? "--chrome-reserve" : "--local-island-reserve"})`,
  );

  let slotEl = $state<HTMLDivElement | null>(null);

  // Straight onto the two boxes they size, not as inherited custom properties: changing one of
  // those on the slot would restyle every node of an open tool on each pointermove.
  const pct = $derived(app.chatSidebarWidthRatio * 100);
  const minW = $derived(chatSidebarMinCss(ownsChrome ? "--chrome-reserve" : "--local-island-reserve"));
  const slotW = $derived(`clamp(${minW}, ${pct}%, 50%)`);
  const bodyW = $derived(`clamp(${minW}, ${pct}cqw, 50cqw)`);

  // Measured once per drag: reading layout on every pointermove, right after the last one
  // changed it, forces a synchronous layout per event.
  let dragBox: DOMRect | null = null;
  // The CSS minimum in px, so the stored ratio never sits below what's actually drawn.
  let dragMin = CHAT_SIDEBAR_MIN_WIDTH;
  let tabsEl = $state<HTMLDivElement | null>(null);
  function startResize(e: PointerEvent) {
    if (!open || !slotEl) return;
    dragBox = (slotEl.parentElement as HTMLElement).getBoundingClientRect();
    if (!swapped && tabsEl) {
      const cs = getComputedStyle(tabsEl);
      dragMin = Math.max(CHAT_SIDEBAR_MIN_WIDTH, parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 8 * rem());
    } else dragMin = CHAT_SIDEBAR_MIN_WIDTH;
    app.chatSidebarResizing = true;
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  // The ratio is always the right-hand column's share, so swapped or not the boundary
  // sits the same distance from the right edge and one formula covers both.
  function onResize(e: PointerEvent) {
    if (!app.chatSidebarResizing || !dragBox) return;
    const fromRight = dragBox.right - e.clientX;
    const clamped = Math.min(dragBox.width * 0.5, Math.max(dragMin, fromRight));
    app.chatSidebarWidthRatio = Math.min(0.5, Math.max(0, clamped / dragBox.width));
  }
  function stopResize() {
    if (!app.chatSidebarResizing) return;
    dragBox = null;
    app.chatSidebarResizing = false;
    document.body.style.cursor = "";
    app.setChatSidebarWidthRatio(app.chatSidebarWidthRatio);
  }
</script>

<div
  class="chat-sidebar-slot"
  class:open
  class:swapped
  class:resizing={app.chatSidebarResizing}
  style:width={open && !swapped ? slotW : null}
  bind:this={slotEl}
>
  <div class="chat-sidebar-body" style:width={swapped ? null : bodyW}>
    <div class="tabs" style={rowReserve} bind:this={tabsEl}>
      <div class="tab-strip" role="tablist" bind:clientWidth={stripW}>
        {#if current}
          {#each shown as p (p.id)}
            <button
              type="button"
              role="tab"
              class="tab"
              class:active={p.id === panel}
              aria-selected={p.id === panel}
              {@attach tip(p.label)}
              onclick={() => pick(p.id)}
            >
              <Icon name={p.icon as any} size={14} />
            </button>
          {/each}
          {#if overflow.length}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class="tab" {@attach tip("More tools")}>
                <Icon name="dots" size={14} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="context-menu" align="start" sideOffset={4}>
                  {#each overflow as p (p.id)}
                    <DropdownMenu.Item class="context-menu-item" onSelect={() => pick(p.id)}>
                      <Icon name={p.icon as any} size={13} />
                      <span>{p.label}</span>
                    </DropdownMenu.Item>
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          {/if}
          {#if showTitle}<span class="tab-title">{current.label}</span>{/if}
        {/if}
      </div>
      <button
        type="button"
        class="tab desk-only"
        class:active={swapped}
        {@attach tip(swapped ? "Put the chat back in the middle" : "Give tools the main area, chat on the side")}
        onclick={() => server?.toggleChatSidebarSwapped(sessionId)}
      >
        <Icon name="switch-horizontal" size={14} />
      </button>
      {#if current}
        <button type="button" class="tab" {@attach tip("All tools")} onclick={() => pick(undefined)}>
          <Icon name="layout-grid" size={14} />
        </button>
      {/if}
    </div>
    {#if !current}
      <div class="picker">
        <div class="picker-head">
          <span class="picker-title">Tools</span>
          <span class="picker-sub">Open one beside this chat. They keep their state while you switch.</span>
        </div>
        <div class="grid">
          {#each panels as p (p.id)}
            <button type="button" class="card" onclick={() => pick(p.id)}>
              <span class="card-icon"><Icon name={p.icon as any} size={17} /></span>
              <span class="card-label">{p.label}</span>
              <span class="card-hint">{p.hint}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#each Object.entries(visited) as [sid, seen] (sid)}
      {@const here = sid === sessionId}
      {@const sidProject = server?.rootOf(sid) ?? (here ? projectPath : null)}
      {@const sidPanel = server?.chatSidebarPanelBySession[sid]}
      {@const sidSwapped = !!server?.chatSidebarSwappedBySession[sid]}
      {#each PANELS as p (p.id)}
        {#if seen[p.id]}
          <div class="pane" class:keep-layout={p.id === "browser"} hidden={!here || p.id !== panel}>
            {#if p.id === "browser"}
              <BrowserPanel sessionId={sid} />
            {:else if p.id === "subagents"}
              <SubagentsPanel sessionId={sid} />
            {:else if !sidProject || !server}
              {#if server?.projectBySession[sid] === CHAT_PROJECT}
                <EmptyState icon="folder" title="Nothing here yet" body="Files this chat makes show up here as it works." />
              {:else}
                <EmptyState icon="folder" title="No project yet" body="Pick a project for this chat and its files, changes and history show up here." />
              {/if}
            {:else if p.id === "snapshots"}
              <SnapshotsPanel sessionId={sid} projectPath={sidProject} visible={here && open && p.id === sidPanel} />
            {:else if p.id === "diffs"}
              <DiffsPanel sessionId={sid} projectPath={sidProject} visible={here && open && p.id === sidPanel} />
            {:else if p.id === "explorer"}
              <ExplorerPanel sessionId={sid} projectPath={sidProject} wide={sidSwapped} visible={here && open && p.id === sidPanel} />
            {:else if p.id === "git"}
              <GitPanel sessionId={sid} projectPath={sidProject} visible={here && open && p.id === sidPanel} />
            {/if}
          </div>
        {/if}
      {/each}
    {/each}
  </div>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resize-handle"
      class:active={app.chatSidebarResizing}
      onpointerdown={startResize}
      onpointermove={onResize}
      onpointerup={stopResize}
      onpointercancel={stopResize}
    ></div>
  {/if}
</div>

<style>
  .chat-sidebar-slot {
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    width: 0;
    border-left: 1px solid transparent;
    /* Same fill as the chat panel, no blur; matches TerminalPanel.svelte. */
    background: var(--panel-bg);
    transition:
      width calc(0.2s * var(--anim-speed, 1)) ease,
      border-color calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .chat-sidebar-slot.open {
    border-left-color: var(--panel-border);
  }
  /* Tools on the left taking what the chat column leaves (ChatPanel.svelte sizes that). */
  .chat-sidebar-slot.swapped {
    order: -1;
    flex: 1;
    width: auto;
    border-left: none;
    border-right: 1px solid var(--panel-border);
  }
  .chat-sidebar-slot.resizing {
    transition: none;
  }
  /* Full width from the start and pinned to the right edge, sliding by its own width as the
     slot opens or closes: it moves in step with the slot's edge instead of being squashed,
     like the left sidebar. */
  .chat-sidebar-body {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    font-size: var(--text-body-size);
    transform: translateX(100%);
    transition: transform calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .open .chat-sidebar-body {
    transform: none;
  }
  .swapped .chat-sidebar-body {
    width: 100%;
  }
  .resizing .chat-sidebar-body {
    transition: none;
  }
  /* Exactly the chat header's band, so these line up with the chrome floating over it. */
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.14rem;
    height: var(--header-height);
    padding: 0 var(--space-1);
    border-bottom: 1px solid var(--panel-border);
    flex-shrink: 0;
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .tab-strip {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.14rem;
    overflow: hidden;
  }
  .tabs :global(.tab) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.86rem;
    height: 1.86rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .tabs :global(.tab:hover),
  .tabs :global(.tab[data-state="open"]) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .tab.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .tab-title {
    flex: 1;
    min-width: 0;
    padding-left: var(--space-1);
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .picker-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.21rem;
    text-align: center;
  }
  .picker-title {
    font-size: 1.07rem;
    font-weight: 600;
  }
  .picker-sub {
    max-width: 20rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: var(--space-1);
    width: 100%;
    max-width: 30rem;
    margin: 0 auto;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.21rem;
    padding: 0.79rem;
    text-align: left;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    color: var(--text);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      border-color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .card:hover {
    background: var(--sidebar-hover);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--panel-border));
  }
  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    margin-bottom: 0.21rem;
    border-radius: var(--radius-sm);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .card-label {
    font-weight: 500;
  }
  .card-hint {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.35;
  }
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .pane[hidden] {
    display: none;
  }
  /* A hidden browser keeps its size, so the agent can still aim clicks and pages lay out as
     they would on screen. */
  .pane.keep-layout[hidden] {
    display: flex;
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  }
  /* Chromium still counts content scrolled out of a pane's view (clipped, but above it, under
     the title bar strip) as no-drag, so a scrolled tree or editor made the window ungrabbable
     there. Panes never reach the header band legitimately, so nothing in them opts out. */
  .pane :global(*) {
    -webkit-app-region: none;
  }
  .resize-handle {
    position: absolute;
    top: 0;
    left: -0.21rem;
    width: 0.43rem;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    z-index: 5;
  }
  .swapped .resize-handle {
    left: auto;
    right: -0.21rem;
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

  /* Phone: tools are a page that fades in over the chat (the toggle becomes its back button; so
     does a swipe right). */
  @media (max-width: 700px) {
    .chat-sidebar-slot {
      position: absolute;
      inset: 0;
      z-index: 13;
      width: auto !important;
      border: 0;
      opacity: 0;
      visibility: hidden;
      transition:
        opacity calc(0.18s * var(--anim-speed, 1)) ease,
        visibility 0s linear calc(0.18s * var(--anim-speed, 1));
    }
    .chat-sidebar-slot.open {
      opacity: 1;
      visibility: visible;
      transition-delay: 0s;
    }
    .chat-sidebar-body {
      inset: 0;
      width: 100% !important;
      transform: none;
    }
    .tabs {
      padding-left: var(--toggle-reserve-in-panel) !important;
      padding-right: var(--chrome-reserve) !important;
    }
    .tabs :global(.tab) {
      width: 2.3rem;
      height: 2.3rem;
    }
    .tab-strip {
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab-title,
    .resize-handle,
    .tabs :global(.desk-only) {
      display: none;
    }
  }
</style>

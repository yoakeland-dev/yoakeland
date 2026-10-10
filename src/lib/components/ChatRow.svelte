<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Shared row shape for every sidebar list (Pinned, filter chips,
  // project lists, search results, split pairs); `variant` only changes the
  // meta line and tint.
  import { tick, type Snippet } from "svelte";
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionArchived, setSessionTitle, deleteSession, openInSidePanel, openChatSession, moveChatToProject } from "../ipc";
  import { fileSize, relTime, sessionTitle } from "../format";
  import { CHAT_PROJECT } from "../state.svelte";
  import { STATUS_ICON } from "../liveChats";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ChatCard, { chatActivity } from "./ChatCard.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import { matches } from "../keybinds.svelte";
  import { viewport } from "../viewport.svelte";
  import { swipe, commits } from "../gestures";
import { haptic } from "../haptics";

  let {
    connectionId,
    session: s,
    variant = "default",
    showServer = false,
    kindBadge = false,
    snippet,
    query,
    compact = false,
    actions,
  }: {
    connectionId: ConnectionId;
    session: SessionSummary;
    variant?: "default" | "running" | "attention" | "archived";
    showServer?: boolean;
    /** Marks whether this is a project's chat or a project-less one (search spans both). */
    kindBadge?: boolean;
    /** Search hit from the chat's messages, shown as the meta line. */
    snippet?: string;
    /** Search query, highlighted in the title and snippet. */
    query?: string;
    /** No side-panel/archive hover actions (e.g. inside a split pair). */
    compact?: boolean;
    /** Extra hover actions, rendered before the built-in ones. */
    actions?: Snippet;
  } = $props();

  const server = $derived(app.servers[connectionId]);
  const connected = $derived(server?.connectionStatus === "connected");
  const isCurrent = $derived(connectionId === app.activeConnectionId && s.sessionId === server?.currentSessionId);
  const status = $derived(server?.sessionStatus(s.sessionId) ?? "idle");
  const syncing = $derived(!!server?.syncingSessions[s.sessionId]);
  const archived = $derived(variant === "archived");
  const pinned = $derived(!!server?.pinnedSessions.includes(s.sessionId));
  const unread = $derived(!!server?.isUnread(s));
  const hasDraft = $derived(!!server?.composerDraftBySession[s.sessionId]?.trim());

  const messages = $derived(server?.messagesBySession[s.sessionId] ?? []);

  const activity = $derived(chatActivity(server, s.sessionId));
  const live = $derived(variant === "running" || variant === "attention");
  // Unknown if the turn started on another device before this client saw the chat.
  const startedAt = $derived(
    variant === "running" || variant === "attention" ? messages.findLast((m) => m.role === "user")?.createdAt : undefined,
  );

  const metaLine = $derived(snippet ?? (live ? activity : undefined));
  const trailing = $derived(
    startedAt && server?.activeTurnBySession[s.sessionId] ? relTime(startedAt, app.now) : relTime(s.updatedAt, app.now),
  );

  // Hover card details; $derived is lazy, so these only compute while the card is shown.
  const projectPath = $derived(
    server?.projectBySession[s.sessionId] ??
      Object.entries(server?.sessionsByProject ?? {}).find(([, list]) => list.some((x) => x.sessionId === s.sessionId))?.[0],
  );
  function parts(text: string): { t: string; hit: boolean }[] {
    const q = query?.trim().toLowerCase();
    if (!q) return [{ t: text, hit: false }];
    const out: { t: string; hit: boolean }[] = [];
    const lower = text.toLowerCase();
    let i = 0;
    for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
      if (at > i) out.push({ t: text.slice(i, at), hit: false });
      out.push({ t: text.slice(at, at + q.length), hit: true });
      i = at + q.length;
    }
    if (i < text.length) out.push({ t: text.slice(i), hit: false });
    return out;
  }

  let renaming = $state(false);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  async function startRename() {
    renaming = true;
    renameValue = s.title || "";
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  function commitRename() {
    if (renaming && renameValue.trim() && renameValue.trim() !== s.title) setSessionTitle(connectionId, s.sessionId, renameValue.trim());
    renaming = false;
  }

  function archive() {
    setSessionArchived(connectionId, s.sessionId, true);
    app.toastAction(connectionId, `Archived “${sessionTitle(s)}”`, {
      label: "Undo",
      run: () => setSessionArchived(connectionId, s.sessionId, false),
    });
  }

  function remove() {
    // A project-less chat's files live and die with it; a project's are never touched.
    const chat = server?.projectBySession[s.sessionId] === CHAT_PROJECT;
    const files = chat && s.workspaceBytes ? ` Its workspace (${fileSize(s.workspaceBytes)} of files) is deleted too.` : chat ? " Its workspace is deleted too." : "";
    if (confirm(`Permanently delete "${sessionTitle(s)}"?${files} This can't be undone.`)) deleteSession(connectionId, s.sessionId);
  }

  // Phone: drag a row right to archive it, like swiping a mail away. Shorter drags spring back.
  let dragX = $state<number | null>(null);
  const swipeArchive = $derived(viewport.narrow && !compact && !archived && connected && !renaming);
  const REVEAL = 96;
  const rowSwipe = {
    axis: "x",
    accept: (d: number) => d > 0,
    onMove: (d: number) => (dragX = Math.min(d, REVEAL * 1.6)),
    onEnd: (d: number, v: number) => {
      dragX = null;
      if (commits(d / REVEAL, v, 1) && d > REVEAL * 0.6) (haptic(), archive());
    },
    onCancel: () => (dragX = null),
  } as const;

  const menuItems = $derived<ContextMenuItem[]>([
    { label: "Rename", icon: "pencil", onSelect: startRename },
    { label: pinned ? "Unpin" : "Pin", icon: pinned ? "pinned" : "pin", onSelect: () => server?.togglePin(s.sessionId) },
    ...(archived
      ? []
      : [
          {
            label: "Open in side panel",
            icon: "layout-columns",
            disabled: isCurrent || !server?.canSplitCurrent,
            onSelect: () => openInSidePanel(connectionId, s.sessionId),
          } satisfies ContextMenuItem,
        ]),
    ...(server?.projectBySession[s.sessionId] === CHAT_PROJECT
      ? [
          {
            label: "Move to project…",
            icon: "folder-open",
            disabled: !connected || !server?.recentProjects.length,
            onSelect: () => app.pickProject(connectionId, "Move to", (path) => void moveChatToProject(connectionId, s.sessionId, path)),
          } satisfies ContextMenuItem,
        ]
      : []),
    archived
      ? { label: "Unarchive", icon: "restore", onSelect: () => setSessionArchived(connectionId, s.sessionId, false) }
      : { label: "Archive", icon: "archive", onSelect: archive },
    { label: "Copy session ID", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(s.sessionId) },
    { label: "Delete", icon: "trash", danger: true, onSelect: remove },
  ]);

  // Up/Down walk every row in the sidebar, in DOM order; F2 renames; Delete
  // archives (with undo). Enter/Space are the button's own click.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>("[data-chat-row]")];
      const i = rows.indexOf(e.currentTarget as HTMLElement);
      rows[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else if (matches(e, "chat.rename")) {
      e.preventDefault();
      void startRename();
    } else if (matches(e, "chat.archive") && !archived && connected) {
      e.preventDefault();
      archive();
    }
  }
</script>

{#snippet sessionCard()}
  <ChatCard {connectionId} session={s} />
{/snippet}

<div
  class="row variant-{variant}"
  class:active={isCurrent}
  class:compact
  class:offline={!connected}
  class:has-meta={!!metaLine}
  class:swiping={dragX !== null}
  style:transform={dragX ? `translateX(${dragX}px)` : null}
  style:--swipe="{dragX ?? 0}px"
  {@attach swipeArchive ? swipe(() => rowSwipe) : undefined}
>
  {#if renaming}
    <div class="main">
      <span class="status-icon status-{status}" aria-hidden="true"><Icon name={STATUS_ICON[status]} size={13} /></span>
      <form class="rename-form" onsubmit={(e) => (e.preventDefault(), commitRename())}>
        <input
          class="rename-input"
          bind:this={renameInput}
          bind:value={renameValue}
          onblur={commitRename}
          onkeydown={(e) => {
            if (e.key === "Escape") renaming = false;
          }}
        />
      </form>
    </div>
  {:else}
    <ContextMenu items={menuItems}>
      <button
        type="button"
        class="main"
        data-chat-row
        class:syncing
        aria-disabled={syncing}
        aria-label={`${sessionTitle(s)}, ${syncing ? "syncing" : status}${unread ? ", unread" : ""}`}
        {@attach tip(sessionCard, { side: "right", outside: ".sidebar" })}
        ondblclick={startRename}
        onclick={() => !syncing && openChatSession(connectionId, s.sessionId)}
        onkeydown={onKeydown}
      >
        <span class="status-icon status-{syncing ? 'syncing' : archived ? 'idle' : status}" aria-hidden="true">
          {#if syncing}
            <span class="spin"><Icon name="loader-2" size={13} /></span>
          {:else}
            <Icon name={archived ? "archive" : STATUS_ICON[status]} size={13} />
          {/if}
        </span>
        <span class="text">
          <span class="title-line">
            <span class="label">
              {#each parts(sessionTitle(s)) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
            </span>
            {#if kindBadge}
              {@const chat = server?.projectBySession[s.sessionId] === CHAT_PROJECT}
              <span class="badge" {@attach tip(chat ? "Chat" : "Project chat")}><Icon name={chat ? "message-circle" : "folder"} size={11} /></span>
            {/if}
            {#if hasDraft}<span class="badge" {@attach tip("Unsent draft")}><Icon name="pencil" size={11} /></span>{/if}
            {#if pinned}<span class="badge" {@attach tip("Pinned")}><Icon name="pinned" size={11} /></span>{/if}
            {#if showServer && server && !live}<ServerAvatar name={server.label} seed={server.serverId} size={13} />{/if}
          </span>
          {#if live && projectPath}
            <span class="project-line">
              {#if showServer && server}<ServerAvatar name={server.label} seed={server.serverId} size={11} />{:else}<Icon name={projectPath === CHAT_PROJECT ? "message-circle" : "folder"} size={11} />{/if}
              {projectPath === CHAT_PROJECT ? "Chat" : server?.projectName(projectPath)}
            </span>
          {/if}
          {#if metaLine}
            <span class="meta-line">
              {#each parts(metaLine) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
            </span>
          {/if}
        </span>
      </button>
    </ContextMenu>
  {/if}

  <span class="trail">
    <span class="rest">
      {#if unread}<span class="unread" {@attach tip("New since you last looked")}></span>{/if}
      <span class="time">{trailing}</span>
    </span>
    <span class="hover-actions">
      {#if actions}{@render actions()}{/if}
      {#if !compact}
        {#if !archived && !isCurrent && server?.canSplitCurrent}
          <button class="act" {@attach tip("Open in side panel")} aria-label="Open in side panel" onclick={() => openInSidePanel(connectionId, s.sessionId)}>
            <Icon name="layout-columns" size={13} />
          </button>
        {/if}
        {#if archived}
          <button class="act danger" {@attach tip("Delete")} aria-label="Delete" onclick={remove}><Icon name="trash" size={13} /></button>
          <button class="act" {@attach tip("Unarchive")} aria-label="Unarchive" onclick={() => setSessionArchived(connectionId, s.sessionId, false)}>
            <Icon name="restore" size={13} />
          </button>
        {:else if connected}
          <button class="act" {@attach tip("Archive", "chat.archive")} aria-label="Archive" onclick={archive}><Icon name="archive" size={13} /></button>
        {/if}
      {/if}
    </span>
  </span>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: var(--radius-sm);
    padding-right: 0.25rem;
    border: 1px solid transparent;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .row:hover {
    background: var(--sidebar-hover);
  }
  .row.active {
    background: var(--sidebar-active);
  }
  /* Inside a pair the group paints the background (SplitEntry). */
  .row.compact,
  .row.compact:hover,
  .row.compact.active {
    background: none;
  }
  .row.offline .main {
    opacity: 0.55;
  }
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--sidebar-fg);
    padding: 0.45rem 0.43rem 0.45rem var(--row-indent, 0.71rem);
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 0.8rem;
  }
  .row.has-meta .main {
    align-items: flex-start;
  }
  .row.has-meta .status-icon {
    margin-top: 0.1rem;
  }
  /* The card's own padding already insets these rows; keeps the time column in line. */
  .row.variant-running,
  .row.variant-attention {
    padding-right: 0;
  }
  /* Multi-line rows: time sits on the title line, not the row's middle. */
  .row.has-meta .trail {
    align-self: flex-start;
    margin-top: 0.2rem;
  }
  .row.active .main,
  .row.variant-running .main,
  .row.variant-attention .main {
    color: var(--text);
  }
  /* Styled after the hover card: bold title, dim detail lines. */
  .row.variant-running .label,
  .row.variant-attention .label {
    font-weight: 600;
  }
  .project-line {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    min-width: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
    overflow: hidden;
    white-space: nowrap;
  }
  .project-line > :global(*) {
    flex-shrink: 0;
  }
  .main.syncing {
    cursor: progress;
  }
  .main.syncing .text {
    opacity: 0.55;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    min-width: 0;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-line {
    font-size: 0.72rem;
    color: var(--sidebar-fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .variant-running .meta-line {
    color: var(--text-dim);
  }
  .status-working ~ .text .meta-line {
    color: color-mix(in srgb, var(--accent) 80%, var(--text-dim));
  }
  .variant-attention .meta-line {
    color: var(--warning);
  }
  mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
    border-radius: 2px;
  }
  .badge {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--sidebar-fg-dim);
  }
  .status-icon {
    flex-shrink: 0;
    display: inline-flex;
  }
  .status-icon.status-idle,
  .status-icon.status-syncing {
    color: var(--sidebar-fg-dim);
  }
  .status-icon.status-action {
    color: var(--warning);
  }
  .status-icon.status-finished {
    color: var(--success);
  }
  .status-icon.status-working {
    color: var(--info);
  }
  .status-icon.status-working :global(svg) {
    animation: spin-global calc(1s * var(--icon-slow, 1)) linear infinite;
  }
  .rename-form {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .rename-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
    padding: 0;
    margin: 0;
  }
  /* Time (and unread dot) at rest, actions on hover, same slot. */
  .trail {
    position: relative;
    flex-shrink: 0;
    display: grid;
    align-items: center;
    justify-items: end;
    min-width: 1.5rem;
    height: 1.5rem;
  }
  .rest,
  .hover-actions {
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    gap: 0.29rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .hover-actions {
    opacity: 0;
    pointer-events: none;
  }
  .row:hover .hover-actions,
  .row:focus-within .hover-actions {
    opacity: 1;
    pointer-events: auto;
  }
  /* Faded-out but still stacked above the actions (opacity < 1 makes a layer), so it would eat their clicks. */
  .row:hover .rest,
  .row:focus-within .rest {
    opacity: 0;
    pointer-events: none;
  }
  /* Centered in the same 1.5rem column as the project rows' counts. */
  .time {
    display: flex;
    justify-content: center;
    width: 1.5rem;
    white-space: nowrap;
    font-size: 0.68rem;
    color: var(--sidebar-fg-dim);
    font-variant-numeric: tabular-nums;
  }
  .unread {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
  }
  .act:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .act.danger:hover {
    color: var(--danger);
  }

  @media (max-width: 700px) {
    .main {
      padding-block: 0.95rem;
    }
    .row {
      touch-action: pan-y;
      transition:
        background calc(0.12s * var(--anim-speed, 1)) ease,
        transform calc(0.2s * var(--anim-speed, 1)) var(--ui-ease);
    }
    .row.swiping {
      transition: none;
    }
    /* What the row uncovers as it slides right. */
    .row::before {
      content: "Archive";
      position: absolute;
      top: 0;
      bottom: 0;
      right: 100%;
      width: var(--swipe, 0px);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 0.8rem;
      overflow: hidden;
      white-space: nowrap;
      font-size: var(--text-label-size);
      color: var(--accent);
      background: var(--accent-dim);
      border-radius: var(--radius-sm);
      pointer-events: none;
    }
    /* No hover here: the time stays, and swipe or long-press replace the buttons. */
    .hover-actions {
      display: none;
    }
    .row:hover .rest,
    .row:focus-within .rest {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>

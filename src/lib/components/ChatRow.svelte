<script lang="ts">
  import { askConfirm } from "../confirm.svelte";
  import { tip } from "../tooltip.svelte";
  // Shared row shape for every sidebar list (Pinned, filter chips,
  // project lists, search results, split pairs); `variant` only changes the
  // meta line and tint.
  import { tick, type Snippet } from "svelte";
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionArchived, setSessionTitle, deleteSession, openInSidePanel, openChatSession, moveChatToProject, cancelTurn } from "../ipc";
  import { fileSize, relTime, sessionTitle } from "../format";
  import { CHAT_PROJECT } from "../state.svelte";
  import { STATUS_ICON } from "../liveChats";
  import { IN_FLIGHT } from "../subagents";
  import { dotModeFor } from "../toolMeta";
  import DotMatrix from "./DotMatrix.svelte";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ChatRing from "./ChatRing.svelte";
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
    expanded = false,
    lead = "status",
    compact = false,
    actions,
  }: {
    connectionId: ConnectionId;
    session: SessionSummary;
    variant?: "default" | "running" | "attention" | "ready" | "archived";
    showServer?: boolean;
    /** Marks whether this is a project's chat or a project-less one (search spans both). */
    kindBadge?: boolean;
    /** Search hit from the chat's messages, shown as the meta line. */
    snippet?: string;
    /** Search query, highlighted in the title and snippet. */
    query?: string;
    /** The expanded card look (title, activity, where it lives) on an otherwise quiet row. */
    expanded?: boolean;
    /** What the leading slot says. "status" is the live row's ring/icon (the dashed ring means
     * "idle, but you're still using it"). A filed row has no live status to show, so it carries
     * the most useful thing its surrounding grouping dropped: the server when the project groups
     * span servers, or just a chat glyph when the headers already say where it lives. */
    lead?: "status" | "chat" | "server";
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
  // The lifted tiers (Needs you, Working, Ready) leave their project group, so they carry
  // where they live on a last line, with the server avatar under the status icon.
  // `expanded` gives an inactive project chat the same three-line card in its place.
  const lifted = $derived(expanded || variant === "running" || variant === "attention" || variant === "ready");
  const turnId = $derived(server?.activeTurnBySession[s.sessionId]);
  const canStop = $derived(variant === "running" && !!turnId && connected);
  const stopped = $derived(
    status === "finished" && messages.findLast((m) => m.role === "assistant")?.finish?.finishReason === "cancelled",
  );
  // Unknown if the turn started on another device before this client saw the chat.
  const startedAt = $derived(
    variant === "running" || variant === "attention" ? messages.findLast((m) => m.role === "user")?.createdAt : undefined,
  );
  const askedAt = $derived(variant === "attention" ? server?.pendingAsks.find((a) => a.sessionId === s.sessionId)?.createdAt : undefined);

  // The lifted tiers show this under the title; a running chat uses its current call instead.
  // Expanded inactive rows show the latest activity too, with "Stopped" reserved for the Ready tier.
  const metaLine = $derived(
    snippet ??
      (variant === "attention" || (expanded && variant === "default") ? activity || undefined : variant === "ready" ? (stopped ? "Stopped" : activity) : undefined),
  );
  const trailing = $derived(
    askedAt
      ? relTime(askedAt, app.now)
      : startedAt && server?.activeTurnBySession[s.sessionId]
        ? relTime(startedAt, app.now)
        : relTime(s.updatedAt, app.now),
  );

  // Hover card details; $derived is lazy, so these only compute while the card is shown.
  const projectPath = $derived(
    server?.projectBySession[s.sessionId] ??
      Object.entries(server?.sessionsByProject ?? {}).find(([, list]) => list.some((x) => x.sessionId === s.sessionId))?.[0],
  );
  const statusCls = $derived(lead === "status" ? (syncing ? "syncing" : stopped ? "stopped" : archived ? "idle" : status) : "filed");
  // The agent's own spinner, in the mode of the call in flight (thinking, reading, editing, tools).
  const dotMode = $derived.by(() => {
    const call = messages.findLast((m) => m.role === "assistant")?.toolCalls.findLast((c) => IN_FLIGHT.has(c.status));
    const inner = call?.subagent?.calls.findLast((c) => IN_FLIGHT.has(c.status)) ?? call;
    return inner ? dotModeFor(inner) : "thinking";
  });
  // A running chat's current call is its indicator; the other lifted tiers use the meta line.
  const indicator = $derived(variant === "running" ? activity : metaLine);
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

  async function remove() {
    // A project-less chat's files live and die with it; a project's are never touched.
    const chat = server?.projectBySession[s.sessionId] === CHAT_PROJECT;
    const files = chat && s.workspaceBytes ? ` Its workspace (${fileSize(s.workspaceBytes)} of files) is deleted too.` : chat ? " Its workspace is deleted too." : "";
    if (await askConfirm(`Permanently delete "${sessionTitle(s)}"?${files} This can't be undone.`)) deleteSession(connectionId, s.sessionId);
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

{#snippet titleLine()}
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
    {#if showServer && server && !lifted}<ServerAvatar name={server.label} seed={server.serverId} size={13} />{/if}
  </span>
{/snippet}

<div
  class="row variant-{variant}"
  class:active={isCurrent}
  class:compact
  class:offline={!connected}
  class:has-meta={!!metaLine}
  class:lifted
  class:unread
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
        class:lifted
        data-chat-row
        class:syncing
        aria-disabled={syncing}
        aria-label={`${sessionTitle(s)}, ${syncing ? "syncing" : status}${unread ? ", unread" : ""}`}
        {@attach tip(sessionCard, { side: "right", outside: ".sidebar" })}
        ondblclick={startRename}
        onclick={() => !syncing && openChatSession(connectionId, s.sessionId)}
        onkeydown={onKeydown}
      >
        {#if lifted}
          <span class="card">
            <span class="top">
              {#if showServer && server}<ServerAvatar name={server.label} seed={server.serverId} size={13} />{:else}<Icon name={projectPath === CHAT_PROJECT ? "message-circle" : "folder"} size={13} />{/if}
              <span class="who">{projectPath === CHAT_PROJECT ? "Chat" : projectPath ? server?.projectName(projectPath) : ""}</span>
            </span>
            {@render titleLine()}
            {#if indicator || statusCls !== "idle"}
              <span class="ind">
                <span class="status-icon status-{statusCls}" aria-hidden="true">
                  {#if syncing}
                    <span class="spin"><Icon name="loader-2" size={12} /></span>
                  {:else if stopped}
                    <ChatRing state="stopped" size={12} />
                  {:else if status === "action"}
                    <span class="lamp"></span>
                  {:else if status === "working"}
                    <DotMatrix mode={dotMode} size={13} />
                  {:else if status !== "idle"}
                    <Icon name={STATUS_ICON[status]} size={12} />
                  {/if}
                </span>
                {#if indicator}<span class="ind-text">{#each parts(indicator) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>{/if}
              </span>
            {/if}
          </span>
        {:else}
          <span class="status-icon status-{statusCls}" aria-hidden="true">
            {#if lead === "server" && server}
              <ServerAvatar name={server.label} seed={server.serverId} size={13} />
            {:else if lead === "chat"}
              <Icon name="message-circle" size={13} />
            {:else if syncing}
              <span class="spin"><Icon name="loader-2" size={13} /></span>
            {:else if stopped}
              <ChatRing state="stopped" />
            {:else if archived}
              <Icon name="archive" size={13} />
            {:else if status === "idle"}
              <ChatRing state="quiet" />
            {:else if status === "action"}
              <span class="lamp"></span>
            {:else}
              <Icon name={STATUS_ICON[status]} size={13} />
            {/if}
          </span>
          <span class="text">
            {@render titleLine()}
            {#if metaLine}
              <span class="meta-line">
                {#each parts(metaLine) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
              </span>
            {/if}
          </span>
        {/if}
      </button>
    </ContextMenu>
  {/if}

  <span class="trail">
    <span class="rest"><span class="time">{trailing}</span></span>
    <span class="hover-actions">
      {#if actions}{@render actions()}{/if}
      {#if !compact}
        {#if canStop}
          <button class="act" {@attach tip("Stop")} aria-label={`Stop ${sessionTitle(s)}`} onclick={() => turnId && cancelTurn(connectionId, s.sessionId, turnId)}>
            <ChatRing state="stop" />
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
    /* The same inset on every tier, so a hover button sits as far from the edge as from the top. */
    padding-right: 0.29rem;
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
    padding: var(--row-pad-y, 0.45rem) 0.43rem var(--row-pad-y, 0.45rem) var(--row-indent, 0.71rem);
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: var(--text-label-size);
  }
  .row.has-meta .main {
    align-items: flex-start;
  }
  .row.has-meta .status-icon {
    margin-top: 0.1rem;
  }
  /* Unread: a faint wash instead of a dot, dimmer than hover so hover still reads over it. */
  .row.unread {
    background: var(--wash-1);
  }
  .row.unread:hover {
    background: var(--sidebar-hover);
  }
  .row.unread.active {
    background: var(--sidebar-active);
  }
  .row.unread .label {
    font-weight: 600;
    color: var(--text);
  }
  .row.compact.unread {
    background: none;
  }
  .row.active .main {
    color: var(--text);
  }
  /* The three live tiers and expanded rows: project on top, title, what it's doing, 
     Colour stays in the status glyph; every line of text is neutral. */
  .main.lifted {
    align-items: stretch;
    --row-pad-y: 0.55rem;
    padding-bottom: 0.3rem;
  }
  .row.lifted .main {
    color: var(--text);
  }
  .card {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
    /* Clear of the time / hover actions pinned to the card's top right. */
    padding-right: 2.2rem;
    font-size: 0.79rem;
    color: var(--text-dim);
  }
  .top > :global(svg),
  .top > :global(span:first-child) {
    flex-shrink: 0;
  }
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.lifted .label {
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .ind {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    line-height: 1.4;
    color: var(--text-dim);
  }
  .ind-text {
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .variant-attention .ind-text {
    color: var(--text);
  }
  /* The card's time and hover actions sit on its top line, not the middle of its height. */
  .row.lifted .trail {
    position: absolute;
    top: 0.45rem;
    right: 0.5rem;
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
    font-size: 0.79rem;
    color: var(--sidebar-fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .status-icon.status-filed,
  .status-icon.status-syncing {
    color: var(--sidebar-fg-dim);
  }
  .status-icon.status-action {
    color: var(--lamp);
  }
  .status-icon.status-finished {
    color: var(--success);
  }
  .status-icon.status-working,
  .status-icon.status-stopped {
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
    gap: 0.14rem;
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
    min-width: 1.5rem;
    white-space: nowrap;
    font-size: var(--text-label-size);
    color: var(--sidebar-fg-dim);
    font-variant-numeric: tabular-nums;
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
      color: var(--accent-ink);
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

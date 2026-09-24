<script lang="ts">
  // Shared row shape for every sidebar list (Needs you, Running, Pinned,
  // project lists, search results, split pairs); `variant` only changes the
  // meta line and tint.
  import { tick, type Snippet } from "svelte";
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionArchived, setSessionTitle, deleteSession, openInSidePanel, openChatSession } from "../ipc";
  import { relTime, sessionTitle } from "../format";
  import { activityFor } from "../toolMeta";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";

  let {
    connectionId,
    session: s,
    variant = "default",
    showServer = false,
    snippet,
    query,
    compact = false,
    actions,
  }: {
    connectionId: ConnectionId;
    session: SessionSummary;
    variant?: "default" | "running" | "attention" | "archived";
    showServer?: boolean;
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

  const STATUS_ICON = {
    working: "loader-2",
    action: "alert-circle",
    finished: "circle-check",
    idle: "message-circle",
  } as const;

  const messages = $derived(server?.messagesBySession[s.sessionId] ?? []);

  const activity = $derived.by(() => {
    const ask = server?.pendingAsks.find((a) => a.sessionId === s.sessionId);
    if (ask) return ask.kind === "question" ? ask.question : ask.description || "Needs your approval";
    const last = messages.findLast((m) => m.role === "assistant");
    const lastTool = last?.toolCalls[last.toolCalls.length - 1];
    return lastTool && lastTool.status !== "done" ? activityFor(lastTool) : lastTool ? "Writing…" : "Thinking…";
  });
  // Unknown if the turn started on another device before this client saw the chat.
  const startedAt = $derived(
    variant === "running" || variant === "attention" ? messages.findLast((m) => m.role === "user")?.createdAt : undefined,
  );

  const metaLine = $derived(
    snippet ?? (variant === "running" || variant === "attention" ? activity : undefined),
  );
  const trailing = $derived(
    startedAt && server?.activeTurnBySession[s.sessionId] ? relTime(startedAt, app.now) : relTime(s.updatedAt, app.now),
  );

  const preview = $derived.by(() => {
    const last = messages.findLast((m) => m.text.trim());
    const line = last?.text.trim().split("\n")[0].slice(0, 140);
    const model = server?.modelBySession[s.sessionId] ?? messages.findLast((m) => m.model)?.model;
    return [sessionTitle(s), line, model && `Model: ${model}`, syncing && "Syncing with the server…"]
      .filter(Boolean)
      .join("\n");
  });

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
    if (confirm(`Permanently delete "${sessionTitle(s)}"? This can't be undone.`)) deleteSession(connectionId, s.sessionId);
  }

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
    } else if (e.key === "F2") {
      e.preventDefault();
      void startRename();
    } else if (e.key === "Delete" && !archived && connected) {
      e.preventDefault();
      archive();
    }
  }
</script>

<div
  class="row variant-{variant}"
  class:active={isCurrent}
  class:offline={!connected}
  class:has-meta={!!metaLine}
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
        title={preview}
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
            {#if hasDraft}<span class="badge" title="Unsent draft"><Icon name="pencil" size={11} /></span>{/if}
            {#if pinned}<span class="badge" title="Pinned"><Icon name="pinned" size={11} /></span>{/if}
            {#if showServer && server}<ServerAvatar name={server.label} seed={server.serverId} size={13} />{/if}
          </span>
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
      {#if unread}<span class="unread" title="New since you last looked"></span>{/if}
      <span class="time">{trailing}</span>
    </span>
    <span class="hover-actions">
      {#if actions}{@render actions()}{/if}
      {#if !compact}
        {#if !archived && !isCurrent && server?.canSplitCurrent}
          <button class="act" title="Open in side panel" aria-label="Open in side panel" onclick={() => openInSidePanel(connectionId, s.sessionId)}>
            <Icon name="layout-columns" size={13} />
          </button>
        {/if}
        {#if archived}
          <button class="act danger" title="Delete" aria-label="Delete" onclick={remove}><Icon name="trash" size={13} /></button>
          <button class="act" title="Unarchive" aria-label="Unarchive" onclick={() => setSessionArchived(connectionId, s.sessionId, false)}>
            <Icon name="restore" size={13} />
          </button>
        {:else if connected}
          <button class="act" title="Archive (Delete)" aria-label="Archive" onclick={archive}><Icon name="archive" size={13} /></button>
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
  .row.variant-running {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .row.variant-running:hover {
    background: color-mix(in srgb, var(--accent) 13%, transparent);
  }
  .row.variant-attention {
    background: color-mix(in srgb, var(--warning) 10%, transparent);
    border-color: color-mix(in srgb, var(--warning) 30%, transparent);
  }
  .row.variant-attention:hover {
    background: color-mix(in srgb, var(--warning) 16%, transparent);
  }
  .row.variant-running.active,
  .row.variant-attention.active {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
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
  .row.active .main,
  .row.variant-running .main,
  .row.variant-attention .main {
    color: var(--text);
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
    animation: spin-global calc(1s * var(--anim-speed, 1)) linear infinite;
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
  .row:hover .rest,
  .row:focus-within .rest {
    opacity: 0;
  }
  .time {
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
    border-radius: var(--radius-sm);
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
</style>

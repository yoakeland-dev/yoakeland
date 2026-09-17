<script lang="ts">
  import { slide } from "svelte/transition";
  import { tick } from "svelte";
  import { app } from "../state.svelte";
  import { setSessionArchived, setSessionTitle, deleteSession, openInSidePanel, openChatSession } from "../ipc";
  import { relTime, basename } from "../format";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import SplitEntry from "./SplitEntry.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";

  let {
    projectPath,
    sessions,
    archived,
  }: { projectPath: string; sessions: SessionSummary[]; archived: boolean } =
    $props();

  // Native <details> can't be smoothly animated — a plain toggle + {#if}
  // lets the open/close use the same slide transition as the sidebar itself.
  // Starts expanded for every project, not just the current one — collapsing
  // is something the user does per project, not a default the sidebar picks.
  let open = $state(true);

  const slideDuration = $derived(
    app.settings.animationSpeed === 0
      ? 0
      : Math.round(180 / app.settings.animationSpeed),
  );

  const statusIcon = {
    working: "loader-2",
    action: "alert-circle",
    finished: "circle-check",
    idle: "message-circle",
  } as const;

  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);

  async function startRename(s: SessionSummary) {
    renamingId = s.sessionId;
    renameValue = s.title || "";
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  function commitRename() {
    if (renamingId && renameValue.trim())
      setSessionTitle(renamingId, renameValue.trim());
    renamingId = null;
  }

  function menuItems(s: SessionSummary): ContextMenuItem[] {
    const isCurrent = s.sessionId === app.currentSessionId;
    return [
      { label: "Rename", icon: "pencil", onSelect: () => startRename(s) },
      ...(archived
        ? []
        : [
            {
              label: "Open in side panel",
              icon: "layout-columns",
              disabled: isCurrent,
              onSelect: () => openInSidePanel(s.sessionId),
            } satisfies ContextMenuItem,
          ]),
      {
        label: archived ? "Unarchive" : "Archive",
        icon: archived ? "restore" : "archive",
        onSelect: () => setSessionArchived(s.sessionId, !archived),
      },
      {
        label: "Copy session ID",
        icon: "copy",
        onSelect: () => void navigator.clipboard?.writeText(s.sessionId),
      },
      {
        label: "Delete",
        icon: "trash",
        danger: true,
        onSelect: () => {
          if (confirm(`Permanently delete "${s.title || s.sessionId}"? This can't be undone.`)) {
            deleteSession(s.sessionId);
          }
        },
      },
    ];
  }
</script>

<div class="group">
  <button class="summary" onclick={() => (open = !open)}>
    <span class="chevron" class:open
      ><Icon name="chevron-right" size={12} /></span
    >
    <span class="name">{basename(projectPath)}</span>
    <span class="divider"></span>
    <span class="count">{sessions.length}</span>
  </button>
  {#if open}
    <div class="rows" class:refreshing={app.refreshingProjects[projectPath]} transition:slide={{ duration: slideDuration }}>
      {#each sessions as s (s.sessionId)}
        {@const paired = app.splitPartnerFor(s.sessionId)}
        {#if paired}
          <SplitEntry primary={s} secondary={paired} />
        {:else}
          <div class="chat-row" class:active={s.sessionId === app.currentSessionId}>
            {#if renamingId === s.sessionId}
              <div class="chat-item">
                <span class="status-icon status-{app.sessionStatus(s.sessionId)}" aria-hidden="true">
                  <Icon name={archived ? "archive" : statusIcon[app.sessionStatus(s.sessionId)]} size={13} />
                </span>
                <form
                  class="rename-form"
                  onsubmit={(e) => (e.preventDefault(), commitRename())}
                >
                  <input
                    class="rename-input"
                    bind:this={renameInput}
                    bind:value={renameValue}
                    onclick={(e) => e.stopPropagation()}
                    onblur={commitRename}
                    onkeydown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") renamingId = null;
                    }}
                  />
                </form>
              </div>
            {:else}
              <ContextMenu items={menuItems(s)}>
                <button
                  type="button"
                  class="chat-item"
                  class:syncing={app.syncingSessions[s.sessionId]}
                  disabled={app.syncingSessions[s.sessionId]}
                  aria-label={`${s.title || s.sessionId}, ${app.syncingSessions[s.sessionId] ? "syncing" : app.sessionStatus(s.sessionId)}`}
                  ondblclick={() => startRename(s)}
                  onclick={() => openChatSession(s.sessionId)}
                >
                  <span class="status-icon status-{app.sessionStatus(s.sessionId)}" aria-hidden="true">
                    <Icon name={statusIcon[app.sessionStatus(s.sessionId)]} size={13} />
                  </span>
                  <span class="label">{s.title || s.sessionId}</span>
                </button>
              </ContextMenu>
            {/if}
            {#if !archived && s.sessionId !== app.currentSessionId}
              <button
                class="side-panel-btn"
                title="Open in side panel"
                aria-label="Open in side panel"
                onclick={() => openInSidePanel(s.sessionId)}
              >
                <Icon name="layout-columns" size={13} />
              </button>
            {/if}
            {#if archived}
              <button
                class="delete-btn"
                title="Delete"
                aria-label="Delete"
                onclick={() => {
                  if (confirm(`Permanently delete "${s.title || s.sessionId}"? This can't be undone.`)) {
                    deleteSession(s.sessionId);
                  }
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            {/if}
            <span class="meta-slot">
              <span class="meta">{relTime(s.updatedAt)}</span>
              <button
                class="archive"
                title={archived ? "Unarchive" : "Archive"}
                aria-label={archived ? "Unarchive" : "Archive"}
                onclick={() => setSessionArchived(s.sessionId, !archived)}
              >
                <Icon name={archived ? "restore" : "archive"} size={13} />
              </button>
            </span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .group {
    margin: 0.14rem 0;
  }
  .summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.43rem 0.57rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--sidebar-fg-dim);
    background: none;
    border: none;
    text-align: left;
    user-select: none;
  }
  .summary:hover {
    background: var(--sidebar-hover);
  }
  .chevron {
    display: inline-flex;
    flex-shrink: 0;
    transition: transform calc(0.15s * var(--anim-speed, 1));
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .name {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .divider {
    flex: 1;
    min-width: 0.71rem;
    height: 1px;
    margin: 0 0.5rem;
    background: var(--panel-border);
  }
  .count {
    flex-shrink: 0;
    font-size: 0.68rem;
    color: var(--sidebar-fg-dim);
    opacity: 0.7;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    padding-left: var(--space-half);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .rows.refreshing {
    opacity: 0.55;
  }
  .chat-row {
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: var(--radius-sm);
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .chat-row:hover {
    background: var(--sidebar-hover);
  }
  .chat-row.active {
    background: var(--sidebar-active);
  }
  .chat-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    color: var(--sidebar-fg);
    padding: 0.5rem 0.71rem;
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 0.8rem;
    min-width: 0;
  }
  .chat-row.active .chat-item {
    color: var(--text);
  }
  .chat-item.syncing {
    opacity: 0.5;
    cursor: default;
  }
  .meta-slot {
    position: relative;
    flex-shrink: 0;
    width: 1.9rem;
    height: 1.6rem;
    margin-right: 0.36rem;
  }
  .archive,
  .meta {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .archive {
    background: none;
    border: none;
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0;
  }
  .chat-row:hover .archive {
    opacity: 1;
  }
  .chat-row:hover .meta {
    opacity: 0;
  }
  .archive:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .side-panel-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .chat-row:hover .side-panel-btn {
    opacity: 1;
  }
  .side-panel-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .delete-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .chat-row:hover .delete-btn {
    opacity: 1;
  }
  .delete-btn:hover {
    color: var(--danger, #ff6b6b);
    background: var(--sidebar-hover);
  }
  .status-icon {
    flex-shrink: 0;
    display: inline-flex;
  }
  .status-icon.status-idle {
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
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
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
    font-size: 0.8rem;
    padding: 0;
    margin: 0;
  }
  .meta {
    font-size: 0.68rem;
    color: var(--sidebar-fg-dim);
    pointer-events: none;
  }
</style>

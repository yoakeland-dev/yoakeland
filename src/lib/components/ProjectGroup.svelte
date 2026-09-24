<script lang="ts">
  import { slide } from "svelte/transition";
  import { tick } from "svelte";
  import { revealItemInDir } from "../platform";
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionArchived, removeProject } from "../ipc";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ChatRow from "./ChatRow.svelte";
  import SplitEntry from "./SplitEntry.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";

  let {
    connectionId,
    projectPath,
    sessions,
    archived,
    onNewChat,
  }: {
    connectionId: ConnectionId;
    projectPath: string;
    sessions: SessionSummary[];
    archived: boolean;
    onNewChat?: () => void;
  } = $props();

  let server = $derived(app.servers[connectionId]);
  const connected = $derived(server?.connectionStatus === "connected");
  const projectName = $derived(server?.projectName(projectPath) ?? projectPath);

  // Remembered per server and project (ServerState.collapsedProjects).
  const open = $derived(!server?.collapsedProjects[projectPath]);
  const toggle = () => server?.setProjectCollapsed(projectPath, open);

  // Unsent drafts don't count — they're hidden from the list too.
  const hasAnyChat = $derived(
    (server?.sessionsByProject[projectPath] ?? []).some(
      (s) => s.messageCount > 0 || (server?.messagesBySession[s.sessionId]?.length ?? 0) > 0,
    ),
  );

  const slideDuration = $derived(Math.round(180 * app.settings.animationSpeed));

  let renaming = $state(false);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  async function startRename() {
    renaming = true;
    renameValue = projectName;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  function commitRename() {
    if (renaming) server?.setProjectLabel(projectPath, renameValue);
    renaming = false;
  }

  function archiveOlder() {
    const cutoff = Date.now() - app.settings.autoArchiveDays * 86400000;
    const old = sessions.filter((s) => new Date(s.updatedAt).getTime() < cutoff);
    if (!old.length || !confirm(`Archive ${old.length} chat${old.length === 1 ? "" : "s"} in ${projectName}?`)) return;
    for (const s of old) setSessionArchived(connectionId, s.sessionId, true);
  }

  const menuItems = $derived<ContextMenuItem[]>([
    ...(onNewChat ? [{ label: "New chat", icon: "message-circle-plus", disabled: !connected, onSelect: onNewChat }] : []),
    { label: open ? "Collapse" : "Expand", icon: open ? "chevron-up" : "chevron-down", onSelect: toggle },
    { label: "Rename…", icon: "pencil", onSelect: startRename },
    server?.connectionMode === "local"
      ? { label: "Reveal in file manager", icon: "folder-open", onSelect: () => void revealItemInDir(projectPath) }
      : { label: "Copy path", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(projectPath) },
    ...(archived
      ? []
      : [
          {
            label: `Archive chats older than ${app.settings.autoArchiveDays}d`,
            icon: "archive",
            disabled: !connected,
            onSelect: archiveOlder,
          },
        ]),
    {
      label: "Remove from list",
      icon: "trash",
      danger: true,
      disabled: !connected,
      onSelect: () => {
        if (!confirm(`Remove ${projectName} from ${server?.label}? Its files aren't touched.`)) return;
        server?.forgetProject(projectPath);
        removeProject(connectionId, projectPath);
      },
    },
  ]);
</script>

<div class="group">
  <ContextMenu items={menuItems}>
    {#if renaming}
      <form class="summary" onsubmit={(e) => (e.preventDefault(), commitRename())}>
        <span class="lead"><Icon name="folder" size={13} /></span>
        <input
          class="rename-input"
          bind:this={renameInput}
          bind:value={renameValue}
          placeholder={projectPath.split("/").pop()}
          onblur={commitRename}
          onkeydown={(e) => {
            if (e.key === "Escape") renaming = false;
          }}
        />
      </form>
    {:else}
      <button class="summary" onclick={toggle} title={projectPath} aria-expanded={open}>
        <span class="lead">
          <span class="face icon-face"><Icon name="folder" size={13} /></span>
          <span class="face chevron-face" class:open><Icon name="chevron-right" size={12} /></span>
        </span>
        <span class="name">{projectName}</span>
        <span class="divider"></span>
        {#if server?.refreshingProjects[projectPath]}
          <span class="spin" title="Refreshing chats…"><Icon name="loader-2" size={11} /></span>
        {/if}
        <span class="count-slot">
          <span class="count">{sessions.length}</span>
          {#if onNewChat && connected}
            <span
              role="button"
              tabindex="0"
              class="new-chat-btn"
              title="New chat"
              aria-label={`New chat in ${projectName}`}
              onclick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onNewChat();
                }
              }}
            >
              <Icon name="message-circle-plus" size={13} />
            </span>
          {/if}
        </span>
      </button>
    {/if}
  </ContextMenu>
  {#if open}
    <div class="rows" transition:slide={{ duration: slideDuration }}>
      <!-- Only when the project really has none — its chats may just be
           shown higher up (Needs you / Running / Pinned). -->
      {#if sessions.length === 0 && !hasAnyChat}
        <p class="empty">
          No chats yet{#if onNewChat && connected}&nbsp;
            — <button class="link" onclick={onNewChat}>start one</button>{/if}
        </p>
      {/if}
      {#each sessions as s (s.sessionId)}
        {@const paired = server?.splitPartnerFor(s.sessionId) ?? null}
        {#if paired}
          <SplitEntry primary={s} secondary={paired} {connectionId} />
        {:else}
          <ChatRow {connectionId} session={s} variant={archived ? "archived" : "default"} />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .group {
    margin: 0.25rem 0;
  }
  .summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.24rem 0.26rem 0.24rem calc(0.57rem + var(--project-indent, 0rem));
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--sidebar-fg-dim);
    background: none;
    border: none;
    text-align: left;
    user-select: none;
    min-height: 1.95rem;
  }
  .summary:hover {
    background: var(--sidebar-hover);
  }
  .lead {
    position: relative;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .face {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chevron-face,
  .summary:hover .icon-face,
  .summary:focus-visible .icon-face {
    opacity: 0;
  }
  .summary:hover .chevron-face,
  .summary:focus-visible .chevron-face {
    opacity: 1;
  }
  .chevron-face.open {
    transform: rotate(90deg);
  }
  .name {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  }
  .divider {
    flex: 1;
    min-width: 0.71rem;
    height: 1px;
    margin: 0 0.5rem;
    background: var(--panel-border);
  }
  .count-slot {
    position: relative;
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
  }
  .count {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.68rem;
    opacity: 0.7;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .summary:hover .count-slot:has(.new-chat-btn) .count {
    opacity: 0;
  }
  .new-chat-btn {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    opacity: 0;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .summary:hover .new-chat-btn {
    opacity: 1;
  }
  .new-chat-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .empty {
    margin: 0;
    padding: 0.36rem 0.71rem 0.36rem calc(var(--row-indent) + 1.3rem);
    font-size: 0.72rem;
    color: var(--sidebar-fg-dim);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .rows {
    --row-indent: calc(1.28rem + var(--project-indent, 0rem));
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
</style>

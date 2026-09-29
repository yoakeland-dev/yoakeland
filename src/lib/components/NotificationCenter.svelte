<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // §3.2 notification: dismissing here dismisses for every device on that
  // server (echoes notification_dismissed to all its peers).
  import { Popover } from "bits-ui";
  import { app, type ConnectionId } from "../state.svelte";
  import { dismissNotification, openNotificationTarget } from "../ipc";
  import type { ServerNotification } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  const servers = $derived(Object.values(app.servers));
  const multiServer = $derived(servers.length > 1);
  const items = $derived(
    servers
      .flatMap((s) => s.notifications.map((n) => ({ ...n, cid: s.connectionId as ConnectionId })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  // §3.2 pending_asks. Not dismissable: they go away when answered.
  const asks = $derived(
    servers.flatMap((s) => s.pendingAsks.map((a) => ({ ...a, cid: s.connectionId as ConnectionId }))),
  );
  function askTitle(a: (typeof asks)[number]): string {
    const summary = app.servers[a.cid]?.sessionById.get(a.sessionId);
    return summary?.title || "Untitled chat";
  }
  const unseen = $derived(servers.reduce((sum, s) => sum + s.unseenNotifications, 0));

  $effect(() => {
    if (app.notificationsOpen) for (const s of servers) s.unseenNotifications = 0;
  });

  const ICONS = { info: "bell", success: "circle-check", warning: "warning", error: "alert-circle" } as const;

  function when(iso: string): string {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString();
  }

  function open(n: ServerNotification & { cid: ConnectionId }) {
    if (!n.sessionId) return;
    openNotificationTarget(n.cid, n);
    app.notificationsOpen = false;
  }
  function clearAll() {
    for (const s of servers) if (s.notifications.length) dismissNotification(s.connectionId);
  }
</script>

{#snippet from(cid: ConnectionId)}
  {#if multiServer && app.servers[cid]}<ServerAvatar name={app.servers[cid].label} seed={app.servers[cid].serverId} size={12} />{/if}
{/snippet}

<Popover.Root bind:open={app.notificationsOpen}>
  <Popover.Trigger class="sb-trigger" {@attach tip("Notifications", "notifications.open")} aria-label="Notifications">
    <Icon name={items.length || asks.length ? "bell-filled" : "bell"} size={13} />
    {#if unseen || asks.length}<span class="badge" class:ask={asks.length > 0}>{unseen + asks.length}</span>{/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="sb-panel notif-panel" side="top" align="end" sideOffset={8}>
      <ul>
        {#each asks as a (a.cid + a.toolCallId)}
          <li class="level-warning">
            <button type="button" class="body clickable" onclick={() => open({ ...a, id: a.toolCallId, level: "warning", kind: "ask", title: "", createdAt: a.createdAt ?? "" })}>
              <span class="lead"><Icon name="alert-circle" size={14} /></span>
              <span class="text">
                <span class="title">{askTitle(a)} needs you</span>
                <span class="detail">{@render from(a.cid)}<span class="clip">{a.kind === "question" ? a.question : a.description}</span></span>
              </span>
              {#if a.createdAt}<span class="time">{when(a.createdAt)}</span>{/if}
            </button>
          </li>
        {/each}
        {#each items as n (n.cid + n.id)}
          <li class="level-{n.level}">
            <button type="button" class="body" class:clickable={!!n.sessionId} onclick={() => open(n)}>
              <span class="lead"><Icon name={ICONS[n.level] ?? "bell"} size={14} /></span>
              <span class="text">
                <span class="title">{n.title}</span>
                {#if n.body || multiServer}<span class="detail">{@render from(n.cid)}<span class="clip">{n.body ?? app.servers[n.cid]?.label}</span></span>{/if}
              </span>
              <span class="time">{when(n.createdAt)}</span>
            </button>
            <button type="button" class="x" {@attach tip("Dismiss")} onclick={() => dismissNotification(n.cid, n.id)}>
              <Icon name="xmark" size={12} />
            </button>
          </li>
        {:else}
          {#if !asks.length}<li class="empty">No notifications</li>{/if}
        {/each}
      </ul>
      <div class="sb-foot">
        <span class="sb-foot-title">Notifications</span>
        {#if items.length > 1}
          <button type="button" class="sb-foot-btn" onclick={clearAll}>
            <Icon name="trash" size={11} /> Clear all
          </button>
        {/if}
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .badge {
    position: absolute;
    top: -0.29rem;
    right: -0.29rem;
    min-width: 0.93rem;
    padding: 0 0.21rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: #0d1020;
    font-size: 0.64rem;
    line-height: 0.93rem;
    text-align: center;
  }
  .badge.ask {
    background: var(--warning);
  }
  :global(.notif-panel) {
    width: min(23rem, 92vw);
    max-height: 50vh;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0.29rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    position: relative;
    display: flex;
    align-items: flex-start;
    border-radius: var(--radius-sm);
  }
  li:hover {
    background: var(--sidebar-hover);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 0.71rem;
    align-items: flex-start;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    padding: 0.57rem 0.64rem;
    cursor: default;
  }
  .body.clickable {
    cursor: pointer;
  }
  .lead {
    display: flex;
    padding-top: 0.14rem;
    color: var(--text-dim);
  }
  .level-success .lead {
    color: var(--success);
  }
  .level-warning .lead {
    color: var(--warning);
  }
  .level-error .lead {
    color: var(--danger);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.21rem;
  }
  .title {
    font-size: 0.8rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    min-width: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    flex-shrink: 0;
    padding-top: 0.07rem;
  }
  /* Sits over the timestamp on hover, like the other popups' row actions. */
  .x {
    position: absolute;
    top: 0.43rem;
    right: 0.43rem;
    display: flex;
    padding: 0.29rem;
    background: linear-gradient(var(--sidebar-hover), var(--sidebar-hover)), var(--panel-bg);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
  }
  li:hover .x,
  .x:focus-visible {
    opacity: 1;
  }
  .x:hover {
    color: var(--danger);
  }
  .empty {
    padding: 0.71rem;
    justify-content: center;
    color: var(--text-dim);
    font-size: 0.82rem;
  }
</style>

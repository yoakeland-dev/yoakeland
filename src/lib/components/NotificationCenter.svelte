<script lang="ts">
  // §3.2 notification: dismissing here dismisses for every device on that
  // server (echoes notification_dismissed to all its peers).
  import { Popover } from "bits-ui";
  import { app, type ConnectionId } from "../state.svelte";
  import { dismissNotification, openNotificationTarget } from "../ipc";
  import type { ServerNotification } from "../types";
  import { markOverflow } from "../overflow";
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

  const ICONS = { success: "circle-check", warning: "warning", error: "alert-circle" } as const;

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

<Popover.Root bind:open={app.notificationsOpen}>
  <Popover.Trigger class="sb-trigger" title="Notifications" aria-label="Notifications">
    <Icon name={items.length || asks.length ? "bell-filled" : "bell"} size={13} />
    {#if unseen || asks.length}<span class="badge" class:ask={asks.length > 0}>{unseen + asks.length}</span>{/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="sb-panel notif-panel" side="top" align="end" sideOffset={8}>
      <ul use:markOverflow>
        {#each asks as a (a.cid + a.toolCallId)}
          <li class="level-warning">
            <button type="button" class="body clickable" onclick={() => open({ ...a, id: a.toolCallId, level: "warning", kind: "ask", title: "", createdAt: a.createdAt ?? "" })}>
              {#if multiServer && app.servers[a.cid]}
                <ServerAvatar name={app.servers[a.cid].label} seed={app.servers[a.cid].serverId} size={14} />
              {/if}
              <Icon name="alert-circle" size={14} />
              <span class="text">
                <span class="title">{askTitle(a)} needs you</span>
                <span class="detail">{a.kind === "question" ? a.question : a.description}</span>
              </span>
              {#if a.createdAt}<span class="time">{when(a.createdAt)}</span>{/if}
            </button>
          </li>
        {/each}
        {#each items as n (n.cid + n.id)}
          <li class="level-{n.level}">
            <button type="button" class="body" class:clickable={!!n.sessionId} onclick={() => open(n)}>
              {#if multiServer && app.servers[n.cid]}
                <ServerAvatar name={app.servers[n.cid].label} seed={app.servers[n.cid].serverId} size={14} />
              {/if}
              <!-- Info (peer joined/left…) is the default; an icon only marks the rest. -->
              {#if n.level !== "info"}<Icon name={ICONS[n.level] ?? "bell"} size={14} />{/if}
              <span class="text">
                <span class="title">{n.title}</span>
                {#if n.body}<span class="detail">{n.body}</span>{/if}
              </span>
              <span class="time">{when(n.createdAt)}</span>
            </button>
            <button type="button" class="x" title="Dismiss" onclick={() => dismissNotification(n.cid, n.id)}>
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
    width: min(20rem, 92vw);
    max-height: 50vh;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0.21rem;
    overflow-y: auto;
  }
  /* Room for the scrollbar while there is one, so it can't sit on the
     dismiss buttons where the browser draws it over content. */
  ul:global([data-overflow]) {
    padding-right: calc(0.21rem + var(--scrollbar-size));
  }
  li {
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
    gap: 0.57rem;
    align-items: flex-start;
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 0.36rem 0.43rem;
    cursor: default;
  }
  .body.clickable {
    cursor: pointer;
  }
  .level-success .body :global(.icon) {
    color: var(--success);
  }
  .level-warning .body :global(.icon) {
    color: var(--warning);
  }
  .level-error .body :global(.icon) {
    color: var(--danger);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .title {
    font-size: 0.8rem;
  }
  .detail {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
  }
  .time {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .x {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.36rem 0.36rem;
    cursor: pointer;
  }
  .empty {
    padding: 0.71rem;
    justify-content: center;
    color: var(--text-dim);
    font-size: 0.82rem;
  }
</style>

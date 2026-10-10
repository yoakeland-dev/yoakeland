<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // §3.2 notification: dismissing here dismisses for every device on that server (echoes
  // notification_dismissed to all its peers), and so does reading (notifications_read).
  import { untrack } from "svelte";
  import { Popover } from "bits-ui";
  import { app, ASK_KINDS, type ConnectionId } from "../state.svelte";
  import { dismissNotification, markNotificationsRead, openNotificationTarget, setNotifyPrefs } from "../ipc";
  import { DEFAULT_NOTIFY_PREFS, kindLabel } from "../notifyKinds";
  import type { ServerNotification } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  type Item = ServerNotification & { cid: ConnectionId };

  const servers = $derived(Object.values(app.servers));
  const multiServer = $derived(servers.length > 1);
  // Pending asks are listed below from the ask list itself; their notification mirrors only exist
  // to raise a toast / OS alert.
  const items = $derived(
    servers
      .flatMap((s) => s.notifications.filter((n) => !ASK_KINDS.has(n.kind)).map((n) => ({ ...n, cid: s.connectionId as ConnectionId })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  // One block per chat (per server), the one with the newest entry first.
  const groups = $derived.by(() => {
    const by = new Map<string, { key: string; cid: ConnectionId; sessionId: string; items: Item[] }>();
    for (const n of items) {
      const key = `${n.cid}|${n.sessionId ?? ""}`;
      const g = by.get(key) ?? by.set(key, { key, cid: n.cid, sessionId: n.sessionId ?? "", items: [] }).get(key)!;
      g.items.push(n);
    }
    return [...by.values()];
  });
  function groupTitle(g: { cid: ConnectionId; sessionId: string }): string {
    if (!g.sessionId) return multiServer ? (app.servers[g.cid]?.label ?? "Server") : "Server";
    return app.servers[g.cid]?.sessionById.get(g.sessionId)?.title || "Untitled chat";
  }
  // §3.2 pending_asks. Not dismissable: they go away when answered.
  const asks = $derived(
    servers.flatMap((s) => s.pendingAsks.map((a) => ({ ...a, cid: s.connectionId as ConnectionId }))),
  );
  function askTitle(a: (typeof asks)[number]): string {
    const summary = app.servers[a.cid]?.sessionById.get(a.sessionId);
    return summary?.title || "Untitled chat";
  }
  const unread = $derived(servers.reduce((sum, s) => sum + s.unreadNotifications, 0));

  // Looking at the list is reading it: mark everything read when it closes, so what was new still
  // shows as new while it's open.
  let wasOpen = false;
  $effect(() => {
    const open = app.notificationsOpen;
    if (wasOpen && !open) {
      untrack(() => {
        for (const s of servers) {
          const ids = s.notifications.filter((n) => !n.read).map((n) => n.id);
          if (ids.length) markNotificationsRead(s.connectionId, ids);
        }
      });
    }
    wasOpen = open;
  });

  const ICONS = { info: "bell", success: "circle-check", warning: "warning", error: "alert-circle" } as const;

  function when(iso: string): string {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString();
  }

  function open(n: { cid: ConnectionId; sessionId?: string; projectPath?: string }) {
    if (!n.sessionId) return;
    openNotificationTarget(n.cid, n);
    app.notificationsOpen = false;
  }
  function clearAll() {
    for (const s of servers) if (s.notifications.length) dismissNotification(s.connectionId);
  }
  /** Stops this kind of notification for good (Settings > Notifications turns it back on). */
  function mute(n: Item) {
    const server = app.servers[n.cid];
    if (!server) return;
    const prefs = server.notifyPrefs ?? DEFAULT_NOTIFY_PREFS;
    if (!prefs.muted.includes(n.kind)) setNotifyPrefs(n.cid, { ...prefs, muted: [...prefs.muted, n.kind] });
    for (const o of items) if (o.cid === n.cid && o.kind === n.kind) dismissNotification(n.cid, o.id);
  }
</script>

{#snippet from(cid: ConnectionId)}
  {#if multiServer && app.servers[cid]}<ServerAvatar name={app.servers[cid].label} seed={app.servers[cid].serverId} size={12} />{/if}
{/snippet}

<Popover.Root bind:open={app.notificationsOpen}>
  <Popover.Trigger class="sb-trigger" {@attach tip("Notifications", "notifications.open")} aria-label="Notifications">
    <Icon name={items.length || asks.length ? "bell-filled" : "bell"} size={13} />
    {#if unread || asks.length}<span class="badge" class:ask={asks.length > 0}>{unread + asks.length}</span>{/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="sb-panel notif-panel" side="top" align="end" sideOffset={8}>
      <ul>
        {#each asks as a (a.cid + a.toolCallId)}
          <li class="level-warning">
            <button type="button" class="body clickable" onclick={() => open(a)}>
              <span class="lead"><Icon name="alert-circle" size={14} /></span>
              <span class="text">
                <span class="title">{askTitle(a)} needs you</span>
                <span class="detail">{@render from(a.cid)}<span class="clip">{a.kind === "question" ? a.question : a.description}</span></span>
              </span>
              {#if a.createdAt}<span class="time">{when(a.createdAt)}</span>{/if}
            </button>
          </li>
        {/each}
        {#each groups as g (g.key)}
          <li class="group">
            <button type="button" class="group-head" class:clickable={!!g.sessionId} onclick={() => open({ cid: g.cid, sessionId: g.sessionId, projectPath: g.items[0]?.projectPath })}>
              {@render from(g.cid)}<span class="clip">{groupTitle(g)}</span>
            </button>
          </li>
          {#each g.items as n (n.id)}
            <li class="level-{n.level}" class:unread={!n.read}>
              <button type="button" class="body" class:clickable={!!n.sessionId} onclick={() => open(n)}>
                <span class="lead"><Icon name={ICONS[n.level] ?? "bell"} size={14} /></span>
                <span class="text">
                  <span class="title">{n.title}{#if (n.count ?? 1) > 1}<span class="count">×{n.count}</span>{/if}</span>
                  {#if n.body}<span class="detail"><span class="clip">{n.body}</span></span>{/if}
                </span>
                <span class="time">{when(n.createdAt)}</span>
              </button>
              <span class="row-actions">
                <button type="button" class="x" {@attach tip(`Stop “${kindLabel(n.kind)}” notifications`)} aria-label="Mute this kind" onclick={() => mute(n)}>
                  <Icon name="bell-off" size={12} />
                </button>
                <button type="button" class="x" {@attach tip("Dismiss")} aria-label="Dismiss" onclick={() => dismissNotification(n.cid, n.id)}>
                  <Icon name="xmark" size={12} />
                </button>
              </span>
            </li>
          {/each}
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
    scrollbar-width: none;
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
  /* Sit over the timestamp on hover, like the other popups' row actions. */
  .row-actions {
    position: absolute;
    top: 0.43rem;
    right: 0.43rem;
    display: flex;
    gap: 2px;
    opacity: 0;
  }
  .x {
    display: flex;
    padding: 0.29rem;
    background: linear-gradient(var(--sidebar-hover), var(--sidebar-hover)), var(--panel-bg);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  li:hover .row-actions,
  .row-actions:focus-within {
    opacity: 1;
  }
  .x:hover {
    color: var(--danger);
  }
  .group {
    padding: 0.36rem 0.64rem 0.14rem;
    background: none !important;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    font-weight: 600;
    cursor: default;
  }
  .group-head.clickable {
    cursor: pointer;
  }
  .group-head.clickable:hover {
    color: var(--text);
  }
  li.unread .title {
    font-weight: 600;
  }
  li.unread .lead::after {
    content: "";
    width: 0.36rem;
    height: 0.36rem;
    margin-left: 0.21rem;
    align-self: center;
    border-radius: 50%;
    background: var(--accent);
  }
  .count {
    margin-left: 0.36rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .empty {
    padding: 0.71rem;
    justify-content: center;
    color: var(--text-dim);
    font-size: 0.82rem;
  }
</style>

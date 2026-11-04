<script lang="ts">
  import { askLine } from "$lib/chatBrief";
  import PopoverContent from "./PopoverContent.svelte";
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
  import SwipeRow from "./SwipeRow.svelte";
  import { viewport } from "../viewport.svelte";
  import { swipe, ownsHorizontalDrag } from "../gestures";

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

  // On a phone the bell opens a full-screen page instead of the popover. It is moved to <body> (a
  // transformed ancestor, like a screen in a stack, would otherwise become its containing block) and
  // slides in from the right; swiping right, or Back, slides it out again.
  const DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";
  const OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
  const spd = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--anim-speed")) || 1;
  let pageEl = $state<HTMLElement>();
  let mounted = $state(false);
  let scrolled = $state(false);
  let closing: Animation | undefined;
  function page(el: HTMLElement) {
    document.body.appendChild(el);
    pageEl = el;
    el.animate({ transform: ["translateX(100%)", "none"] }, { duration: 340 * spd(), easing: DRAWER });
    return () => {
      el.remove();
      if (pageEl === el) pageEl = undefined;
    };
  }
  $effect(() => {
    if (!viewport.narrow) return;
    if (app.notificationsOpen) {
      closing?.cancel();
      closing = undefined;
      mounted = true;
      return;
    }
    const el = untrack(() => pageEl);
    if (!el) return void (mounted = false);
    const from = el.style.transform || "none";
    el.style.transform = "";
    const a = (closing = el.animate({ transform: [from, "translateX(100%)"] }, { duration: 300 * spd(), easing: DRAWER, fill: "forwards" }));
    a.finished.then(
      () => ((mounted = false), (closing = undefined)),
      () => {},
    );
  });
  const back = {
    axis: "x",
    start: (e: PointerEvent) => !ownsHorizontalDrag(e.target, pageEl),
    accept: (d: number) => d > 0,
    onMove: (d: number) => pageEl && (pageEl.style.transform = `translateX(${Math.max(0, d)}px)`),
    onEnd: (d: number, v: number) => {
      if (d > innerWidth * 0.4 || v > 0.5) return void (app.notificationsOpen = false);
      pageEl?.animate({ transform: [`translateX(${d}px)`, "none"] }, { duration: 300 * spd(), easing: OUT });
      if (pageEl) pageEl.style.transform = "";
    },
    onCancel: () => pageEl && (pageEl.style.transform = ""),
  } as const;
  const lampOf = (level: string) => (level === "warning" ? "warn" : level === "success" ? "ok" : level === "error" ? "bad" : "");
</script>

{#snippet from(cid: ConnectionId)}
  {#if multiServer && app.servers[cid]}<ServerAvatar name={app.servers[cid].label} seed={app.servers[cid].serverId} size={12} />{/if}
{/snippet}

{#if viewport.narrow}
  <button type="button" class="sb-trigger" aria-label="Notifications" onclick={() => (app.notificationsOpen = !app.notificationsOpen)}>
    <Icon name={items.length || asks.length ? "bell-filled" : "bell"} size={13} />
    {#if unread || asks.length}<span class="badge" class:ask={asks.length > 0}>{unread + asks.length}</span>{/if}
  </button>
  {#if mounted}
    <div class="page" role="dialog" aria-label="Notifications" {@attach page} {@attach swipe(() => back)}>
      <header class="bar" class:scrolled>
        <button type="button" class="ibtn" aria-label="Back" onclick={() => (app.notificationsOpen = false)}><Icon name="chevron-left" size={24} /></button>
        <h1>Notifications</h1>
        {#if items.length}<button type="button" class="txt" onclick={clearAll}>Clear all</button>{/if}
      </header>
      <div class="sc" onscroll={(e) => (scrolled = e.currentTarget.scrollTop > 4)}>
        {#if asks.length}
          <h2>Needs you<em>{asks.length}</em></h2>
          {#each asks as a (a.cid + a.toolCallId)}
            <div class="plain">
              <button type="button" class="row unread" onclick={() => open(a)}>
                <span class="lp warn" aria-hidden="true"></span>
                <span class="t"><b>{askTitle(a)} needs you</b><small>{a.kind === "question" ? a.question : askLine(a.description)}</small></span>
                {#if a.createdAt}<time>{when(a.createdAt)}</time>{/if}
              </button>
            </div>
          {/each}
        {/if}
        {#each groups as g (g.key)}
          <h2>
            <button type="button" class="gh" disabled={!g.sessionId} onclick={() => open({ cid: g.cid, sessionId: g.sessionId, projectPath: g.items[0]?.projectPath })}>
              {@render from(g.cid)}{groupTitle(g)}
            </button>
          </h2>
          {#each g.items as n (n.id)}
            <SwipeRow
              actions={[
                { label: "Mute", icon: "bell-off", run: () => mute(n) },
                { label: "Dismiss", icon: "trash", danger: true, run: () => dismissNotification(n.cid, n.id) },
              ]}
            >
              <button type="button" class="row" class:unread={!n.read} onclick={() => open(n)}>
                <span class="lp {lampOf(n.level)}" aria-hidden="true"></span>
                <span class="t"><b>{n.title}{#if (n.count ?? 1) > 1} ×{n.count}{/if}</b>{#if n.body}<small>{n.body}</small>{/if}</span>
                <time>{when(n.createdAt)}</time>
              </button>
            </SwipeRow>
          {/each}
        {:else}
          {#if !asks.length}
            <div class="blank">
              <span class="ring"><Icon name="bell" size={26} /></span>
              <b>All caught up</b>
              <p>Nothing needs you right now.</p>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
{:else}
<Popover.Root bind:open={app.notificationsOpen}>
  <Popover.Trigger class="sb-trigger" {@attach tip("Notifications", "notifications.open")} aria-label="Notifications">
    <Icon name={items.length || asks.length ? "bell-filled" : "bell"} size={13} />
    {#if unread || asks.length}<span class="badge" class:ask={asks.length > 0}>{unread + asks.length}</span>{/if}
  </Popover.Trigger>
  <Popover.Portal>
    <PopoverContent class="sb-panel notif-panel" side="top" align="end" sideOffset={8}>
      <ul>
        {#each asks as a (a.cid + a.toolCallId)}
          <li class="level-warning">
            <button type="button" class="body clickable" onclick={() => open(a)}>
              <span class="lead"><Icon name="alert-circle" size={14} /></span>
              <span class="text">
                <span class="title">{askTitle(a)} needs you</span>
                <span class="detail">{@render from(a.cid)}<span class="clip">{a.kind === "question" ? a.question : askLine(a.description)}</span></span>
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
    </PopoverContent>
  </Popover.Portal>
</Popover.Root>
{/if}

<style>
  .badge {
    position: absolute;
    top: -0.14rem;
    right: 0;
    min-width: 0.93rem;
    padding: 0 0.21rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: #0d1020;
    font-size: 0.71rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 0.93rem;
    text-align: center;
  }
  .badge.ask {
    background: var(--lamp);
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

  /* The phone's page. */
  .page {
    position: fixed;
    inset: 0;
    z-index: 130;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top, 0px);
    background: var(--bg);
    color: var(--text);
    touch-action: pan-y;
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.3);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 54px;
    padding: 5px 6px;
    border-bottom: 1px solid transparent;
    transition: border-color calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .bar.scrolled {
    border-bottom-color: var(--wash-2);
  }
  .bar h1 {
    flex: 1;
    margin: 0;
    font-size: 16px;
    font-weight: 650;
  }
  .ibtn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text);
    transition:
      background-color calc(0.12s * var(--anim-speed, 1)) ease,
      transform calc(0.16s * var(--anim-speed, 1)) ease-out;
  }
  .ibtn:active {
    background: var(--wash-3);
    transform: scale(0.94);
  }
  .txt {
    height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent-ink);
    font: inherit;
    font-weight: 600;
  }
  .txt:active {
    background: var(--wash-3);
  }
  .sc {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: max(var(--safe-bottom, 0px), 1rem);
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 22px 28px 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  h2 em {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    opacity: 0.8;
  }
  .gh {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .row {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 12px;
    align-items: center;
    width: 100%;
    min-height: 62px;
    padding: 10px 16px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    transition: background-color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .row:active {
    background: var(--wash-2);
  }
  .t {
    min-width: 0;
  }
  .row b,
  .row small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row b {
    font-size: 15.5px;
    font-weight: 500;
  }
  .row.unread b {
    font-weight: 700;
  }
  .row small {
    margin-top: 1px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .row time {
    align-self: start;
    margin-top: 0.2rem;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .lp {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
  }
  .lp::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.5;
  }
  .lp.warn::before {
    background: var(--warning);
    opacity: 1;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 20%, transparent);
  }
  .lp.ok::before {
    background: var(--success);
    opacity: 1;
  }
  .lp.bad::before {
    background: var(--danger);
    opacity: 1;
  }
  .blank {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 18vh 32px 0;
    text-align: center;
    animation: rise calc(0.22s * var(--anim-speed, 1)) cubic-bezier(0.23, 1, 0.32, 1);
  }
  .blank b {
    font-size: 17px;
  }
  .blank p {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.45;
  }
  .ring {
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    margin-bottom: 10px;
    border-radius: 50%;
    background: var(--wash-2);
    color: var(--text-dim);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .blank {
      animation: none;
    }
  }
</style>

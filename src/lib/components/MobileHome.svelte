<script lang="ts">
  // The phone's Home screen: every agent on every server, ordered by what needs you. It owns its own
  // list rather than reusing the desktop sidebar, because the shape is different: one flat list led by
  // state (a status disc, a title, one line of what it is doing), filtered by a few chips, with the
  // one action people come here for (a new chat) under the thumb.
  import { DropdownMenu } from "bits-ui";
  import { app, CHAT_PROJECT, type ConnectionId, type ServerState } from "../state.svelte";
  import { openChatSession, newChat, listSessionsForProjects, browseAndAddProject, setSessionArchived, deleteSession, disconnect } from "../ipc";
  import { relTime, sessionTitle } from "../format";
  import { askConfirm } from "../confirm.svelte";
  import { isDesktop } from "../platform";
  import { isPhotoAvatar } from "../avatar";
  import { awaitingApproval } from "../extensions";
  import { pendingWhatsNew } from "../whatsnew";
  import type { ComponentProps } from "svelte";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import { chatActivity } from "./ChatCard.svelte";
  import MenuContent from "./MenuContent.svelte";
  import AboutDialog from "./AboutDialog.svelte";
  import WhatsNewDialog from "./WhatsNewDialog.svelte";
  import PairPhoneDialog from "./PairPhoneDialog.svelte";
  import NotificationCenter from "./NotificationCenter.svelte";
  import MobileStatus from "./MobileStatus.svelte";
  import SwipeRow from "./SwipeRow.svelte";
  import MobileChips from "./MobileChips.svelte";

  type Status = "action" | "working" | "finished" | "idle";
  interface Row {
    cid: ConnectionId;
    srv: ServerState;
    s: SessionSummary;
    status: Status;
  }

  const serverEntries = $derived(Object.entries(app.servers) as [ConnectionId, ServerState][]);
  const connected = $derived(serverEntries.filter(([, srv]) => srv.connectionStatus === "connected"));

  // A project can become known without a sessions entry yet, so it'd never list. Fetch the moment it is.
  $effect(() => {
    for (const [scid, srv] of serverEntries) {
      if (srv.connectionStatus !== "connected") continue;
      const missing = srv.recentProjects.filter((p) => !(p in srv.sessionsByProject));
      if (missing.length > 0) listSessionsForProjects(scid, missing);
    }
  });

  // A chat created but never sent doesn't exist on the server yet.
  const started = (s: SessionSummary, srv: ServerState) => s.messageCount > 0 || (srv.messagesBySession[s.sessionId] ?? []).length > 0;
  const autoArchiveMs = $derived(app.settings.autoArchiveDays * 86400000);
  const isArchived = (s: SessionSummary) => !!s.archived || app.now - new Date(s.updatedAt).getTime() > autoArchiveMs;
  const byRecent = (a: Row, b: Row) => new Date(b.s.updatedAt).getTime() - new Date(a.s.updatedAt).getTime();

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const [cid, srv] of serverEntries) {
      const seen = new Set<string>();
      for (const project of [...srv.recentProjects, CHAT_PROJECT]) {
        for (const s of srv.sessionsByProject[project] ?? []) {
          if (seen.has(s.sessionId) || !started(s, srv) || srv.hiddenSplitSessionIds.has(s.sessionId) || isArchived(s)) continue;
          seen.add(s.sessionId);
          out.push({ cid, srv, s, status: srv.sessionStatus(s.sessionId) });
        }
      }
      // Asks come from pending_asks, so they include chats this client never listed.
      for (const a of srv.pendingAsks) {
        if (seen.has(a.sessionId) || srv.hiddenSplitSessionIds.has(a.sessionId)) continue;
        seen.add(a.sessionId);
        const s = srv.sessionById.get(a.sessionId) ?? { sessionId: a.sessionId, updatedAt: a.createdAt ?? new Date().toISOString(), messageCount: 1 };
        out.push({ cid, srv, s, status: "action" });
      }
    }
    return out.sort(byRecent);
  });

  type Filter = "all" | "action" | "working";
  let filter = $state<Filter>("all");
  let search = $state("");
  let scrolled = $state(false);
  const count = (st: Status) => rows.filter((r) => r.status === st).length;
  const chipItems = $derived([
    { id: "all" as Filter, label: "All" },
    { id: "action" as Filter, label: "Needs you", n: count("action"), warn: true },
    { id: "working" as Filter, label: "Working", n: count("working") },
  ]);


  const pinnedOf = (r: Row) => r.srv.pinnedSessions.includes(r.s.sessionId);
  const projectName = (r: Row) => {
    const p = r.srv.projectBySession[r.s.sessionId];
    return !p || p === CHAT_PROJECT ? "Chat" : r.srv.projectName(p);
  };

  const sections = $derived.by<{ id: string; label: string; rows: Row[] }[]>(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const hits = rows.filter((r) => sessionTitle(r.s).toLowerCase().includes(q) || projectName(r).toLowerCase().includes(q));
      return hits.length ? [{ id: "results", label: "", rows: hits }] : [];
    }
    if (filter !== "all") return [{ id: filter, label: "", rows: rows.filter((r) => r.status === filter) }];
    const action = rows.filter((r) => r.status === "action");
    const working = rows.filter((r) => r.status === "working");
    const rest = rows.filter((r) => r.status !== "action" && r.status !== "working");
    return [
      { id: "action", label: "Needs you", rows: action },
      { id: "working", label: "Working", rows: working },
      { id: "pinned", label: "Pinned", rows: rest.filter(pinnedOf) },
      { id: "ready", label: "Ready", rows: rest.filter((r) => !pinnedOf(r) && r.status === "finished") },
      { id: "earlier", label: "Earlier", rows: rest.filter((r) => !pinnedOf(r) && r.status === "idle") },
    ].filter((sec) => sec.rows.length);
  });

  function subtitle(r: Row): string {
    return r.status === "idle" ? projectName(r) : `${projectName(r)} · ${chatActivity(r.srv, r.s.sessionId)}`;
  }

  function archive(r: Row) {
    setSessionArchived(r.cid, r.s.sessionId, true);
    app.toastAction(r.cid, `Archived “${sessionTitle(r.s)}”`, { label: "Undo", run: () => setSessionArchived(r.cid, r.s.sessionId, false) });
  }

  function menu(r: Row): ContextMenuItem[] {
    const pinned = pinnedOf(r);
    const live = r.srv.connectionStatus === "connected";
    return [
      { label: pinned ? "Unpin" : "Pin", icon: pinned ? "pinned" : "pin", onSelect: () => r.srv.togglePin(r.s.sessionId) },
      {
        label: "Archive",
        icon: "archive",
        disabled: !live,
        onSelect: () => archive(r),
      },
      { label: "Copy session ID", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(r.s.sessionId) },
      {
        label: "Delete",
        icon: "trash",
        danger: true,
        disabled: !live,
        onSelect: async () => {
          if (await askConfirm(`Permanently delete "${sessionTitle(r.s)}"? This can't be undone.`)) deleteSession(r.cid, r.s.sessionId);
        },
      },
    ];
  }

  // With several projects there is no obvious target, so ask (the palette's "New session in…").
  async function startChat() {
    const target = app.activeConnectionId ?? connected[0]?.[0];
    if (!target) return app.openAddServer();
    if (!serverEntries.some(([, srv]) => srv.recentProjects.length)) {
      const p = await browseAndAddProject(target);
      if (p) void newChat(p.connectionId, p.path);
      return;
    }
    app.openPalette("projects");
  }

  // Profile sheet.
  let menuOpen = $state(false);
  let showAbout = $state(false);
  let showNew = $state(!!pendingWhatsNew(__APP_VERSION__));
  let showPair = $state(false);
  const pairCid = $derived((isDesktop ? connected.find(([, srv]) => srv.connectionMode === "local") : connected.find(([, srv]) => !srv.limited))?.[0]);
  const extWaiting = $derived(awaitingApproval(app.active?.mcpByProject[app.active.currentProjectPath ?? ""]?.servers).length);
  const presence = $derived(
    connected.length === 0 ? "Offline" : connected.length === 1 ? `Online on ${connected[0][1].label}` : `Online on ${connected.length} servers`,
  );
  const openSettings = () => (app.settingsTab = "appearance", (app.showSettings = true));
  const logOut = () => connected.forEach(([scid]) => void disconnect(scid));
</script>

{#snippet ring(name: ComponentProps<typeof Icon>["name"])}<span class="ring"><Icon {name} size={26} /></span>{/snippet}

<div class="home">
  <header class="top" class:scrolled>
    <h1>Agents</h1>
    <span class="bell"><NotificationCenter /></span>
    <DropdownMenu.Root bind:open={menuOpen}>
      <DropdownMenu.Trigger class="avatar-btn" aria-label="Profile and settings">
        <span class="avatar">
          {#if isPhotoAvatar(app.settings.profileAvatar)}<img src={app.settings.profileAvatar} alt="" />{:else}{app.settings.profileAvatar || "🐣"}{/if}
        </span>
        <span class="presence" class:online={connected.length > 0}></span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent class="context-menu user-menu" side="bottom" align="end" sideOffset={6}>
          <div class="who">
            <strong>{app.settings.profileName || "anonymous"}</strong>
            <span>{presence}</span>
          </div>
          <DropdownMenu.Item class="context-menu-item" onSelect={openSettings}><Icon name="settings" size={18} /><span>Settings</span></DropdownMenu.Item>
          <DropdownMenu.Item class="context-menu-item" onSelect={() => (app.showUsage = true)}><Icon name="chart-bar" size={18} /><span>Usage</span></DropdownMenu.Item>
          <DropdownMenu.Item class="context-menu-item" onSelect={() => app.openExtensions()}>
            <Icon name="plug-connected" size={18} /><span>MCP servers and skills</span>
            {#if extWaiting}<span class="count">{extWaiting}</span>{/if}
          </DropdownMenu.Item>
          <DropdownMenu.Item class="context-menu-item" disabled={!pairCid} onSelect={() => (showPair = true)}><Icon name="qrcode" size={18} /><span>Pair a device</span></DropdownMenu.Item>
          <DropdownMenu.Item class="context-menu-item" onSelect={() => (showAbout = true)}><Icon name="info-circle" size={18} /><span>About</span></DropdownMenu.Item>
          <DropdownMenu.Separator class="menu-sep" />
          <DropdownMenu.Item class="context-menu-item danger" disabled={!connected.length} onSelect={logOut}><Icon name="logout" size={18} /><span>Log out</span></DropdownMenu.Item>
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <AboutDialog bind:open={showAbout} onWhatsNew={() => (showNew = true)} />
    <WhatsNewDialog bind:open={showNew} />
    {#if pairCid}<PairPhoneDialog bind:open={showPair} cid={pairCid} />{/if}
  </header>

  <MobileStatus />

  <div class="scroll" onscroll={(e) => (scrolled = e.currentTarget.scrollTop > 4)}>
    <MobileChips items={chipItems} bind:value={filter} />
    {#each sections as sec (sec.id)}
      <section>
        {#if sec.label}<h2>{sec.label}<span class="n">{sec.rows.length}</span></h2>{/if}
        {#each sec.rows as r (r.cid + r.s.sessionId)}
          <SwipeRow actions={[{ label: "Archive", icon: "archive", run: () => archive(r) }]}>
          <ContextMenu items={() => menu(r)}>
            <button class="row {r.status}" onclick={() => openChatSession(r.cid, r.s.sessionId)}>
              <span class="lp {r.status}" aria-hidden="true"></span>
              <span class="text">
                <span class="title">{sessionTitle(r.s)}</span>
                <span class="sub">{subtitle(r)}</span>
              </span>
              <span class="when">{relTime(r.s.updatedAt, app.now)}</span>
            </button>
          </ContextMenu>
          </SwipeRow>
        {/each}
      </section>
    {:else}
      <div class="empty">
        {#if !serverEntries.length}
          {@render ring("server")}
          <h2>No server yet</h2>
          <p>Connect to a yoakeland server to see your agents here.</p>
          <button class="primary" onclick={() => app.openAddServer()}>Add a server</button>
        {:else if search.trim()}
          {@render ring("search")}
          <h2>No match</h2>
          <p>Nothing called “{search.trim()}”.</p>
        {:else if filter !== "all"}
          {@render ring("check")}
          <h2>{filter === "action" ? "All quiet" : "Nothing running"}</h2>
          <p>{filter === "action" ? "Nothing needs you right now." : "Agents show up here while they work."}</p>
        {:else}
          {@render ring("message-circle")}
          <h2>No agents yet</h2>
          <p>Start a chat and it will show up here.</p>
          {#if connected.length}<button class="primary" onclick={startChat}>New chat</button>{/if}
        {/if}
      </div>
    {/each}
    <div class="dock-room"></div>
  </div>

  <!-- What you reach for constantly (find, new) sits under the thumb; the list scrolls behind it. -->
  <div class="dock">
    <div class="bar">
      <div class="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search agents" bind:value={search} enterkeyhint="search" autocapitalize="none" autocorrect="off" aria-label="Search agents" />
        {#if search}<button class="clear" aria-label="Clear search" onclick={() => (search = "")}><Icon name="xmark" size={14} /></button>{/if}
      </div>
      {#if connected.length}
        <button class="fab" aria-label="New chat" onclick={startChat}><Icon name="plus" size={26} /></button>
      {/if}
    </div>
  </div>
</div>

<style>
  .home {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding: 6px 6px 6px 20px;
    min-height: 58px;
    border-bottom: 1px solid transparent;
    transition: border-color calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .top.scrolled {
    border-bottom-color: var(--wash-2);
  }
  h1 {
    flex: 1;
  }
  /* The bell is the notification center's own trigger, restyled as a thumb-sized round button. */
  .bell :global(.sb-trigger) {
    width: 2.9rem;
    height: 2.9rem;
    padding: 0;
    justify-content: center;
    border-radius: 50%;
    color: var(--text);
  }
  .bell :global(.sb-trigger:active) {
    background: var(--wash-3);
  }
  .bell :global(.sb-trigger .icon) {
    width: 1.5rem !important;
    height: 1.5rem !important;
  }
  .bell :global(.badge) {
    top: 0.25rem;
    right: 0.1rem;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    font-size: 0.75rem;
    line-height: 1.15rem;
    font-weight: 700;
    box-shadow: 0 0 0 2px var(--bg);
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  /* The profile: a photo or emoji with the connection lamp on its corner. */
  :global(.avatar-btn) {
    position: relative;
    width: 3rem;
    height: 3rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 50%;
    background: var(--wash-3);
    font-size: 1.4rem;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .presence {
    position: absolute;
    right: 0.1rem;
    bottom: 0.1rem;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--text-dim);
    border: 2px solid var(--bg);
  }
  .presence.online {
    background: var(--success);
  }
  .who {
    display: flex;
    flex-direction: column;
    padding: var(--space-1) var(--space-2) var(--space-1);
    gap: 0.1rem;
  }
  .who span {
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .count {
    margin-left: auto;
    padding: 0 0.5rem;
    border-radius: var(--radius-pill);
    background: var(--warning);
    color: #1a1305;
    font-size: var(--text-label-size);
    font-weight: 700;
  }

  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    height: 3.5rem;
    border-radius: var(--radius-pill);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    color: var(--text-dim);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    appearance: none;
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--wash-3);
    color: var(--text-dim);
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 22px 28px 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  h2 .n {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    opacity: 0.8;
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
  /* The lamp: a dim dot at rest, a glowing one when it needs you, a turning ring while it works. */
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
    transition:
      background-color calc(0.2s * var(--anim-speed, 1)) ease,
      box-shadow calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .lp.action::before {
    background: var(--warning);
    opacity: 1;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 20%, transparent);
  }
  .lp.finished::before {
    background: var(--success);
    opacity: 1;
  }
  .lp.working::before {
    width: 14px;
    height: 14px;
    background: none;
    opacity: 1;
    border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent);
    animation: spin calc(1.1s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15.5px;
    font-weight: 500;
  }
  .row.action .title,
  .row.finished .title {
    font-weight: 700;
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--text-dim);
  }
  .when {
    flex-shrink: 0;
    align-self: start;
    margin-top: 0.2rem;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }

  .ring {
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    margin-bottom: 10px;
    border-radius: 50%;
    background: var(--wash-2);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 18vh var(--space-4) 0;
    animation: rise calc(0.22s * var(--anim-speed, 1)) cubic-bezier(0.23, 1, 0.32, 1);
    text-align: center;
    color: var(--text-dim);
  }
  .empty h2 {
    margin: var(--space-1) 0 0;
    font-size: 1.2rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text);
  }
  .empty p {
    margin: 0;
    font-size: 1rem;
    line-height: 1.4;
  }
  .primary {
    margin-top: var(--space-2);
    height: 3.2rem;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--on-accent, #0b0c11);
    font: inherit;
    font-weight: 700;
  }

  .dock-room {
    height: 7.5rem;
  }
  /* The list fades out under the dock instead of being cut by a hard edge. */
  .dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-3) 0 var(--space-2);
    background: linear-gradient(to top, var(--bg) 58%, transparent);
    pointer-events: none;
  }
  .dock > * {
    pointer-events: auto;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
  }
  .fab {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 3.5rem;
    height: 3.5rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent, #0b0c11);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    transition: transform 0.1s var(--ui-ease);
  }
  .fab:active {
    transform: scale(0.96);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lp.working::before,
    .empty {
      animation: none;
    }
  }
</style>

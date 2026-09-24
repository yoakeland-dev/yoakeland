<script lang="ts">
  import { app, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, type ConnectionId, type ServerState } from "../state.svelte";
  import { selectProject, browseAndAddProject, openChatSession, listSessionsForProjects, newChat as newChatIn, disconnect, reconnectServer } from "../ipc";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import { isPhotoAvatar } from "../avatar";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ProjectGroup from "./ProjectGroup.svelte";
  import SplitEntry from "./SplitEntry.svelte";
  import ChatRow from "./ChatRow.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import Dropdown from "./Dropdown.svelte";
  import SearchInput from "./SearchInput.svelte";
  import { DropdownMenu } from "bits-ui";
  import { untrack } from "svelte";
  import { slide } from "svelte/transition";

  const ALL_PROJECTS = "__all__";
  // Key in a server's own collapsedProjects map for its whole section.
  const SERVER_SECTION = "__server__";

  // Dragging past the minimum collapses outright, VS Code-style, instead of
  // just hitting a hard floor — and dragging back out while the pointer is
  // still down re-opens it (see onResize), so overshooting costs nothing.
  // Threshold is generous — a light overshoot while dragging shouldn't
  // accidentally collapse the sidebar.
  const COLLAPSE_THRESHOLD = 90;

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  // Doubles as both "which project new chats default to" (selectProject's
  // existing side effect — opens it, lists its sessions) and "which
  // project's chats the sidebar shows" (projectFilter below). Deliberately
  // NOT re-synced from server.currentProjectPath elsewhere (e.g. opening a
  // session from a different project) — once the user picks "All projects"
  // that choice should stick until they pick something else, not get
  // silently narrowed back down by clicking into an unrelated chat.
  let selectedProjectPath = $state<string>(app.active?.currentProjectPath ?? ALL_PROJECTS);
  $effect(() => {
    if (cid && selectedProjectPath !== ALL_PROJECTS && selectedProjectPath !== server?.currentProjectPath) {
      selectProject(cid, selectedProjectPath);
    }
  });
  const projectFilter = $derived(selectedProjectPath === ALL_PROJECTS ? null : selectedProjectPath);

  // A project can become known (recentProjects) without ever having been
  // opened/selected here — added from Settings > Projects, or pushed by
  // project_list from another connection (§4b) — in which case it has no
  // sessionsByProject entry yet and would otherwise never show a group at
  // all. Fetch it the moment it's known, on every connected server.
  $effect(() => {
    for (const [scid, srv] of Object.entries(app.servers)) {
      if (srv.connectionStatus !== "connected") continue;
      const missing = srv.recentProjects.filter((p) => !(p in srv.sessionsByProject));
      if (missing.length > 0) listSessionsForProjects(scid, missing);
    }
  });

  const serverEntries = $derived(Object.entries(app.servers) as [ConnectionId, ServerState][]);
  const multiServer = $derived(serverEntries.length > 1);
  const connectedServers = $derived(serverEntries.filter(([, srv]) => srv.connectionStatus === "connected"));

  // Projects in the user's dragged order; anything not placed by hand sorts
  // by its most recent chat activity.
  function lastActivity(srv: ServerState, project: string): number {
    let t = 0;
    for (const s of srv.sessionsByProject[project] ?? []) t = Math.max(t, Date.parse(s.updatedAt) || 0);
    return t;
  }
  function orderedProjects(srv: ServerState): string[] {
    const idx = (p: string) => {
      const i = srv.projectOrder.indexOf(p);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...srv.recentProjects].sort((a, b) => idx(a) - idx(b) || lastActivity(srv, b) - lastActivity(srv, a));
  }

  // The project picker: every server's projects, grouped under the server.
  // With several servers, each header is itself selectable — everything on
  // that server. Values are "connectionId::path", "server::connectionId", or
  // ALL_PROJECTS.
  const remoteProjectItems = $derived([
    { value: ALL_PROJECTS, label: "All projects" },
    ...serverEntries.flatMap(([gcid, srv]) => {
      const group = multiServer ? gcid : undefined;
      return [
        ...(multiServer ? [{ value: `server::${gcid}`, label: srv.label, group, header: true }] : []),
        ...orderedProjects(srv).map((p) => ({ value: `${gcid}::${p}`, label: srv.projectName(p), group })),
      ];
    }),
  ]);
  const hasAnyProject = $derived(serverEntries.some(([, srv]) => srv.recentProjects.length > 0));
  let pickerValue = $state<string>(
    app.activeConnectionId && app.active?.currentProjectPath
      ? `${app.activeConnectionId}::${app.active.currentProjectPath}`
      : ALL_PROJECTS,
  );
  // The server the picker narrows to, by a project or by the server itself.
  const pickerCid = $derived(
    pickerValue === ALL_PROJECTS ? null
      : pickerValue.startsWith("server::") ? pickerValue.slice(8)
      : pickerValue.slice(0, pickerValue.indexOf("::")),
  );
  // Narrowed to one server: its list reads as if it were the only one.
  const flat = $derived(!multiServer || !!pickerCid);
  // The picked project's server, shown in the picker's icon slot.
  const pickedServer = $derived(pickerCid ? app.servers[pickerCid] : null);
  // selectedProjectPath/cid -> pickerValue (e.g. a session opened from a
  // different project narrows the underlying selection some other way).
  // A whole-server pick has no project, so "All projects" underneath it
  // leaves it alone.
  $effect(() => {
    if (cid && selectedProjectPath !== ALL_PROJECTS) pickerValue = `${cid}::${selectedProjectPath}`;
    else if (!untrack(() => pickerValue).startsWith("server::")) pickerValue = ALL_PROJECTS;
  });
  // pickerValue -> selectedProjectPath/cid (the user actually picked
  // something) — switches the active connection first when the chosen
  // project belongs to a different one, so the effect above (and the
  // existing selectProject effect) both then act against the right remote.
  $effect(() => {
    if (pickerValue.startsWith("server::")) {
      const newCid = pickerValue.slice(8);
      if (newCid !== app.activeConnectionId) app.activeConnectionId = newCid;
      if (selectedProjectPath !== ALL_PROJECTS) selectedProjectPath = ALL_PROJECTS;
      return;
    }
    if (pickerValue === ALL_PROJECTS) {
      if (selectedProjectPath !== ALL_PROJECTS) selectedProjectPath = ALL_PROJECTS;
      return;
    }
    const sep = pickerValue.indexOf("::");
    if (sep === -1) return;
    const newCid = pickerValue.slice(0, sep);
    const path = pickerValue.slice(sep + 2);
    if (newCid !== app.activeConnectionId) app.activeConnectionId = newCid;
    if (selectedProjectPath !== path) selectedProjectPath = path;
  });

  async function addProject(target: ConnectionId | null) {
    if (!target) return;
    const p = await browseAndAddProject(target);
    if (p) pickerValue = `${p.connectionId}::${p.path}`;
  }

  // New chat goes to the project picked above; with "All projects" there's
  // no obvious one, so ask (the palette's "New session in…" page).
  function newChat() {
    if (pickerCid && selectedProjectPath !== ALL_PROJECTS) void newChatIn(pickerCid, selectedProjectPath);
    else if (!hasAnyProject) void addProject(cid ?? connectedServers[0]?.[0] ?? null);
    else app.openPalette("projects");
  }

  let search = $state("");
  type Chip = "waiting" | "running" | "unread" | "archived";
  let chip = $state<Chip | null>(null);
  const CHIPS: { id: Chip; label: string; icon: string }[] = [
    { id: "waiting", label: "Waiting on you", icon: "alert-circle" },
    { id: "running", label: "Running", icon: "loader-2" },
    { id: "unread", label: "Unread", icon: "bell" },
    { id: "archived", label: "Archived", icon: "archive" },
  ];

  let resizing = $state(false);

  // The slot is what shrinks in the flex layout (0 when collapsed); the
  // panel itself stays at a fixed width and slides off-screen via
  // transform, so its content never squashes/reflows mid-transition.
  const slotWidth = $derived(app.sidebarCollapsed ? 0 : app.sidebarWidth);

  // The width this drag started from, so a drag that ends collapsed can put it
  // back — see stopResize.
  let widthBeforeDrag = 0;
  // True for a brief window right after a drag crosses the collapse
  // threshold, in either direction — just long enough for one eased
  // transition (see the collapse-anim rules below) before reverting to
  // transition:none, or every subsequent pointermove while still dragging
  // would ease instead of track.
  let collapsedByDrag = $state(false);
  let collapseAnimTimer: ReturnType<typeof setTimeout> | undefined;

  function startResize(e: PointerEvent) {
    if (app.sidebarCollapsed) return;
    resizing = true;
    collapsedByDrag = false;
    clearTimeout(collapseAnimTimer);
    widthBeforeDrag = app.sidebarWidth;
    document.body.style.cursor = "col-resize";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (!resizing) return;
    // Dragging past the minimum collapses outright, VS Code-style, instead of
    // just hitting a hard floor — but as a *live preview* rather than a
    // one-shot: the pointer stays captured by the handle (which stays mounted
    // for the whole drag, see below), so dragging back out past the threshold
    // re-opens the sidebar and picks the width up again, all without letting
    // go. Collapsing on the spot was the old behaviour and made the gesture a
    // dead end the moment you overshot.
    const collapsed = e.clientX < SIDEBAR_MIN_WIDTH - COLLAPSE_THRESHOLD;
    if (collapsed !== app.sidebarCollapsed) {
      // Both directions animate — the pointer is still driving the *next*
      // width update, so the eased window has to end itself rather than stay
      // on for the rest of the drag, or later pointermoves would ease behind
      // the pointer instead of tracking it.
      collapsedByDrag = true;
      clearTimeout(collapseAnimTimer);
      const duration = Math.round(200 * (app.settings.animationSpeed || 1)) + 50;
      collapseAnimTimer = setTimeout(() => (collapsedByDrag = false), duration);
      app.setSidebarCollapsed(collapsed);
    }
    if (collapsed) return;
    // The right sidebar's own width is plain CSS (see RightSidebar.svelte),
    // proportional to whatever's left of this sidebar — it reflows on its
    // own the moment `.content-row` resizes, no separate sync needed here.
    app.sidebarWidth = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, e.clientX),
    );
  }
  function stopResize() {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = "";
    // Released while collapsed: the moves above clamped this sidebar down to
    // SIDEBAR_MIN_WIDTH on the way past it, which is fine as live feedback but
    // isn't a width anyone asked to keep — collapsing is "close it", not
    // "make it 180 wide". Put the width this drag started from back (in
    // memory only; storage was never told otherwise) so re-opening the
    // sidebar comes back the size it was.
    if (app.sidebarCollapsed) app.sidebarWidth = widthBeforeDrag;
    else app.setSidebarWidth(app.sidebarWidth);
  }
  const RESIZE_STEP = 20;
  function onResizeKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      app.setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, app.sidebarWidth - RESIZE_STEP));
    } else if (e.key === "ArrowRight") {
      app.setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, app.sidebarWidth + RESIZE_STEP));
    }
  }

  // A session created by `newChat` but never sent doesn't exist on the
  // server yet — hide it from the list until its first message goes out.
  // `messageCount` alone would miss a just-sent local message before the
  // server round-trips a session_updated/list_sessions; the local cache
  // alone would miss any session this client hasn't opened yet — check both.
  function hasMessages(s: SessionSummary, srv: ServerState): boolean {
    return s.messageCount > 0 || (srv.messagesBySession[s.sessionId] ?? []).length > 0;
  }

  const autoArchiveMs = $derived(app.settings.autoArchiveDays * 86400000);
  const isArchived = (s: SessionSummary) => !!s.archived || app.now - new Date(s.updatedAt).getTime() > autoArchiveMs;
  const byRecent = (a: SessionSummary, b: SessionSummary) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  interface Row {
    cid: ConnectionId;
    srv: ServerState;
    s: SessionSummary;
  }
  const key = (r: Row) => `${r.cid}:${r.s.sessionId}`;
  // The picker narrows project lists to one server's project; Needs you,
  // Running and Pinned stay global — they're what you'd otherwise miss.
  const inFilter = (gcid: ConnectionId, project: string) =>
    (!pickerCid || gcid === pickerCid) && (!projectFilter || project === projectFilter);

  // Every chat with a message, on every server. Sessions that are the
  // secondary half of a saved split render under their partner instead
  // (SplitEntry / ServerState.splitPartnerFor), so they're dropped here.
  const allRows = $derived<Row[]>(
    serverEntries.flatMap(([gcid, srv]) =>
      srv.recentProjects.flatMap((project) =>
        (srv.sessionsByProject[project] ?? [])
          .filter((s) => hasMessages(s, srv) && !srv.hiddenSplitSessionIds.has(s.sessionId))
          .map((s) => ({ cid: gcid, srv, s })),
      ),
    ),
  );

  // Chats blocked on a permission ask or a question — top of the list until
  // answered. Comes from the server's pending_asks list, so it includes chats
  // this client never opened; those get a stub summary until listed.
  const needsYou = $derived<Row[]>(
    serverEntries.flatMap(([gcid, srv]) =>
      [...new Set(srv.pendingAsks.map((a) => a.sessionId))]
        .filter((id) => !srv.hiddenSplitSessionIds.has(id))
        .map((id) => ({
          cid: gcid,
          srv,
          s: srv.sessionById.get(id) ?? {
            sessionId: id,
            updatedAt: srv.pendingAsks.find((a) => a.sessionId === id)?.createdAt ?? new Date().toISOString(),
            messageCount: 1,
          },
        })),
    ),
  );
  const needsYouKeys = $derived(new Set(needsYou.map(key)));

  const running = $derived<Row[]>(
    allRows.filter((r) => r.srv.activeTurnBySession[r.s.sessionId] && !needsYouKeys.has(key(r))).sort((a, b) => byRecent(a.s, b.s)),
  );
  const runningKeys = $derived(new Set(running.map(key)));

  // Pinned chats across every server, in the order they were pinned —
  // Ctrl+1–9 jumps to them.
  const pinned = $derived<Row[]>(
    serverEntries.flatMap(([gcid, srv]) =>
      srv.pinnedSessions.flatMap((id) => {
        const s = srv.sessionById.get(id);
        return s && !srv.hiddenSplitSessionIds.has(id) ? [{ cid: gcid, srv, s }] : [];
      }),
    ),
  );
  const pinnedKeys = $derived(new Set(pinned.map(key)));
  const pinnedShown = $derived(pinned.filter((r) => !needsYouKeys.has(key(r)) && !runningKeys.has(key(r))));

  function activeSessions(gcid: ConnectionId, srv: ServerState, project: string): SessionSummary[] {
    return (srv.sessionsByProject[project] ?? [])
      .filter((s) => {
        const k = `${gcid}:${s.sessionId}`;
        return (
          !needsYouKeys.has(k) &&
          !runningKeys.has(k) &&
          !pinnedKeys.has(k) &&
          !isArchived(s) &&
          !srv.hiddenSplitSessionIds.has(s.sessionId) &&
          hasMessages(s, srv)
        );
      })
      .sort(byRecent);
  }

  // One section per server (a plain list with only one), its projects inside.
  const serverSections = $derived(
    serverEntries
      .filter(([gcid]) => !pickerCid || gcid === pickerCid)
      .map(([gcid, srv]) => ({
        cid: gcid,
        srv,
        groups: orderedProjects(srv)
          .filter((p) => inFilter(gcid, p))
          .map((project) => ({ project, sessions: activeSessions(gcid, srv, project) })),
      })),
  );

  const archiveGroups = $derived(
    serverEntries.flatMap(([gcid, srv]) =>
      orderedProjects(srv)
        .filter((p) => inFilter(gcid, p))
        .map((project) => ({
          cid: gcid,
          project,
          sessions: (srv.sessionsByProject[project] ?? [])
            .filter((s) => isArchived(s) && !srv.hiddenSplitSessionIds.has(s.sessionId) && hasMessages(s, srv))
            .sort(byRecent),
        }))
        .filter((g) => g.sessions.length > 0),
    ),
  );

  const unread = $derived(allRows.filter((r) => !isArchived(r.s) && r.srv.isUnread(r.s)).sort((a, b) => byRecent(a.s, b.s)));

  // Search spans every server and project, titles and the cached message
  // text alike, narrowed by the active chip. A body hit gets a snippet line.
  const results = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const pool =
      chip === "waiting" ? needsYou : chip === "running" ? running : chip === "unread" ? unread
        : chip === "archived" ? allRows.filter((r) => isArchived(r.s))
        : allRows;
    const out: (Row & { snippet?: string })[] = [];
    for (const r of pool) {
      if ((r.s.title ?? "").toLowerCase().includes(q) || r.s.sessionId.toLowerCase().includes(q)) {
        out.push(r);
      } else {
        for (const m of r.srv.messagesBySession[r.s.sessionId] ?? []) {
          const at = m.text.toLowerCase().indexOf(q);
          if (at === -1) continue;
          const start = Math.max(0, at - 30);
          const text = m.text.slice(start, at + q.length + 60).replace(/\s+/g, " ");
          out.push({ ...r, snippet: (start > 0 ? "…" : "") + text });
          break;
        }
      }
      if (out.length >= 50) break;
    }
    return out.sort((a, b) => byRecent(a.s, b.s));
  });

  const chipRows = $derived(chip === "waiting" ? needsYou : chip === "running" ? running : chip === "unread" ? unread : []);
  const chipCount = (c: Chip) =>
    c === "waiting" ? needsYou.length : c === "running" ? running.length : c === "unread" ? unread.length : 0;

  const SERVER_STATE = { connecting: "connecting…", disconnected: "reconnecting…", error: "unreachable" } as const;

  // Right-click on a server's heading.
  function serverMenu(gcid: ConnectionId, srv: ServerState): ContextMenuItem[] {
    const open = !srv.collapsedProjects[SERVER_SECTION];
    const status = srv.connectionStatus;
    return [
      { label: "Add project…", icon: "folder-plus", disabled: status !== "connected", onSelect: () => void addProject(gcid) },
      { label: "Focus this server", icon: "filter", onSelect: () => (pickerValue = `server::${gcid}`) },
      { label: open ? "Collapse" : "Expand", icon: open ? "chevron-up" : "chevron-down", onSelect: () => srv.setProjectCollapsed(SERVER_SECTION, open) },
      { label: "Collapse all projects", icon: "chevron-up", onSelect: () => srv.recentProjects.forEach((p) => srv.setProjectCollapsed(p, true)) },
      status === "connected" || status === "connecting"
        ? { label: "Disconnect", icon: "xmark", onSelect: () => void disconnect(gcid) }
        : { label: "Reconnect", icon: "refresh", onSelect: () => void reconnectServer(gcid) },
      { label: "Server settings", icon: "settings", onSelect: () => ((app.settingsTab = "servers"), (app.showSettings = true)) },
    ];
  }

  // Drag a project's header to reorder it within its server.
  let dragging = $state<{ cid: ConnectionId; project: string } | null>(null);
  let dropTarget = $state<string | null>(null);
  let dragArmed = false;
  function dropOn(gcid: ConnectionId, srv: ServerState, target: string) {
    const d = dragging;
    dragging = null;
    dropTarget = null;
    if (!d || d.cid !== gcid || d.project === target) return;
    const order = orderedProjects(srv).filter((p) => p !== d.project);
    order.splice(order.indexOf(target), 0, d.project);
    srv.setProjectOrder(order);
  }

  // Ctrl/Cmd+1–9 opens the nth pinned chat.
  function onWindowKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !/^[1-9]$/.test(e.key)) return;
    const r = pinned[Number(e.key) - 1];
    if (!r) return;
    e.preventDefault();
    openChatSession(r.cid, r.s.sessionId);
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet pickedLead()}
  {#if pickedServer}<ServerAvatar name={pickedServer.label} seed={pickedServer.serverId} size={13} />{/if}
{/snippet}

{#snippet serverGroupHeader(gcid: string)}
  {@const srv = app.servers[gcid]}
  {#if srv}<ServerAvatar name={srv.label} seed={srv.serverId} size={12} /> {srv.label}{/if}
{/snippet}

{#snippet rowFor(r: Row, variant: "default" | "running" | "attention", showServer = multiServer)}
  {@const paired = r.srv.splitPartnerFor(r.s.sessionId) ?? null}
  {#if paired}
    <SplitEntry primary={r.s} secondary={paired} connectionId={r.cid} {variant} />
  {:else}
    <ChatRow connectionId={r.cid} session={r.s} {variant} {showServer} />
  {/if}
{/snippet}

<div class="sidebar-slot" class:resizing class:collapse-anim={collapsedByDrag} style="flex-basis: {slotWidth}px">
  <aside
    class="sidebar"
    class:collapsed={app.sidebarCollapsed}
    style="width: {app.sidebarWidth}px"
  >
    <div class="brand-row" data-tauri-drag-region>
      <img class="brand-logo" src="logo.png" alt="" />
      <span class="brand">yoakeland</span>
    </div>
    <div class="quick-row">
      <SearchInput bind:value={search} placeholder="Search chats…" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="filter-btn{chip ? ' on' : ''}"
          title={chip ? `Showing: ${CHIPS.find((c) => c.id === chip)?.label}` : "Filter chats"}
          aria-label="Filter chats"
        >
          <Icon name="filter" size={15} />
          {#if !chip && needsYou.length}<span class="filter-dot"></span>{/if}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="context-menu" align="end" sideOffset={4}>
            {#each CHIPS as c (c.id)}
              <DropdownMenu.Item class="context-menu-item filter-item" onSelect={() => (chip = chip === c.id ? null : c.id)}>
                <Icon name={c.icon as any} size={13} />
                <span class="filter-label">{c.label}</span>
                {#if chipCount(c.id)}<span class="filter-count" class:warn={c.id === "waiting"}>{chipCount(c.id)}</span>{/if}
                {#if chip === c.id}<Icon name="check" size={12} />{/if}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button
        class="new-chat"
        onclick={newChat}
        title={pickerCid && projectFilter ? `New chat in ${pickedServer?.projectName(projectFilter)}` : "New chat…"}
        aria-label="New chat"
      >
        <Icon name="message-circle-plus" size={16} />
      </button>
    </div>

    <div class="project-row">
      {#if hasAnyProject}
        <Dropdown
          items={remoteProjectItems}
          bind:value={pickerValue}
          placeholder="Select a project…"
          triggerIcon="folder"
          triggerLead={pickedServer && multiServer ? pickedLead : undefined}
          searchable={remoteProjectItems.length > 6}
          searchPlaceholder="Search projects…"
          triggerClass="project-trigger"
          groupHeader={serverGroupHeader}
        >
          {#snippet item({ value, label, selected })}
            {@const path = value.includes("::") && !value.startsWith("server::") ? value.slice(value.indexOf("::") + 2) : undefined}
            {#if value.startsWith("server::")}
              {@const srv = app.servers[value.slice(8)]}
              {#if srv}<ServerAvatar name={srv.label} seed={srv.serverId} size={12} />{/if}
            {/if}
            <span class="dropdown-item-label" title={path}>{label}</span>
            {#if selected}<Icon name="check" size={11} />{/if}
          {/snippet}
        </Dropdown>
      {:else}
        <button class="project-trigger empty-cta" onclick={() => addProject(cid)}>
          <Icon name="folder-plus" size={13} />
          <span>Add your first project</span>
        </button>
      {/if}
      <button
        class="manage-projects"
        title="Add project"
        aria-label="Add project"
        onclick={() => addProject(pickerCid ?? cid)}
      >
        <Icon name="folder-plus" size={14} />
      </button>
    </div>

    <nav class="chat-list">
      {#if chip}
        <div class="section-label filter-head">
          {CHIPS.find((c) => c.id === chip)?.label}
          <button class="clear-filter" title="Clear filter" aria-label="Clear filter" onclick={() => (chip = null)}>
            <Icon name="xmark" size={11} />
          </button>
        </div>
      {/if}
      {#if search.trim()}
        {#each results as r (key(r))}
          <ChatRow
            connectionId={r.cid}
            session={r.s}
            variant={isArchived(r.s) ? "archived" : r.srv.activeTurnBySession[r.s.sessionId] ? "running" : "default"}
            showServer={multiServer}
            snippet={r.snippet}
            query={search.trim()}
          />
        {:else}
          <p class="empty">No chats match “{search.trim()}”</p>
        {/each}
      {:else if chip === "archived"}
        {#each archiveGroups as g (g.cid + "::" + g.project)}
          <ProjectGroup connectionId={g.cid} projectPath={g.project} sessions={g.sessions} archived={true} />
        {:else}
          <p class="empty">Nothing archived</p>
        {/each}
      {:else if chip}
        {#each chipRows as r (key(r))}
          {@render rowFor(r, chip === "waiting" ? "attention" : chip === "running" ? "running" : "default")}
        {:else}
          <p class="empty">
            {chip === "waiting" ? "Nothing is waiting on you" : chip === "running" ? "Nothing is running" : "You're all caught up"}
          </p>
        {/each}
      {:else}
        {#if needsYou.length}
          <div class="section-label attention">Needs you</div>
          {#each needsYou as r (key(r))}{@render rowFor(r, "attention")}{/each}
        {/if}
        {#if running.length}
          <div class="section-label">Running</div>
          {#each running as r (key(r))}{@render rowFor(r, "running")}{/each}
        {/if}
        {#if pinnedShown.length}
          <div class="section-label">Pinned</div>
          {#each pinnedShown as r (key(r))}{@render rowFor(r, "default")}{/each}
        {/if}

        {#each serverSections as sec (sec.cid)}
          {@const open = !sec.srv.collapsedProjects[SERVER_SECTION]}
          {@const connected = sec.srv.connectionStatus === "connected"}
          {#if !flat}
            <ContextMenu items={() => serverMenu(sec.cid, sec.srv)}>
            <div class="server-head" class:offline={!connected}>
              <button
                class="server-toggle"
                aria-expanded={open}
                onclick={() => sec.srv.setProjectCollapsed(SERVER_SECTION, open)}
              >
                <span class="lead">
                  <span class="face icon-face"><ServerAvatar name={sec.srv.label} seed={sec.srv.serverId} size={14} /></span>
                  <span class="face chevron-face" class:open><Icon name="chevron-right" size={12} /></span>
                </span>
                <span class="server-name">{sec.srv.label}</span>
                {#if !connected}
                  <span class="server-state {sec.srv.connectionStatus}">
                    {SERVER_STATE[sec.srv.connectionStatus as keyof typeof SERVER_STATE] ?? ""}
                  </span>
                {/if}
              </button>
              {#if connected}
                <button class="server-add" title={`Add a project on ${sec.srv.label}`} aria-label="Add project" onclick={() => addProject(sec.cid)}>
                  <Icon name="folder-plus" size={12} />
                </button>
              {/if}
            </div>
            </ContextMenu>
          {/if}
          {#if open || flat}
            <div
              class="server-body"
              class:offline={!connected}
              class:nested={!flat}
              transition:slide={{ duration: flat ? 0 : Math.round(180 * app.settings.animationSpeed) }}
            >
              {#if !connected && multiServer}
                <p class="note">Showing cached chats — read-only until {sec.srv.label} reconnects.</p>
              {/if}
              {#each sec.groups as g (g.project)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="drag-wrap"
                  class:drop-target={dropTarget === sec.cid + g.project}
                  draggable="true"
                  onpointerdown={(e) => (dragArmed = !!(e.target as HTMLElement).closest(".summary"))}
                  ondragstart={(e) => {
                    if (!dragArmed) return e.preventDefault();
                    dragging = { cid: sec.cid, project: g.project };
                    e.dataTransfer?.setData("text/plain", g.project);
                  }}
                  ondragover={(e) => {
                    if (dragging?.cid !== sec.cid) return;
                    e.preventDefault();
                    dropTarget = sec.cid + g.project;
                  }}
                  ondragleave={() => dropTarget === sec.cid + g.project && (dropTarget = null)}
                  ondrop={(e) => (e.preventDefault(), dropOn(sec.cid, sec.srv, g.project))}
                  ondragend={() => ((dragging = null), (dropTarget = null))}
                >
                  <ProjectGroup
                    connectionId={sec.cid}
                    projectPath={g.project}
                    sessions={g.sessions}
                    archived={false}
                    onNewChat={() => void newChatIn(sec.cid, g.project)}
                  />
                </div>
              {:else}
                {#if flat && !projectFilter}
                  <div class="empty-state sidebar-empty">
                    <Icon name="folder-plus" size={20} />
                    <p>No projects on {sec.srv.label} yet</p>
                    {#if connected}
                      <button class="empty-action" onclick={() => addProject(sec.cid)}>Add a project</button>
                    {/if}
                  </div>
                {:else if !projectFilter}
                  <p class="empty">
                    No projects on {sec.srv.label}{#if connected}&nbsp;
                      — <button class="link" onclick={() => addProject(sec.cid)}>add one</button>{/if}
                  </p>
                {/if}
              {/each}
            </div>
          {/if}
        {:else}
          <p class="empty">No servers yet — connect one from the command palette.</p>
        {/each}
      {/if}
    </nav>

    <div class="user-area">
      <button
        class="profile"
        onclick={() => ((app.settingsTab = "profile"), (app.showSettings = true))}
        title={connectedServers.length ? "Profile — visible to peers on your connected servers" : "Profile — offline"}
      >
        <span class="avatar-wrap">
          <span class="avatar">
            {#if isPhotoAvatar(app.settings.profileAvatar)}
              <img src={app.settings.profileAvatar} alt="" />
            {:else}
              {app.settings.profileAvatar || "🐣"}
            {/if}
          </span>
          <span class="presence" class:online={connectedServers.length > 0}></span>
        </span>
        <span class="profile-name">{app.settings.profileName || "anonymous"}</span>
      </button>
      <button
        class="icon-btn"
        class:on={app.showUsage}
        onclick={() => (app.showUsage = !app.showUsage)}
        title="Usage"
        aria-label="Usage"
        aria-pressed={app.showUsage}
      >
        <Icon name="chart-bar" size={15} />
      </button>
    </div>

    {#if !app.sidebarCollapsed || resizing}
      <!-- Also mounted mid-drag while collapsed, since unmounting it here
           would drop the pointer capture the drag-to-reopen gesture depends
           on. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={app.sidebarWidth}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        tabindex="0"
        onpointerdown={startResize}
        onpointermove={onResize}
        onpointerup={stopResize}
        onpointercancel={stopResize}
        onkeydown={onResizeKey}
      ></div>
    {/if}
  </aside>
</div>


<style>
  .sidebar-slot {
    flex-shrink: 0;
    position: relative;
    /* `flex-basis`, not `width` — this is a flex item next to `.content-col`'s
       `flex: 1`, and animating `width` instead leaves that sibling's reflow
       a frame behind the transition (a visible snap before it catches up).
       Animating the property flexbox actually uses for sizing keeps both in
       lockstep every frame, same as `.right-slot` in RightSidebar.svelte. */
    transition: flex-basis calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .sidebar-slot.resizing {
    transition: none;
  }
  /* A drag that crosses the collapse threshold slides the sidebar shut instead
     of snapping. The transition is off for the whole drag (above) because the
     width has to track the pointer rather than ease behind it, so closing — the
     one state change in the gesture that isn't width tracking — opts back into
     it here.
     Deliberately keyed off the collapse state rather than `:not(.resizing)`, so
     it survives the pointer release: on mouseup the rules below stop matching
     and the base transition above takes over, but both declare the *same*
     transition, so the slide in flight is not cancelled and runs to the end.
     Only the collapse half does this — dragging back out restores the plain
     tracking behaviour the moment the pointer moves again. */
  .sidebar-slot.resizing.collapse-anim {
    transition: flex-basis calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .sidebar {
    --pad-x: 0.6rem;
    --ctrl-h: 2.15rem;
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: transparent;
    transition: transform calc(0.2s * var(--anim-speed, 1)) ease;
    display: flex;
    flex-direction: column;
    /* Top padding is the chat panel's own margin, so the first row below
       starts on the same line the panel's header does. */
    padding: var(--chat-margin) var(--pad-x) 0.6rem;
    gap: 0.55rem;
    /* Chrome (labels, buttons, statuses) reads as UI, not content — so it
       isn't selectable by default; inputs opt back in below. */
    user-select: none;
  }
  .sidebar :global(input) {
    user-select: text;
  }
  .sidebar.collapsed {
    transform: translateX(-100%);
  }
  .sidebar-slot.resizing .sidebar {
    transition: none;
  }
  /* Same as the slot's rule above: the slide out is the exception to "no
     transitions during a drag". */
  .sidebar-slot.resizing.collapse-anim .sidebar {
    transition: transform calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Deliberately the same height as a chat header, starting at the same y —
     so "Yoakeland" and the open chat's name share one baseline across the
     whole window instead of each floating at its own height. The logo stays in
     here rather than in any floating chrome, so it slides out with the sidebar
     when it's collapsed. */
  .brand-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    height: var(--header-height);
    flex-shrink: 0;
    padding-left: calc(var(--toggle-reserve) - var(--pad-x));
  }
  .brand-logo {
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }
  .brand {
    font-family: var(--logo-font-family);
    font-size: var(--text-body-size);
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
  }
  .quick-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  .new-chat {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ctrl-h);
    height: var(--ctrl-h);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--text);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .new-chat:hover {
    background: var(--sidebar-hover);
  }
  .new-chat :global(.icon) {
    color: var(--accent);
  }
  .project-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  /* .project-trigger is layered on top of Dropdown.svelte's own generic
     .dropdown-trigger styling (see triggerClass) — just the sidebar-specific
     sizing, not a competing look. */
  :global(.project-trigger) {
    flex: 1;
  }
  :global(.project-trigger.empty-cta) {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    background: none;
    border: 1px solid transparent;
    color: var(--sidebar-fg);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  :global(.project-trigger.empty-cta:hover) {
    background: var(--sidebar-hover);
  }
  .manage-projects {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ctrl-h);
    height: var(--ctrl-h);
    background: transparent;
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .manage-projects:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .chat-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
    scrollbar-width: none;
  }
  .chat-list::-webkit-scrollbar {
    display: none;
  }
  /* Same small-caps label as the palette's and Settings' group headings. */
  .section-label {
    padding: 0.71rem var(--space-1) 0.29rem;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--sidebar-fg-dim);
    opacity: 0.75;
  }
  .empty,
  .note {
    margin: 0;
    color: var(--sidebar-fg-dim);
    font-size: var(--text-label-size);
    padding: var(--space-1);
  }
  .note {
    font-size: 0.7rem;
    padding-top: 0;
  }
  .sidebar-empty {
    padding: 2rem var(--space-1);
    font-size: var(--text-label-size);
  }
  .sidebar-empty p {
    margin: 0;
  }
  .empty-action {
    margin-top: 0.29rem;
    padding: 0.29rem 0.71rem;
    background: transparent;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg);
    font: inherit;
    cursor: pointer;
  }
  .empty-action:hover {
    background: var(--sidebar-hover);
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
  .section-label.attention {
    color: var(--warning);
    opacity: 1;
  }
  :global(.filter-btn) {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ctrl-h);
    height: var(--ctrl-h);
    background: transparent;
    border: 1px solid transparent;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  :global(.filter-btn:hover),
  :global(.filter-btn[data-state="open"]) {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  :global(.filter-btn.on) {
    color: var(--accent);
    background: var(--sidebar-active);
  }
  .filter-dot {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warning);
  }
  :global(.filter-item .filter-label) {
    flex: 1;
  }
  :global(.filter-item .filter-count) {
    font-size: 0.68rem;
    opacity: 0.7;
  }
  :global(.filter-item .filter-count.warn) {
    color: var(--warning);
    opacity: 1;
  }
  .filter-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.29rem;
  }
  .clear-filter {
    display: flex;
    padding: 0.14rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  .clear-filter:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .server-head {
    display: flex;
    align-items: center;
    margin-top: 0.43rem;
    border-radius: var(--radius-sm);
  }
  .server-head:hover {
    background: var(--sidebar-hover);
  }
  .server-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0.36rem 0.57rem;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  /* Avatar and chevron share one slot, crossfading on hover — same as a
     project's folder icon (ProjectGroup.svelte). */
  .lead {
    position: relative;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
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
  .server-toggle:hover .icon-face,
  .server-toggle:focus-visible .icon-face {
    opacity: 0;
  }
  .server-toggle:hover .chevron-face,
  .server-toggle:focus-visible .chevron-face {
    opacity: 1;
  }
  .chevron-face.open {
    transform: rotate(90deg);
  }
  .server-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .server-head.offline .server-toggle :global(.server-avatar) {
    filter: grayscale(1);
    opacity: 0.55;
  }
  .server-state {
    font-size: 0.68rem;
    font-weight: 400;
    color: var(--warning);
  }
  .server-state.error {
    color: var(--danger);
  }
  .server-add {
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
  }
  .server-head:hover .server-add {
    opacity: 1;
  }
  .server-add:hover {
    color: var(--text);
  }
  /* One indent step per tree level: remote → project → chat. */
  .server-body.nested {
    --project-indent: 0.71rem;
  }
  .server-body.offline :global(.group) {
    opacity: 0.7;
  }
  .drag-wrap.drop-target {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .user-area {
    display: flex;
    align-items: center;
    gap: 0.21rem;
    padding: 0.43rem;
    border-top: 1px solid var(--panel-border);
  }
  .profile {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.57rem;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 0.29rem 0.43rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .profile:hover {
    background: var(--sidebar-hover);
  }
  .avatar {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
    font-size: 1.15rem;
    line-height: 1;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-wrap {
    position: relative;
    flex-shrink: 0;
  }
  /* Presence, the way chat apps show it: online while any server is
     connected (you're visible in its peer list), hollow when not. */
  .presence {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: inset 0 0 0 2px var(--sidebar-fg-dim);
    border: 2px solid var(--bg);
    box-sizing: content-box;
  }
  .presence.online {
    background: var(--success);
    box-shadow: none;
  }
  .profile-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text);
  }
  .icon-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .icon-btn.on {
    color: var(--text);
    background: var(--sidebar-active);
  }
  .resize-handle {
    position: absolute;
    top: 0;
    right: -0.21rem;
    width: 0.43rem;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    /* The chat panel is painted after this sidebar and wins hit-testing across
       the whole centre of this handle, leaving only its inner half grabbable.
       Lifting it above the panel (still well under the floating chrome at 20)
       gives the full band back. */
    z-index: 5;
  }
</style>
<script lang="ts">
  import { Tabs } from "bits-ui";
  import { tick } from "svelte";
  import { app, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, type ConnectionId, type ServerState } from "../state.svelte";
  import { selectProject, browseAndAddProject, setSessionTitle, setSessionArchived, deleteSession, openInSidePanel, openChatSession, listSessionsForProjects } from "../ipc";
  import { relTime, basename, sessionTitle } from "../format";
  import { isPhotoAvatar } from "../avatar";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import ProjectGroup from "./ProjectGroup.svelte";
  import SplitEntry from "./SplitEntry.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";
  import Dropdown from "./Dropdown.svelte";

  const ALL_PROJECTS = "__all__";

  // Dragging past the minimum collapses outright, VS Code-style, instead of
  // just hitting a hard floor — and dragging back out while the pointer is
  // still down re-opens it (see onResize), so overshooting costs nothing.
  // Threshold is generous — a light overshoot while dragging shouldn't
  // accidentally collapse the sidebar.
  const COLLAPSE_THRESHOLD = 90;

  const statusIcon = {
    working: "loader-2",
    action: "alert-circle",
    finished: "circle-check",
    idle: "message-circle",
  } as const;

  // Every field below that used to read the flat, single-server `app.X` now
  // reaches through the active connection's own ServerState instead — see
  // the multi-server-connections plan. `server` (and `cid`, its connection
  // id, needed by every ipc.ts call now that they're threaded per
  // connection) are null whenever there's no active connection, so the
  // sidebar just renders its offline/empty states.
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
  // opened/selected here — added from Settings > Connections, or pushed by
  // project_list from another connection (§4b) — in which case it has no
  // sessionsByProject entry yet and would otherwise never show a group at
  // all (see below). Fetch it the moment it's known, not only once picked.
  $effect(() => {
    if (!cid || !server) return;
    const missing = server.recentProjects.filter((p) => !(p in server.sessionsByProject));
    if (missing.length > 0) listSessionsForProjects(cid, missing);
  });

  // The sidebar's groups are keyed off every *known* project (server-
  // persisted projects.json, via recentProjects) rather than just the ones
  // sessionsByProject happens to have an entry for — otherwise a project
  // that's known but not yet opened/fetched (see the effect above) simply
  // has no group to render at all, which used to read as "added projects
  // don't show up until you pick them".
  const projectGroups = $derived(
    (server?.recentProjects ?? []).map(
      (project) => [project, server?.sessionsByProject[project] ?? []] as [string, SessionSummary[]],
    ),
  );
  // Unified remote+project picker (replaces the old tabbed ServerSwitcher
  // pill row): one dropdown listing every project across every connected
  // remote, so picking a project under a different remote also switches to
  // it — the picker itself is the only "which remote" control now. Values
  // are encoded "connectionId::path" (or bare ALL_PROJECTS, the same
  // sentinel selectedProjectPath already used, scoped to the active remote).
  function remoteLabel(srv: ServerState): string {
    return srv.serverIdentity ?? (srv.connectionMode === "local" ? "Local" : "Remote");
  }
  const remoteProjectItems = $derived([
    { value: ALL_PROJECTS, label: "All projects" },
    ...Object.entries(app.servers).flatMap(([scid, srv]) =>
      srv.recentProjects.map((p) => ({
        // Qualified whenever the owning connection isn't local — this list
        // spans every connection at once, so a bare name would be ambiguous
        // between e.g. two different servers that both have a "yoake-gui"
        // checkout. A local project stays unqualified: this is the common
        // case and the one that needs no disambiguating.
        value: `${scid}::${p}`,
        label: srv.connectionMode !== "local" ? `${remoteLabel(srv)}: ${basename(p)}` : basename(p),
      })),
    ),
  ]);
  let pickerValue = $state<string>(
    app.activeConnectionId && app.active?.currentProjectPath
      ? `${app.activeConnectionId}::${app.active.currentProjectPath}`
      : ALL_PROJECTS,
  );
  // selectedProjectPath/cid -> pickerValue (e.g. a session opened from a
  // different project narrows the underlying selection some other way).
  $effect(() => {
    pickerValue = cid && selectedProjectPath !== ALL_PROJECTS ? `${cid}::${selectedProjectPath}` : ALL_PROJECTS;
  });
  // pickerValue -> selectedProjectPath/cid (the user actually picked
  // something) — switches the active connection first when the chosen
  // project belongs to a different one, so the effect above (and the
  // existing selectProject effect) both then act against the right remote.
  $effect(() => {
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
    if (cid && renamingId && renameValue.trim())
      setSessionTitle(cid, renamingId, renameValue.trim());
    renamingId = null;
  }

  let search = $state("");
  let view = $state("active");
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

  // scid/srv default to the active connection so every existing call site
  // (the Active/Archive sections, still single-connection) keeps working
  // unchanged — only the Running section (aggregated across every connected
  // remote, see the `running` derivation below) passes them explicitly.
  function menuItems(s: SessionSummary, scid: string | null = cid, srv: typeof server = server): ContextMenuItem[] {
    const isCurrent = s.sessionId === srv?.currentSessionId;
    return [
      { label: "Rename", icon: "pencil", onSelect: () => startRename(s) },
      {
        label: "Open in side panel",
        icon: "layout-columns",
        disabled: isCurrent,
        onSelect: () => scid && openInSidePanel(scid, s.sessionId),
      },
      { label: "Archive", icon: "archive", onSelect: () => scid && setSessionArchived(scid, s.sessionId, true) },
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
          if (scid && confirm(`Permanently delete "${sessionTitle(s)}"? This can't be undone.`)) {
            deleteSession(scid, s.sessionId);
          }
        },
      },
    ];
  }

  async function newChat(projectPath?: string) {
    if (!cid) return;
    const path = projectPath ?? server?.currentProjectPath ?? (await browseAndAddProject(cid));
    if (path) {
      if (path !== server?.currentProjectPath) selectProject(cid, path);
      const current = server?.currentSessionId;
      if (current && (server?.messagesBySession[current] ?? []).length === 0) {
        server?.discardUnsentSession(current);
      }
      server?.newSessionInProject(path);
    }
  }

  // A session created by `newChat` but never sent doesn't exist on the
  // server yet — hide it from the list until its first message goes out.
  // `messageCount` alone would miss a just-sent local message before the
  // server round-trips a session_updated/list_sessions; the local cache
  // alone would miss any session this client hasn't opened yet (another
  // device, a fresh install, one only seen via session_list) — check both.
  function hasMessages(s: SessionSummary): boolean {
    return s.messageCount > 0 || (server?.messagesBySession[s.sessionId] ?? []).length > 0;
  }

  function statusOf(sessionId: string, srv: typeof server = server): "working" | "action" | "finished" | "idle" {
    return srv?.sessionStatus(sessionId) ?? "idle";
  }

  function matchesSearch(s: SessionSummary): boolean {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      s.sessionId.toLowerCase().includes(q) ||
      (s.title ?? "").toLowerCase().includes(q)
    );
  }

  function currentActivity(sessionId: string, srv: typeof server = server): string {
    if (srv?.pendingPermission?.sessionId === sessionId)
      return "waiting on you…";
    const msgs = srv?.messagesBySession[sessionId] ?? [];
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    const lastTool = last?.toolCalls[last.toolCalls.length - 1];
    return lastTool ? `${lastTool.name}…` : "thinking…";
  }

  const autoArchiveMs = $derived(app.settings.autoArchiveDays * 86400000);

  // Sessions that are the secondary ("b") half of a saved split are hidden
  // from their own natural spot — they render stacked under their partner
  // instead (see SplitEntry / ServerState.splitPartnerFor), wherever the
  // partner naturally lands, even if that's a different section (Running vs
  // a project's list) or a different project entirely.
  // Aggregated across every connected remote, not just the active one — a
  // running chat stays visible (and pinned here) regardless of which remote
  // the project/remote picker currently has selected. Only the active
  // connection's own list respects projectFilter; the concept doesn't apply
  // to another remote's sessions, which aren't scoped to "the selected
  // project" at all here.
  interface RunningEntry {
    session: SessionSummary;
    cid: ConnectionId;
    server: ServerState;
  }
  const running = $derived<RunningEntry[]>(
    Object.entries(app.servers).flatMap(([scid, srv]) => {
      const sessions =
        scid === cid
          ? projectGroups
              .filter(([project]) => !projectFilter || project === projectFilter)
              .flatMap(([, sessions]) => sessions)
          : Object.values(srv.sessionsByProject).flat();
      return sessions
        .filter((s) => srv.activeTurnBySession[s.sessionId] && !srv.hiddenSplitSessionIds.has(s.sessionId))
        .map((s) => ({ session: s, cid: scid, server: srv }));
    }),
  );

  const activeGroups = $derived(
    projectGroups
      .filter(([project]) => !projectFilter || project === projectFilter)
      .map(
        ([project, sessions]) =>
          [
            project,
            sessions
              .filter(
                (s) =>
                  !server?.activeTurnBySession[s.sessionId] &&
                  !s.archived &&
                  Date.now() - new Date(s.updatedAt).getTime() <=
                    autoArchiveMs &&
                  !server?.hiddenSplitSessionIds.has(s.sessionId) &&
                  hasMessages(s) &&
                  matchesSearch(s),
              )
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
              ),
          ] as [string, SessionSummary[]],
      )
      // Empty groups still render — see ProjectGroup's own empty state —
      // except while searching, where an empty group is just noise.
      .filter(([, sessions]) => sessions.length > 0 || !search.trim()),
  );

  const archiveGroups = $derived(
    projectGroups
      .filter(([project]) => !projectFilter || project === projectFilter)
      .map(
        ([project, sessions]) =>
          [
            project,
            sessions
              .filter(
                (s) =>
                  (s.archived ||
                    Date.now() - new Date(s.updatedAt).getTime() >
                      autoArchiveMs) &&
                  !server?.hiddenSplitSessionIds.has(s.sessionId) &&
                  hasMessages(s) &&
                  matchesSearch(s),
              )
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
              ),
          ] as [string, SessionSummary[]],
      )
      .filter(([, sessions]) => sessions.length > 0),
  );
</script>

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
      <div class="search">
        <Icon name="search" size={13} />
        <input type="text" placeholder="Search threads…" bind:value={search} />
        {#if search}
          <button class="search-clear" onclick={() => (search = "")} title="Clear search" aria-label="Clear search">
            <Icon name="xmark" size={12} />
          </button>
        {/if}
      </div>
      <button class="new-chat" onclick={() => newChat()} title="New chat" aria-label="New chat">
        <Icon name="message-circle-plus" size={16} />
      </button>
    </div>

    <div class="project-row">
      {#if remoteProjectItems.length > 1}
        <Dropdown
          items={remoteProjectItems}
          bind:value={pickerValue}
          placeholder="Select a project…"
          triggerIcon="folder"
          searchable={remoteProjectItems.length > 6}
          searchPlaceholder="Search projects…"
          triggerClass="project-trigger"
        >
          {#snippet item({ value, label, selected })}
            {@const path = value === ALL_PROJECTS ? undefined : value.slice(value.indexOf("::") + 2)}
            <span class="dropdown-item-label" title={path}>{label}</span>
            {#if selected}<Icon name="check" size={11} />{/if}
          {/snippet}
        </Dropdown>
      {:else}
        <button
          class="project-trigger empty-cta"
          onclick={() => cid && browseAndAddProject(cid).then((p) => p && cid && selectProject(cid, p))}
        >
          <Icon name="folder-plus" size={13} />
          <span>Add your first project</span>
        </button>
      {/if}
      <button
        class="manage-projects"
        title="Manage projects"
        aria-label="Manage projects"
        onclick={() => (
          (app.settingsTab = "connections"), (app.showSettings = true)
        )}
      >
        <Icon name="folder-plus" size={14} />
      </button>
    </div>

    <Tabs.Root bind:value={view} class="sidebar-tabs-root">
      <Tabs.List class="view-tabs">
        <Tabs.Trigger value="active" class="view-tab">Active</Tabs.Trigger>
        <Tabs.Trigger value="archive" class="view-tab">Archive</Tabs.Trigger>
      </Tabs.List>

    <nav class="chat-list">
      <Tabs.Content value="active" class="view-tab-content">
        {#if running.length > 0}
          <div class="section-label">Running</div>
          {#each running as entry (entry.cid + entry.session.sessionId)}
            {@const s = entry.session}
            {@const isActiveConn = entry.cid === cid}
            {@const paired = isActiveConn ? (entry.server.splitPartnerFor(s.sessionId) ?? null) : null}
            {#if paired}
              <SplitEntry primary={s} secondary={paired} />
            {:else if isActiveConn && renamingId === s.sessionId}
              <div class="chat-card" class:active={s.sessionId === entry.server.currentSessionId}>
                <div class="chat-card-top">
                  <span class="status-icon status-{statusOf(s.sessionId, entry.server)}" aria-hidden="true">
                    <Icon name={statusIcon[statusOf(s.sessionId, entry.server)]} size={13} />
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
                <span class="chat-card-status">{currentActivity(s.sessionId, entry.server)}</span>
              </div>
            {:else}
              <ContextMenu items={isActiveConn ? menuItems(s) : []}>
                <button
                  type="button"
                  class="chat-card"
                  class:active={isActiveConn && s.sessionId === entry.server.currentSessionId}
                  class:syncing={entry.server.syncingSessions[s.sessionId]}
                  disabled={entry.server.syncingSessions[s.sessionId]}
                  aria-label={`${sessionTitle(s)}, ${entry.server.syncingSessions[s.sessionId] ? "syncing" : statusOf(s.sessionId, entry.server)}`}
                  ondblclick={() => isActiveConn && startRename(s)}
                  onclick={() => {
                    if (!isActiveConn) app.activeConnectionId = entry.cid;
                    openChatSession(entry.cid, s.sessionId);
                  }}
                >
                  <div class="chat-card-top">
                    <span class="status-icon status-{statusOf(s.sessionId, entry.server)}" aria-hidden="true">
                      <Icon name={statusIcon[statusOf(s.sessionId, entry.server)]} size={13} />
                    </span>
                    <span class="label">{sessionTitle(s)}</span>
                    {#if !isActiveConn}
                      <!-- Running on a remote other than the one currently
                           selected in the picker — name it so "pinned
                           regardless of remote" doesn't read as ambiguous
                           about which server it'll open. -->
                      <span class="remote-badge" title="Running on {entry.server.serverIdentity ?? (entry.server.connectionMode === 'local' ? 'Local' : 'Remote')}">
                        {entry.server.serverIdentity ?? (entry.server.connectionMode === "local" ? "Local" : "Remote")}
                      </span>
                    {:else if s.sessionId !== entry.server.currentSessionId}
                      <!-- Not a real <button>: this sits inside the .chat-card
                           button above it, and nested <button>s are invalid
                           HTML (the browser would silently split/hoist one out,
                           breaking layout and click semantics). -->
                      <span
                        role="button"
                        tabindex="0"
                        class="side-panel-btn"
                        title="Open in side panel"
                        aria-label="Open in side panel"
                        onclick={(e) => {
                          e.stopPropagation();
                          if (cid) openInSidePanel(cid, s.sessionId);
                        }}
                        onkeydown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            if (cid) openInSidePanel(cid, s.sessionId);
                          }
                        }}
                      >
                        <Icon name="layout-columns" size={13} />
                      </span>
                    {/if}
                  </div>
                  <span class="chat-card-status">{currentActivity(s.sessionId, entry.server)}</span>
                </button>
              </ContextMenu>
            {/if}
          {/each}
        {/if}

        {#if activeGroups.length > 0}
          {#if running.length > 0}<div class="section-label">Recent</div>{/if}
          {#each activeGroups as [project, sessions] (project)}
            <ProjectGroup projectPath={project} {sessions} archived={false} onNewChat={() => newChat(project)} />
          {/each}
        {:else if running.length === 0}
          <p class="empty">No threads yet</p>
        {/if}
      </Tabs.Content>
      <Tabs.Content value="archive" class="view-tab-content">
        {#if archiveGroups.length > 0}
          {#each archiveGroups as [project, sessions] (project)}
            <ProjectGroup projectPath={project} {sessions} archived={true} />
          {/each}
        {:else}
          <p class="empty">Nothing archived</p>
        {/if}
      </Tabs.Content>
    </nav>
    </Tabs.Root>

    <div class="user-area">
      <button
        class="profile"
        onclick={() => (
          (app.settingsTab = "profile"), (app.showSettings = true)
        )}
        title="Profile"
      >
        <span class="avatar">
          {#if isPhotoAvatar(app.settings.profileAvatar)}
            <img src={app.settings.profileAvatar} alt="" />
          {:else}
            {app.settings.profileAvatar || "🐣"}
          {/if}
        </span>
        <span class="profile-name"
          >{app.settings.profileName || "anonymous"}</span
        >
      </button>
      <button
        class="icon-btn"
        onclick={() => (app.showConnectModal = true)}
        title={Object.keys(app.servers).length > 0 ? "Add another server" : "Connect"}
        aria-label={Object.keys(app.servers).length > 0 ? "Add another server" : "Connect"}
      >
        <Icon name="log-in" size={14} />
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
  .sidebar input {
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
  :global(.sidebar-tabs-root) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  :global(.view-tabs) {
    display: flex;
    background: rgba(255, 255, 255, 0.04);
    border-radius: var(--radius-pill);
    padding: 0.14rem;
  }
  :global(.view-tab) {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--sidebar-fg-dim);
    padding: 0.36rem;
    border-radius: var(--radius-pill);
    font-size: var(--text-heading-size);
    cursor: pointer;
  }
  :global(.view-tab[data-state="active"]) {
    background: var(--sidebar-active);
    color: var(--text);
  }
  /* Tabs.Content hides the inactive panel via a plain `hidden` attribute, not
     `display:none` — `display:contents` on the active one lets its children
     flow straight into `.chat-list`'s own flex column instead of being
     boxed inside an extra wrapper div that would break its `gap`. The more
     specific `[hidden]` rule below still wins for the inactive one. */
  :global(.view-tab-content) {
    display: contents;
  }
  :global(.view-tab-content[hidden]) {
    display: none;
  }
  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0 var(--space-1);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    height: var(--ctrl-h);
  }
  .search:focus-within {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-label-size);
  }
  .search-clear {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 1.29rem;
    background: none;
    border: none;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .search-clear:hover {
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
  .section-label {
    padding: 0.43rem var(--space-1) 0.14rem;
    font-size: var(--text-heading-size);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sidebar-fg-dim);
  }
  .chat-card {
    display: flex;
    flex-direction: column;
    gap: 0.21rem;
    width: 100%;
    background: var(--accent-dim);
    border: 1px solid transparent;
    color: var(--text);
    padding: var(--space-1) 0.64rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    margin: 0.14rem 0;
    font: inherit;
  }
  .chat-card.active {
    border-color: var(--accent);
  }
  .chat-card.syncing {
    opacity: 0.5;
    cursor: default;
  }
  .chat-card-top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .chat-card-status {
    font-size: var(--text-heading-size);
    color: var(--accent);
    padding-left: 1.3rem;
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
  .status-icon.status-working :global(svg) {
    animation: spin calc(1s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remote-badge {
    flex-shrink: 0;
    font-size: var(--text-caption-size, 0.7rem);
    color: var(--sidebar-fg-dim);
    background: var(--sidebar-hover);
    border-radius: var(--radius-pill);
    padding: 0.07rem 0.43rem;
    max-width: 6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side-panel-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    margin: 0;
    background: none;
    border: none;
    font: inherit;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .chat-card:hover .side-panel-btn {
    opacity: 1;
  }
  .side-panel-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
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
  .empty {
    color: var(--sidebar-fg-dim);
    font-size: var(--text-label-size);
    padding: var(--space-1);
  }
  .user-area {
    display: flex;
    align-items: center;
    gap: var(--space-half);
    padding: 0.43rem;
    border-top: 1px solid var(--panel-border);
  }
  .profile {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    background: transparent;
    border: none;
    padding: var(--space-half) 0.43rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
  }
  .profile:hover {
    background: var(--sidebar-hover);
  }
  .avatar {
    flex-shrink: 0;
    width: 1.7rem;
    height: 1.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    font-size: 1.1rem;
    line-height: 1;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .profile-name {
    flex: 1;
    font-size: var(--text-label-size);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .icon-btn {
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
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
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
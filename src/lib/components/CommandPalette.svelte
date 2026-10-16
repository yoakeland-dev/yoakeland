<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Ctrl+K command palette. Pages form a back-stack: Backspace on an empty
  // search pops one, Escape pops one too if possible, else closes.
  import { Command, Dialog, DropdownMenu } from "bits-ui";
  import { tick, type ComponentProps } from "svelte";
  import { app, forgetKnownServer, type PaletteRequest } from "../state.svelte";
  import {
    browseAndAddProject,
    connectServerRow,
    disconnect,
    removeServer,
    serverRows,
    type ServerRow,
    dismissNotification,
    isPickingFolder,
    listDirectory,
    newChat,
    openChatSession,
    resolveDirectoryBrowser,
    selectProject,
    carryBlankChat,
  } from "../ipc";
  import { relTime, sessionTitle } from "../format";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import Kbd from "./Kbd.svelte";
  import { ACTION_BY_ID } from "../keybinds.svelte";

  type Page =
    | { kind: "root" }
    | { kind: "projects" }
    | { kind: "browse"; path?: string }
    | { kind: "servers" }
    | { kind: "server"; key: string };

  let stack = $state<Page[]>([{ kind: "root" }]);
  let search = $state("");
  let highlighted = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  const page = $derived(stack[stack.length - 1]);
  const searching = $derived(search.trim() !== "");

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);
  let sessionId = $derived(server?.currentSessionId ?? null);

  // Reopening while already open (e.g. "Add project" starting a folder pick)
  // pushes onto the stack instead of resetting it.
  const pageFor = (k: "root" | "projects" | "browse" | "servers"): Page => ({ kind: k });
  let wasOpen = false;
  let handledRequest = 0;
  // Set while the projects page is answering pickProject() rather than "New session in…".
  let picking = $state<PaletteRequest["pick"]>();
  $effect(() => {
    const open = app.paletteOpen;
    const req = app.paletteRequest;
    if (open && req.at !== handledRequest) picking = req.pick;
    if (!open) picking = undefined;
    if (open && !wasOpen) {
      stack = [pageFor(req.page)];
      search = "";
      highlighted = "";
      focusForPage();
    } else if (open && req.at !== handledRequest) {
      push(pageFor(req.page));
    }
    handledRequest = req.at;
    if (!open && wasOpen) resolveDirectoryBrowser(null);
    wasOpen = open;
  });

  function push(p: Page) {
    stack = [...stack, p];
    search = "";
    highlighted = "";
    focusForPage();
  }

  function back() {
    if (stack.length <= 1) {
      close();
      return;
    }
    const leaving = page;
    stack = stack.slice(0, -1);
    search = "";
    highlighted = "";
    const now = stack[stack.length - 1];
    if (now.kind === "browse") {
      browseTo(now.path);
    } else if (leaving.kind === "browse" && isPickingFolder()) {
      resolveDirectoryBrowser(null); // backed out of the browser entirely
    }
    focusForPage();
  }

  function close() {
    app.paletteOpen = false;
  }

  function run(fn: () => void) {
    close();
    fn();
  }

  function focusForPage() {
    void tick().then(() => inputEl?.focus());
  }

  // ---- folder browsing ----

  // ponytail: POSIX paths, like the rest of the client; yoakeland only
  // targets POSIX today (§2a).
  function childPath(path: string, name: string): string {
    return path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
  }

  /** Resolves what was typed in the search box against the open folder:
   * absolute (`/srv/x`), home-relative (`~/x`, expanded server-side) or
   * relative (`Projects/yoake`, `../other`), with `.`/`..` folded. */
  function resolveTyped(input: string, base: string): string {
    const raw = input.startsWith("/") || input.startsWith("~") ? input : childPath(base, input);
    const home = raw.startsWith("~");
    const out: string[] = [];
    for (const seg of raw.split("/").slice(home ? 1 : 0)) {
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return (home ? "~/" : "/") + out.join("/");
  }

  function browseTo(path?: string) {
    const bcid = app.browsingConnectionId;
    if (!bcid) return;
    app.directoryListing = null;
    listDirectory(bcid, path);
  }

  const browsableServers = $derived(Object.entries(app.servers).filter(([, srv]) => srv.connectionStatus === "connected"));
  const browsingServer = $derived(app.browsingConnectionId ? app.servers[app.browsingConnectionId] : null);
  function browseServer(scid: string) {
    if (scid === app.browsingConnectionId) return;
    app.browsingConnectionId = scid;
    // The other server's folders don't exist here, drop them from the back-stack.
    while (stack.length > 1 && stack[stack.length - 2].kind === "browse") stack = stack.slice(0, -1);
    stack = [...stack.slice(0, -1), { kind: "browse" }];
    search = "";
    browseTo();
    focusForPage();
  }

  function openDir(path: string) {
    // Remember where we were (resolved), so Backspace comes back here.
    stack = [...stack.slice(0, -1), { kind: "browse", path: app.directoryListing?.path }];
    push({ kind: "browse", path });
    browseTo(path);
  }

  function pickDir(path: string) {
    resolveDirectoryBrowser(path);
    close();
  }

  const listing = $derived(page.kind === "browse" ? app.directoryListing : null);
  const canPick = $derived(!!listing && !listing.error);
  const folders = $derived(listing?.entries.filter((e) => e.isDir) ?? []);
  const typedPath = $derived(
    listing && (search.includes("/") || search.startsWith("~")) ? resolveTyped(search.trim(), listing.path) : null,
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Backspace" && search === "") {
      e.preventDefault();
      back();
      return;
    }
    // Tab, or Right with the caret already at the end, drills into a server.
    const input = e.currentTarget as HTMLInputElement;
    const drill =
      (e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && input.selectionStart === search.length);
    if (drill && page.kind === "servers" && highlighted.startsWith("srv:")) {
      e.preventDefault();
      push({ kind: "server", key: highlighted.slice(4) });
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && page.kind === "browse") {
      e.preventDefault();
      e.stopPropagation();
      if (canPick) pickDir(listing!.path);
    }
  }

  // ---- root page ----

  interface Action {
    id: string;
    label: string;
    icon: ComponentProps<typeof Icon>["name"];
    detail?: string;
    /** Opens another page of the palette, gets a trailing chevron. */
    submenu?: boolean;
    /** keybinds.svelte.ts action whose shortcut is shown at the end of the row. */
    keys?: string;
    run: () => void;
  }

  const SETTINGS_TABS: [string, string, Action["icon"]][] = [
    ["profile", "Profile", "user"],
    ["appearance", "Appearance", "palette"],
    ["terminal", "Terminal", "terminal-2"],
    ["keyboard", "Keyboard shortcuts", "keyboard"],
    ["servers", "Servers", "server"],
    ["general", "General", "settings"],
    ["providers", "Providers", "brain"],
    ["projects", "Projects", "code"],
    ["safety", "Safety", "shield-check"],
    ["notifications", "Notifications", "bell"],
    ["access", "Access", "network"],
    ["audit", "Audit log", "clipboard-list"],
  ];

  const chatActions = $derived.by((): Action[] => {
    const sid = sessionId;
    if (!server || !sid) return [];
    const s = server;
    return [
      {
        id: "chat:model",
        label: "Change model",
        icon: "brain",
        keys: "chat.model",
        run: () => run(() => (app.modelPickerRequest = { sessionId: sid, at: Date.now() })),
      },
      {
        id: "chat:terminal",
        label: s.terminalOpenBySession[sid] ? "Hide terminal" : "Show terminal",
        icon: "terminal-2",
        keys: "terminal.toggle",
        run: () => run(() => s.toggleTerminal(sid)),
      },
      {
        id: "chat:new-terminal",
        label: "New terminal",
        icon: "plus",
        keys: "terminal.new",
        run: () => run(() => s.newTerminal(sid)),
      },
      {
        id: "chat:sidebar",
        label: s.chatSidebarOpenBySession[sid] ? "Hide chat side panel" : "Show chat side panel",
        icon: "sidebar-right-expand",
        keys: "panel.toggle",
        run: () => run(() => s.toggleChatSidebar(sid)),
      },
      {
        id: "chat:mode",
        label: "Cycle mode",
        icon: "arrows-exchange",
        keys: "chat.mode",
        run: () => run(() => ACTION_BY_ID.get("chat.mode")?.run?.()),
      },
    ];
  });

  const startActions = $derived.by((): Action[] => {
    const c = cid;
    const list: Action[] = [];
    if (c && server?.currentProjectPath) {
      const p = server.currentProjectPath;
      list.push({ id: "start:new-here", label: `New in ${server.projectLabel(p)}`, icon: "message-circle-plus", keys: "chat.new", run: () => run(() => void newChat(c, p)) });
    }
    if (c) {
      list.push({ id: "start:new-in", label: "New session in…", icon: "code", submenu: true, run: () => push({ kind: "projects" }) });
      list.push({ id: "start:add-project", label: "Add project…", icon: "folder-plus", submenu: true, run: addProject });
    }
    // Doesn't need `cid`: it's how you'd get one.
    list.push({ id: "start:servers", label: "Servers…", icon: "server", submenu: true, run: () => push({ kind: "servers" }) });
    return list;
  });

  // Only offered once you search, see the markup.
  const viewActions = $derived.by((): Action[] => {
    const c = cid;
    const list: Action[] = [
      {
        id: "view:sidebar",
        label: app.sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        icon: "sidebar-left-expand",
        keys: "sidebar.toggle",
        run: () => run(() => app.toggleSidebar()),
      },
      { id: "view:notifications", label: "Show notifications", icon: "bell", keys: "notifications.open", run: () => run(() => (app.notificationsOpen = true)) },
      { id: "view:extensions", label: "MCP servers and skills", icon: "plug-connected", keys: "extensions.toggle", run: () => run(() => app.openExtensions()) },
      { id: "view:usage", label: app.showUsage ? "Hide usage" : "Show usage", icon: "chart-bar", keys: "usage.toggle", run: () => run(() => (app.showUsage = !app.showUsage)) },
    ];
    if (c && server?.notifications.length) {
      list.push({ id: "view:clear-notifications", label: "Clear all notifications", icon: "trash", run: () => run(() => dismissNotification(c)) });
    }
    return list;
  });

  const settingsActions = $derived(
    SETTINGS_TABS.map(([tab, label, icon]): Action => ({
      id: `settings:${tab}`,
      label,
      detail: "Settings",
      icon,
      keys: tab === "keyboard" ? "keybinds.open" : undefined,
      run: () =>
        run(() => {
          app.settingsTab = tab;
          app.showSettings = true;
        }),
    })),
  );

  const chats = $derived.by(() => {
    // Keyed by cid+id: a session can be listed under more than one project path (stale
    // entry left behind by a rename/move) and would otherwise give the palette's keyed
    // {#each} two rows with the same key, which Svelte throws on (each_key_duplicate).
    const out = new Map<string, { cid: string; id: string; title: string; project: string; updatedAt: string; archived: boolean }>();
    for (const [scid, srv] of Object.entries(app.servers)) {
      for (const [path, sessions] of Object.entries(srv.sessionsByProject)) {
        for (const s of sessions) {
          if (s.messageCount === 0 && !(srv.messagesBySession[s.sessionId] ?? []).length) continue;
          const project = srv.projectLabel(path);
          out.set(`${scid}:${s.sessionId}`, { cid: scid, id: s.sessionId, title: sessionTitle(s), project, updatedAt: s.updatedAt, archived: !!s.archived });
        }
      }
    }
    return [...out.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  const shownChats = $derived(
    searching ? chats : chats.filter((c) => !c.archived && !(c.cid === cid && c.id === sessionId)).slice(0, 8),
  );
  const allProjects = $derived(
    Object.entries(app.servers)
      .filter(([scid]) => !picking || scid === picking.connectionId)
      .flatMap(([scid, srv]) =>
      srv.recentProjects.map((path) => ({
        cid: scid,
        path,
        label: srv.projectName(path),
        icon: srv.connectionMode === "local" ? ("folder" as const) : ("cloud" as const),
      })),
    ),
  );

  function openChat(c: string, id: string) {
    run(() => openChatSession(c, id));
  }

  function addProject() {
    const c = cid;
    if (!c) return;
    void browseAndAddProject(c).then((p) => p && selectProject(p.connectionId, p.path));
  }

  // ---- servers pages ----

  // serverRows() reads localStorage, which isn't reactive; bump after
  // forgetting one so the list re-derives.
  let rowsVersion = $state(0);
  const rows = $derived.by(() => {
    void rowsVersion;
    return page.kind === "servers" || page.kind === "server" ? serverRows() : [];
  });
  const openRow = $derived(page.kind === "server" ? rows.find((r) => r.key === page.key) : undefined);

  const STATUS_LABEL: Record<ServerRow["status"], string> = {
    connected: "Connected",
    connecting: "Connecting…",
    disconnected: "Disconnected",
    error: "Error",
  };

  function primaryLabel(r: ServerRow): string {
    if (r.status === "connecting") return "Connecting…";
    return r.connectionId ? "Reconnect" : "Connect";
  }

  function removeRow(r: ServerRow) {
    if (r.connectionId) void removeServer(r.connectionId);
    else if (r.known) forgetKnownServer(r.known.serverId);
    rowsVersion++;
    back();
  }

  const serverActions = $derived.by((): Action[] => {
    const r = openRow;
    if (!r) return [];
    // Connected servers are all equally live, nothing to "switch to".
    const list: Action[] =
      r.status === "connected"
        ? []
        : [{ id: "srv:primary", label: primaryLabel(r), icon: "log-in", run: () => run(() => void connectServerRow(r)) }];
    const id = r.connectionId;
    if (id && (r.status === "connected" || r.status === "connecting")) {
      list.push({ id: "srv:disconnect", label: "Disconnect", icon: "xmark", run: () => run(() => void disconnect(id)) });
    }
    list.push({
      id: "srv:remove",
      label: id ? "Remove" : "Forget",
      detail: id ? "Disconnect and stop offering it" : "Stops offering it",
      icon: "trash",
      run: () => removeRow(r),
    });
    return list;
  });

  const placeholder = $derived(
    page.kind === "browse"
      ? "Filter, or type a path (Projects/app, ~/src, /srv)…"
      : page.kind === "projects"
        ? "Search projects…"
        : page.kind === "servers"
          ? "Search servers…"
          : page.kind === "server"
            ? "Search actions…"
            : "Search actions, chats and projects…",
  );
</script>

{#snippet actionItem(a: Action)}
  <Command.Item value={a.id} keywords={[a.label, a.detail ?? ""]} onSelect={a.run} class="palette-item">
    <Icon name={a.icon} size={14} />
    <span class="label">{a.label}</span>
    {#if a.detail}<span class="detail">{a.detail}</span>{/if}
    {#if a.keys}<span class="keys"><Kbd id={a.keys} /></span>{/if}
    {#if a.submenu}<span class="chevron"><Icon name="chevron-right" size={13} /></span>{/if}
  </Command.Item>
{/snippet}

{#snippet group(heading: string, actions: Action[])}
  {#if actions.length}
    <Command.Group>
      <Command.GroupHeading class="palette-heading">{heading}</Command.GroupHeading>
      <Command.GroupItems>
        {#each actions as a (a.id)}{@render actionItem(a)}{/each}
      </Command.GroupItems>
    </Command.Group>
  {/if}
{/snippet}

<Dialog.Root bind:open={app.paletteOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="palette-overlay" />
    <Dialog.Content
      class="palette-content"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        focusForPage();
      }}
      onEscapeKeydown={(e) => {
        if (stack.length > 1) {
          e.preventDefault();
          back();
        }
      }}
    >
      <Dialog.Title class="sr-only">Command palette</Dialog.Title>
      <Command.Root bind:value={highlighted} loop class="palette" label="Command palette">
        <div class="input-row">
          {#if stack.length > 1}
            <button type="button" class="crumb" onclick={back} {@attach tip("Back", "Backspace")}>
              <Icon name="chevron-left" size={13} />
            </button>
          {/if}
          {#if page.kind === "browse" && browsingServer && browsableServers.length > 1}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class="crumb server-switch" {@attach tip(`Switch server (browsing ${browsingServer.label})`)}>
                <ServerAvatar name={browsingServer.label} seed={browsingServer.serverId} size={14} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="context-menu" align="start" sideOffset={4}>
                  {#each browsableServers as [scid, srv] (scid)}
                    <DropdownMenu.Item class="context-menu-item" onSelect={() => browseServer(scid)}>
                      <ServerAvatar name={srv.label} seed={srv.serverId} size={13} />
                      <span>{srv.label}</span>
                      {#if scid === app.browsingConnectionId}<Icon name="check" size={11} />{/if}
                    </DropdownMenu.Item>
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          {/if}
          {#if page.kind === "browse"}
            <span class="crumb-label" {@attach tip(listing?.path)}><bdi>{listing?.path ?? "…"}</bdi></span>
          {:else if page.kind === "projects"}
            <span class="crumb-label"><bdi>{picking?.title ?? "New session in"}</bdi></span>
          {:else if page.kind === "servers"}
            <span class="crumb-label"><bdi>Servers</bdi></span>
          {:else if page.kind === "server"}
            <span class="crumb-label"><bdi>{openRow?.label ?? "Server"}</bdi></span>
          {:else}
            <Icon name="search" size={14} />
          {/if}
          <Command.Input bind:ref={inputEl} bind:value={search} onkeydown={onKeydown} {placeholder} />
          {#if page.kind === "browse"}
            <button
              type="button"
              class="select-btn"
              disabled={!canPick}
              onclick={() => listing && pickDir(listing.path)}
              {@attach tip("Use the open folder")}
            >
              Select <kbd>Ctrl</kbd><kbd>↵</kbd>
            </button>
          {/if}
        </div>
        <Command.List class="palette-list">
          <Command.Viewport>
            <Command.Empty class="palette-empty">
              {#if page.kind === "browse" && listing?.error}
                {listing.error}
              {:else if page.kind === "browse" && !listing}
                Loading…
              {:else}
                No results
              {/if}
            </Command.Empty>

            {#if page.kind === "root"}
              {#if app.showSettings}
                {@render group("Settings", settingsActions)}
              {:else}
                {@render group("This chat", chatActions)}
              {/if}
              {@render group("Start", startActions)}
              {#if shownChats.length}
                <Command.Group>
                  <Command.GroupHeading class="palette-heading">{searching ? "Chats" : "Recent chats"}</Command.GroupHeading>
                  <Command.GroupItems>
                    {#each shownChats as c (c.cid + c.id)}
                      <Command.Item
                        value={`chat:${c.cid}:${c.id}`}
                        keywords={[c.title, c.project]}
                        onSelect={() => openChat(c.cid, c.id)}
                        class="palette-item"
                      >
                        <Icon name={c.archived ? "archive" : "message-circle"} size={14} />
                        <span class="label">{c.title}</span>
                        <span class="detail">{c.project} · {relTime(c.updatedAt)}</span>
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>
              {/if}
              {#if searching}
                {#if allProjects.length}
                  <Command.Group>
                    <Command.GroupHeading class="palette-heading">Projects</Command.GroupHeading>
                    <Command.GroupItems>
                      {#each allProjects as p (p.cid + p.path)}
                        <Command.Item
                          value={`proj:${p.cid}:${p.path}`}
                          keywords={[p.label, p.path]}
                          onSelect={() =>
                            run(() => {
                              const from = app.active;
                              app.activeConnectionId = p.cid;
                              selectProject(p.cid, p.path);
                              if (app.active) carryBlankChat(from, app.active);
                            })}
                          class="palette-item"
                        >
                          <Icon name={p.icon} size={14} />
                          <span class="label">{p.label}</span>
                          <span class="detail">{p.path}</span>
                        </Command.Item>
                      {/each}
                    </Command.GroupItems>
                  </Command.Group>
                {/if}
                {@render group("View", viewActions)}
                {#if !app.showSettings}{@render group("Settings", settingsActions)}{/if}
              {/if}
            {:else if page.kind === "projects"}
              {#each allProjects as p (p.cid + p.path)}
                <Command.Item
                  value={`proj:${p.cid}:${p.path}`}
                  keywords={[p.label, p.path]}
                  onSelect={() => {
                    const pk = picking;
                    run(() => (pk ? pk.run(p.path) : void newChat(p.cid, p.path)));
                  }}
                  class="palette-item"
                >
                  <Icon name={p.icon} size={14} />
                  <span class="label">{p.label}</span>
                  <span class="detail">{p.path}</span>
                </Command.Item>
              {/each}
              {#if !picking}
                <Command.Item value="start:add-project" keywords={["Add project"]} onSelect={addProject} class="palette-item">
                  <Icon name="folder-plus" size={14} />
                  <span class="label">Add project…</span>
                  <span class="chevron"><Icon name="chevron-right" size={13} /></span>
                </Command.Item>
              {/if}
            {:else if page.kind === "servers"}
              <Command.Item value="add-server" keywords={["Add server", "connect", "pair"]} onSelect={() => run(() => app.openAddServer())} class="palette-item">
                <Icon name="plus" size={14} />
                <span class="label">Add server…</span>
                <span class="detail">Settings</span>
              </Command.Item>
              {#each rows as r (r.key)}
                <Command.Item
                  value={`srv:${r.key}`}
                  keywords={[r.label, r.address]}
                  onSelect={() =>
                    r.status === "connected" ? push({ kind: "server", key: r.key }) : run(() => void connectServerRow(r))}
                  class="palette-item"
                >
                  <ServerAvatar name={r.label} seed={r.seed} size={16} />
                  <span class="label">{r.label}</span>
                  <span class="status-dot {r.status}" {@attach tip(STATUS_LABEL[r.status])}></span>
                  <span class="detail">{r.address}</span>
                  <span class="chevron"><Icon name="chevron-right" size={13} /></span>
                </Command.Item>
              {/each}
            {:else if page.kind === "server"}
              {#if openRow}
                <Command.Group>
                  <Command.GroupHeading class="palette-heading">
                    {openRow.address} · {STATUS_LABEL[openRow.status]}
                  </Command.GroupHeading>
                  <Command.GroupItems>
                    {#each serverActions as a (a.id)}{@render actionItem(a)}{/each}
                  </Command.GroupItems>
                </Command.Group>
              {/if}
            {:else if listing && !listing.error}
              {#if typedPath}
                <Command.Item value="goto" forceMount onSelect={() => openDir(typedPath)} class="palette-item">
                  <Icon name="corner-up-left" size={14} />
                  <span class="label">Go to</span>
                  <span class="detail path">{typedPath}</span>
                </Command.Item>
              {/if}
              {#if listing.path !== "/"}
                <Command.Item value="parent" keywords={[".."]} onSelect={() => openDir(resolveTyped("..", listing.path))} class="palette-item">
                  <Icon name="chevron-up" size={14} />
                  <span class="label dim">..</span>
                </Command.Item>
              {/if}
              {#each folders as entry (entry.name)}
                <Command.Item
                  value={`dir:${entry.name}`}
                  keywords={[entry.name]}
                  onSelect={() => openDir(childPath(listing.path, entry.name))}
                  class="palette-item"
                >
                  <Icon name="folder" size={14} />
                  <span class="label">{entry.name}</span>
                </Command.Item>
              {/each}
            {/if}
          </Command.Viewport>
        </Command.List>
        <div class="footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> {page.kind === "browse" ? "open" : page.kind === "servers" ? "open" : "run"}</span>
          {#if page.kind === "browse"}<span><kbd>Ctrl</kbd><kbd>↵</kbd> select open folder</span>{/if}
          {#if page.kind === "servers"}<span><kbd>Tab</kbd> actions</span>{/if}
          {#if stack.length > 1}<span><kbd>⌫</kbd> back</span>{/if}
          <span class="right"><kbd>Esc</kbd> close</span>
        </div>
      </Command.Root>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.palette-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(6, 7, 11, 0.4);
    z-index: var(--z-overlay-backdrop);
    animation: scrimIn var(--dialog-enter-duration) ease-out;
  }
  :global(.palette-content) {
    position: fixed;
    top: 14vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(40rem, 92vw);
    /* A floating surface, see the --float-* tokens in app.css. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay-content);
    overflow: hidden;
  }
  :global(.sr-only) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    padding: 0.57rem 0.57rem 0.57rem 0.86rem;
    border-bottom: 1px solid var(--panel-border);
    color: var(--text-dim);
  }
  .input-row :global(input) {
    flex: 1;
    min-width: 0;
    height: 1.71rem;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 0.93rem;
    padding: 0;
  }
  .input-row :global(.crumb.server-switch) {
    padding: 0;
  }
  .input-row :global(.crumb) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.57rem;
    height: 1.57rem;
    flex-shrink: 0;
    margin-left: -0.29rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .crumb-label {
    flex-shrink: 1;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl; /* keep the end of a long path visible */
    text-align: left;
    font-family: var(--code-font-family);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  /* Same dot as TerminalPanel's tab status. */
  .status-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.6;
  }
  .status-dot.connected {
    background: var(--success);
    opacity: 1;
  }
  .status-dot.connecting {
    background: var(--warning);
    opacity: 1;
  }
  .status-dot.error {
    background: var(--danger);
    opacity: 1;
  }
  .select-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
    height: 1.71rem;
    padding: 0 0.5rem 0 0.64rem;
    background: var(--accent);
    color: #0d1020;
    font-weight: 600;
    font-size: var(--text-label-size);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .select-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .select-btn kbd {
    border-color: rgba(13, 16, 32, 0.3);
    color: rgba(13, 16, 32, 0.75);
    font-weight: 500;
  }
  :global(.palette-list) {
    max-height: min(26rem, 55vh);
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 0.29rem 0.36rem 0.43rem;
  }
  /* Same small-caps label as Settings' tab groups, for one visual language. */
  :global(.palette-heading) {
    padding: 0.71rem 0.57rem 0.29rem;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    opacity: 0.75;
  }
  :global(.palette-item) {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.64rem;
    padding: 0.46rem 0.57rem;
    border-radius: var(--radius-sm);
    font-size: 0.86rem;
    color: var(--text);
    cursor: pointer;
  }
  :global(.palette-item .icon) {
    color: var(--text-dim);
  }
  :global(.palette-item[data-selected]) {
    background: var(--sidebar-hover);
  }
  :global(.palette-item[data-selected] .icon) {
    color: var(--accent);
  }
  :global(.palette-item) .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  :global(.palette-item) .label.dim {
    color: var(--text-dim);
  }
  :global(.palette-item) .detail {
    flex: 1;
    min-width: 4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  :global(.palette-item) .chevron {
    margin-left: auto;
    display: inline-flex;
  }
  :global(.palette-item) .keys {
    margin-left: auto;
    display: inline-flex;
  }
  :global(.palette-item) .detail + .keys {
    margin-left: 0;
  }
  :global(.palette-item) .detail + .chevron {
    margin-left: 0;
  }
  :global(.palette-item) .detail.path {
    font-family: var(--code-font-family);
    text-align: left;
  }
  :global(.palette-empty) {
    padding: 1.14rem;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .footer {
    display: flex;
    gap: 0.86rem;
    flex-wrap: wrap;
    padding: 0.43rem 0.86rem;
    border-top: 1px solid var(--panel-border);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .footer .right {
    margin-left: auto;
  }
  kbd {
    font-family: inherit;
    padding: 0 0.29rem;
    margin-right: 0.14rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-xs);
  }

  /* Phone: the footer is all keyboard hints. */
  @media (max-width: 700px) {
    .footer {
      display: none;
    }
  }
</style>

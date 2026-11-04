<script lang="ts">
  // MCP servers and skills, as a page in the chat panel's place (like the usage page): a list on the left
  // and the picked one in full on the right. Both are per server and per project (a repository can add its
  // own), so the picker narrows to a server or one of its projects like the chat sidebar's does. The daemon
  // owns every decision; this lists what it reports and sends the person's choices.
  import { untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { listMcpServers, listSkills } from "../ipc";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { agentLabel, awaitingApproval, filterSkills, serverTarget, STATE_TONE } from "../extensions";
  import type { McpServerStatus, SkillInfo } from "../types";
  import { tip } from "../tooltip.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import PageHeader from "./PageHeader.svelte";
  import McpImport from "./McpImport.svelte";
  import SearchInput from "./SearchInput.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ExtIcon from "./extensions/ExtIcon.svelte";
  import McpDetail from "./extensions/McpDetail.svelte";
  import McpForm from "./extensions/McpForm.svelte";
  import SkillDetail from "./extensions/SkillDetail.svelte";
  import Button from "./ui/Button.svelte";
  import { viewport } from "../viewport.svelte";

  const ALL = "__all__";
  type Ctx = { cid: ConnectionId; srv: ServerState; project: string | undefined };
  type Row =
    | { kind: "mcp"; key: string; ctx: Ctx; s: McpServerStatus }
    | { kind: "skill"; key: string; ctx: Ctx; s: SkillInfo };

  const live = $derived((Object.entries(app.servers) as [ConnectionId, ServerState][]).filter(([, s]) => s.connectionStatus === "connected"));
  const multi = $derived(live.length > 1);
  const projectOf = (srv: ServerState) => srv.currentProjectPath ?? srv.recentProjects[0] ?? undefined;

  // Values are "connectionId::path", "server::connectionId" or ALL, as in the chat sidebar's picker.
  const focusItems = $derived([
    ...(multi ? [{ value: ALL, label: "All servers" }] : []),
    ...live.flatMap(([cid, srv]) => {
      const group = multi ? cid : undefined;
      return [
        ...(multi ? [{ value: `server::${cid}`, label: srv.label, group, header: true }] : []),
        ...srv.recentProjects.map((p) => ({ value: `${cid}::${p}`, label: srv.projectName(p), group })),
      ];
    }),
  ]);
  let picked = $state<string | null>(null);
  const focus = $derived.by(() => {
    if (picked && focusItems.some((i) => i.value === picked)) return picked;
    const cid = app.activeConnectionId;
    const p = cid && app.servers[cid] ? projectOf(app.servers[cid]) : undefined;
    if (cid && p && focusItems.some((i) => i.value === `${cid}::${p}`)) return `${cid}::${p}`;
    return multi ? ALL : (focusItems[0]?.value ?? ALL);
  });

  const ctxs = $derived.by((): Ctx[] => {
    if (focus === ALL) return live.map(([cid, srv]) => ({ cid, srv, project: projectOf(srv) }));
    if (focus.startsWith("server::")) {
      const cid = focus.slice(8);
      const srv = app.servers[cid];
      return srv ? [{ cid, srv, project: projectOf(srv) }] : [];
    }
    const i = focus.indexOf("::");
    const cid = focus.slice(0, i);
    const srv = app.servers[cid];
    return srv ? [{ cid, srv, project: focus.slice(i + 2) }] : [];
  });
  const flat = $derived(ctxs.length === 1);
  const focusCid = $derived(focus === ALL ? undefined : ctxs[0]?.cid);
  // Projects of the one server in view (the server itself first, for its default project).
  const projectItems = $derived(focusCid ? focusItems.filter((i) => i.value.startsWith(`${focusCid}::`) || i.value === `server::${focusCid}`).map((i) => (i.value.startsWith("server::") ? { ...i, label: "Default project", header: false, group: undefined } : { ...i, group: undefined })) : []);
  const focusServer = $derived(focus === ALL ? null : (ctxs[0]?.srv ?? null));

  // Ask each server in view about its project; the daemon starts the servers it is allowed to.
  const loadKey = $derived(ctxs.map((c) => `${c.cid}|${c.project ?? ""}`).join("\n"));
  $effect(() => {
    loadKey;
    untrack(() => {
      for (const c of ctxs) {
        if (!c.project) continue;
        listMcpServers(c.cid, c.project, true);
        listSkills(c.cid, c.project);
      }
    });
  });

  let search = $state("");
  const q = $derived(search.trim().toLowerCase());
  const mcpRows = $derived(
    ctxs.flatMap((c): Row[] =>
      (c.project ? (c.srv.mcpByProject[c.project]?.servers ?? []) : [])
        .filter((s) => !q || `${s.name} ${serverTarget(s.config)} ${(s.tools ?? []).map((t) => t.rawName).join(" ")}`.toLowerCase().includes(q))
        .sort((a, b) => Number(!awaitingApproval([a]).length) - Number(!awaitingApproval([b]).length) || a.name.localeCompare(b.name))
        .map((s) => ({ kind: "mcp", key: `${c.cid}|${c.project}|mcp|${s.scope}|${s.name}`, ctx: c, s })),
    ),
  );
  const skillRows = $derived(
    ctxs.flatMap((c): Row[] =>
      filterSkills(c.project ? (c.srv.skillsByProject[c.project]?.skills ?? []) : [], search).map((s) => ({ kind: "skill", key: `${c.cid}|${c.project}|skill|${s.dir}`, ctx: c, s })),
    ),
  );
  const groups = (rows: Row[]) => ctxs.map((c) => ({ ctx: c, rows: rows.filter((r) => r.ctx.cid === c.cid) })).filter((g) => g.rows.length || flat);

  let hidden = $state({ mcp: false, skills: false });

  // What the right side shows: a form or the import list, else the picked row.
  let selKey = $state<string | null>(null);
  let pane = $state<{ mode: "add" | "edit" | "import"; ctx: Ctx; name?: string } | null>(null);
  // Asked for by name from the diagnostics page: select that server once its rows exist.
  $effect(() => {
    const name = app.extensionsFocus;
    const r = name && mcpRows.find((r) => r.s.name === name);
    if (r) {
      selKey = r.key;
      app.extensionsFocus = null;
    }
  });
  const selected = $derived([...mcpRows, ...skillRows].find((r) => r.key === selKey) ?? null);

  function pick(r: Row) {
    selKey = r.key;
    pane = null;
  }
  function open(mode: "add" | "import", ctx: Ctx) {
    selKey = null;
    pane = { mode, ctx };
  }
  function saved(ctx: Ctx, names?: string[]) {
    pane = null;
    if (names?.length) selKey = `${ctx.cid}|${ctx.project}|mcp|user|${names[0]}`;
  }

  // Phone: the list and the picked item are two screens; the top-left toggle (and a swipe right) goes back.
  const inDetail = $derived(!!pane || !!selected);
  const back = () => ((selKey = null), (pane = null));
  // The page slides away over the list, so it keeps showing what was open until it has gone.
  let held = $state<{ sel: typeof selected; pane: typeof pane }>({ sel: null, pane: null });
  $effect(() => {
    if (selected || pane) held = { sel: selected, pane };
  });
  const vs = $derived(selected ?? (viewport.narrow ? held.sel : null));
  const vp = $derived(pane ?? (viewport.narrow && !selected ? held.pane : null));
  const editing = $derived(vp?.mode === "edit" && vp.ctx.project ? vp.ctx.srv.mcpByProject[vp.ctx.project]?.servers.find((s) => s.name === vp!.name && s.scope === "user") : undefined);
  $effect(() => {
    viewport.back = inDetail ? back : null;
    return () => (viewport.back = null);
  });

  const waiting = $derived(ctxs.reduce((n, c) => n + (c.project ? awaitingApproval(c.srv.mcpByProject[c.project]?.servers).length : 0), 0));
  const offline = $derived(!live.length);
  const dotTone = (s: McpServerStatus) => (s.approval === "pending" || s.approval === "changed" ? "warning" : s.approval === "denied" ? "neutral" : STATE_TONE[s.state]);
  const slideDuration = $derived(Math.round(180 * app.settings.animationSpeed));
  const plainText = (t: string) => t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*#>]/g, "");
  const home = (p: string) => p.replace(/^\/home\/[^/]+/, "~");
</script>

{#snippet serverLabel(gcid: string)}
  {@const srv = app.servers[gcid]}
  {#if srv}<ServerAvatar name={srv.label} seed={srv.serverId} size={12} /> {srv.label}{/if}
{/snippet}

{#snippet actions(ctx: Ctx)}
  <span class="acts">
    <button type="button" class="act" disabled={!ctx.project} {@attach tip("Add a server")} aria-label="Add a server" onclick={() => open("add", ctx)}><Icon name="plus" size={13} /></button>
    <button type="button" class="act" disabled={!ctx.project} {@attach tip("Import from other tools")} aria-label="Import servers from other tools" onclick={() => open("import", ctx)}><Icon name="folder-down" size={13} /></button>
  </span>
{/snippet}

{#snippet mcpRow(r: Row & { kind: "mcp" })}
  <button type="button" class="row" class:sel={selKey === r.key} class:off={r.s.state === "disabled"} onclick={() => pick(r)} data-server={r.s.name}>
    <ExtIcon name={r.s.name} hint={serverTarget(r.s.config)} kind="mcp" />
    <span class="text">
      <span class="name">{r.s.name}<i class="dot {dotTone(r.s)}"></i></span>
      <span class="sub">{serverTarget(r.s.config)}</span>
    </span>
  </button>
{/snippet}

{#snippet skillRow(r: Row & { kind: "skill" })}
  <button type="button" class="row" class:sel={selKey === r.key} class:off={!r.s.enabled || r.s.shadowed} onclick={() => pick(r)} data-skill={r.s.name}>
    <ExtIcon name={r.s.name} kind="skill" />
    <span class="text">
      <span class="name">{r.s.name}{#if r.s.scope === "project"}<span class="tag">project</span>{/if}</span>
      <span class="sub plain">{plainText(r.s.description)}</span>
    </span>
  </button>
{/snippet}

<div class="panel" class:sidebar-collapsed={app.sidebarCollapsed} class:detail={inDetail}>
  <PageHeader icon="plug-connected" items={multi ? [{ value: ALL, label: "All servers" }, ...live.map(([cid, srv]) => ({ value: cid, label: srv.label }))] : []} value={focus === ALL ? ALL : (focusCid ?? ALL)} onchange={(v) => v && (picked = v === ALL ? ALL : `server::${v}`)} server={focusServer} triggerTitle="Which server to show" sub={{ items: projectItems, value: focus, onchange: (v) => v && (picked = v), title: "Which project to show", searchable: projectItems.length > 6 }}>
    Extensions
  </PageHeader>

  <div class="body">
    <nav class="list" aria-label="MCP servers and skills">
      <div class="list-head">
        <SearchInput boxed bind:value={search} placeholder="Search servers and skills…" />
      </div>

      <div class="scroll">
        {#if offline}
          <p class="empty">No server connected. Connect one to see its MCP servers and skills.</p>
        {:else}
          <section>
            <div class="sec-head">
              <button type="button" class="sec-toggle" aria-expanded={!hidden.mcp} onclick={() => (hidden.mcp = !hidden.mcp)}>
                <span class="chev" class:open={q || !hidden.mcp}><Icon name="chevron-right" size={11} /></span>
                MCP servers <span class="count">{mcpRows.length}</span>
                {#if waiting}<span class="pip" role="img" aria-label="{waiting} waiting for approval"></span>{/if}
              </button>
              {#if flat && ctxs[0]}{@render actions(ctxs[0])}{/if}
            </div>
            {#if q || !hidden.mcp}
              <div class="rows" transition:slide={{ duration: slideDuration }}>
              {#each groups(mcpRows) as g (g.ctx.cid)}
                {#if !flat}
                  <div class="grp">{@render serverLabel(g.ctx.cid)}{@render actions(g.ctx)}</div>
                {/if}
                {#each g.rows as r (r.key)}{#if r.kind === "mcp"}{@render mcpRow(r)}{/if}{/each}
                {#if !g.rows.length}<p class="none">{q ? "No match" : "None yet"}</p>{/if}
              {/each}
              </div>
            {/if}
          </section>

          <section>
            <div class="sec-head">
              <button type="button" class="sec-toggle" aria-expanded={!hidden.skills} onclick={() => (hidden.skills = !hidden.skills)}>
                <span class="chev" class:open={q || !hidden.skills}><Icon name="chevron-right" size={11} /></span>
                Skills <span class="count">{skillRows.length}</span>
              </button>
            </div>
            {#if q || !hidden.skills}
              <div class="rows" transition:slide={{ duration: slideDuration }}>
              {#each groups(skillRows) as g (g.ctx.cid)}
                {#if !flat}<div class="grp">{@render serverLabel(g.ctx.cid)}</div>{/if}
                {#each g.rows as r (r.key)}{#if r.kind === "skill"}{@render skillRow(r)}{/if}{/each}
                {#if !g.rows.length}<p class="none">{q ? "No match" : "None found"}</p>{/if}
              {/each}
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </nav>

    <div class="pane">
      {#if vp && (vp.mode === "add" || (vp.mode === "edit" && editing))}
        {#key vp.name ?? "add"}
          <div class="narrow"><McpForm cid={vp.ctx.cid} projectPath={vp.ctx.project} connected initial={editing ?? null} onclose={(names) => saved(vp!.ctx, names)} /></div>
        {/key}
      {:else if vp?.mode === "import"}
        <div class="narrow"><McpImport cid={vp.ctx.cid} projectPath={vp.ctx.project} connected onclose={() => (pane = null)} /></div>
      {:else if vs?.kind === "mcp"}
        {#key vs.key}
          <McpDetail
            cid={vs.ctx.cid}
            projectPath={vs.ctx.project}
            s={vs.s}
            connected={vs.ctx.srv.connectionStatus === "connected"}
            onedit={() => (pane = { mode: "edit", ctx: vs!.ctx, name: vs!.s.name })}
            onremoved={() => (selKey = null)}
          />
        {/key}
      {:else if vs?.kind === "skill"}
        {#key vs.key}
          <SkillDetail cid={vs.ctx.cid} projectPath={vs.ctx.project} s={vs.s} connected={vs.ctx.srv.connectionStatus === "connected"} />
        {/key}
      {:else}
        <div class="blank">
          <Icon name="plug-connected" size={28} />
          <h2>MCP servers and skills</h2>
          <p>
            MCP servers give the model tools beyond reading and editing files. Skills are instruction folders it loads when a task fits. Pick one on the left to see it in full.
          </p>
          {#if flat && ctxs[0]?.project}
            <div class="btns">
              <Button onclick={() => open("add", ctxs[0])}><Icon name="plus" size={13} /> Add a server</Button>
              <Button variant="ghost" onclick={() => open("import", ctxs[0])}><Icon name="folder-down" size={13} /> Import from other tools</Button>
            </div>
          {/if}
          {#if flat && ctxs[0]?.project}
            {@const roots = ctxs[0].srv.skillsByProject[ctxs[0].project]?.roots ?? []}
            {#if roots.length}
              <details class="roots">
                <summary>Where skills are looked for</summary>
                <ul>
                  {#each roots as r (r.path)}
                    <li class:missing={!r.exists}><code>{home(r.path)}</code> <span>{r.scope === "project" ? "this project" : "yours"} · {agentLabel(r.source)}{r.exists ? "" : " · not there"}</span></li>
                  {/each}
                </ul>
              </details>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-xl);
    margin: var(--chat-margin) var(--chat-margin) 0 0;
    transition: margin-left calc(0.2s * var(--anim-speed, 1)) ease;
    overflow: hidden;
    color: var(--text);
  }
  .panel.sidebar-collapsed {
    margin-left: var(--chat-margin);
  }
  :global(:root[data-main="flat"]) .panel {
    border-radius: 0;
    border-width: 0 0 0 1px;
  }
  :global(:root[data-main="flat"]) .panel.sidebar-collapsed {
    border-width: 0;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    width: 22rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--panel-border);
  }
  .list-head {
    padding: 0.3rem 0.8rem 0.8rem;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 0 0.5rem 1.5rem;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 1rem;
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.3rem 0.2rem 0.4rem;
  }
  .sec-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0;
    border: none;
    background: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 0.79rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  .sec-toggle:hover {
    color: var(--text);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .chev {
    display: inline-flex;
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .count {
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--sidebar-hover);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }
  .pip {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--warning);
  }
  .acts {
    display: inline-flex;
    gap: 0.1rem;
  }
  .act {
    display: inline-flex;
    padding: 0.3rem;
    border: none;
    border-radius: var(--radius-xs);
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .act:hover:not(:disabled) {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .act:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .grp {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.4rem 0.5rem 0.2rem;
    font-size: 0.79rem;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.6rem 0.6rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--sidebar-hover);
  }
  .row.sel {
    background: var(--sidebar-active, var(--wash-3));
  }
  .row.off > :global(.tile),
  .row.off .text {
    opacity: 0.5;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 0.79rem;
    color: var(--text-dim);
  }
  .sub.plain {
    font-family: inherit;
    font-size: 0.79rem;
  }
  .tag {
    flex-shrink: 0;
    font-size: 0.79rem;
    font-weight: 400;
    color: var(--accent);
  }
  .dot {
    flex-shrink: 0;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.45;
  }
  .dot.success {
    background: var(--success);
    opacity: 1;
  }
  .dot.warning {
    background: var(--warning);
    opacity: 1;
  }
  .dot.danger {
    background: var(--danger);
    opacity: 1;
  }
  .dot.accent {
    background: var(--accent);
    opacity: 1;
  }
  .empty,
  .none {
    margin: 0;
    padding: 0.3rem 0.6rem;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .empty {
    padding: 0.9rem 0.8rem;
  }

  .pane {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 0 2.5rem;
  }
  .narrow {
    max-width: 38rem;
    margin: 0 auto;
    padding: 2rem 0 3rem;
  }
  .blank {
    max-width: 30rem;
    margin: 0 auto;
    padding-top: 12vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    text-align: center;
    color: var(--text-dim);
  }
  .blank h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }
  .blank p {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.55;
  }
  .btns {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .roots {
    margin-top: 1rem;
    align-self: stretch;
    text-align: left;
    font-size: var(--text-label-size);
  }
  .roots ul {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .roots li.missing code {
    opacity: 0.5;
  }
  code {
    font-family: var(--font-mono, monospace);
  }

  @media (max-width: 700px) {
    .panel {
      border-radius: 0;
      border-color: transparent;
      border-block-color: transparent;
    }
    .head {
      padding-right: calc(var(--header-pad-x) + var(--chrome-reserve));
    }
    .list {
      width: 100%;
      border-right: 0;
    }
    /* Two screens in one place: the picked item slides in over the list (which shifts and dims), like a settings page. */
    .body {
      position: relative;
      overflow: hidden;
    }
    .list,
    .pane {
      position: absolute;
      inset: 0;
      transition:
        transform calc(0.34s * var(--anim-speed, 1)) cubic-bezier(0.32, 0.72, 0, 1),
        filter calc(0.34s * var(--anim-speed, 1)) cubic-bezier(0.32, 0.72, 0, 1);
    }
    .panel.detail .list {
      transform: translateX(-24%);
      filter: brightness(0.6);
    }
    .pane {
      padding: 0 1rem;
      touch-action: pan-y;
      background: var(--panel-bg);
      box-shadow: -12px 0 28px -16px rgb(0 0 0 / 0.5);
      transform: translateX(100%);
    }
    .panel.detail .pane {
      transform: none;
    }
    .panel:not(.detail) .pane {
      visibility: hidden;
      transition-property: transform, filter, visibility;
    }
    @media (prefers-reduced-motion: reduce) {
      .list,
      .pane {
        transition: none;
      }
    }
    .narrow {
      padding: 0.8rem 0 calc(var(--safe-bottom) + 2rem);
    }
    .blank {
      padding-top: 4vh;
    }
    .row {
      min-height: 3.2rem;
    }
    .btns {
      flex-direction: column;
      align-self: stretch;
    }
  }
</style>

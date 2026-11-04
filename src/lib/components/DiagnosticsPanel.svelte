<script lang="ts">
  // A task manager per server, as a page in the chat panel's place: the server process and everything it
  // has started (terminals, CLI agents, MCP servers, tool commands), sampled every few seconds while open.
  import { onMount, untrack } from "svelte";
  import { disconnectPeer, listProblems, listProcesses, readLog, signalProcess } from "../ipc";
  import { isPhotoAvatar } from "../avatar";
  import { askConfirm } from "../confirm.svelte";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import type { PeerInfo } from "../types";
  import { kindsOf, treeRows } from "../processes";
  import { STATE_LABEL, STATE_TONE } from "../extensions";
  import type { McpServerStatus, ProcessRow } from "../types";
  import { basename, duration, fileSize, relTime, terminalTitle } from "../format";
  import { tip } from "../tooltip.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import PageHeader from "./PageHeader.svelte";

  const POLL_MS = 2000;
  const HISTORY = 60; // samples kept per server: two minutes of graph

  const live = $derived((Object.entries(app.servers) as [ConnectionId, ServerState][]).filter(([, s]) => s.connectionStatus === "connected"));
  let picked = $state<ConnectionId | null>(app.diagnosticsServer);
  $effect(() => {
    if (app.diagnosticsServer) picked = app.diagnosticsServer;
  });
  const cid = $derived(live.find(([id]) => id === picked)?.[0] ?? live.find(([id]) => id === app.activeConnectionId)?.[0] ?? live[0]?.[0]);
  const srv = $derived(cid ? app.servers[cid] : undefined);
  const items = $derived(live.map(([id, s]) => ({ value: id, label: s.label })));

  // Narrows projects, MCP servers and terminals to one project; "*" is all of them.
  let projectPick = $state("*");
  const projects = $derived(srv?.projects ?? []);
  const project = $derived(projects.includes(projectPick) ? projectPick : "*");
  const projectItems = $derived([{ value: "*", label: "All projects" }, ...projects.map((p) => ({ value: p, label: srv?.projectName(p) ?? p }))]);
  const inProject = (p: string | undefined) => project === "*" || p === project;

  // MCP servers across the server's projects, one row per name and scope.
  const mcpServers = $derived.by(() => {
    const seen = new Map<string, McpServerStatus>();
    for (const [path, d] of Object.entries(srv?.mcpByProject ?? {})) if (inProject(path)) for (const m of d.servers) if (!seen.has(`${m.scope}:${m.name}`)) seen.set(`${m.scope}:${m.name}`, m);
    return [...seen.values()];
  });
  // Their command lines, for spotting MCP servers in the process list.
  const mcpCmds = $derived(mcpServers.flatMap((m) => (m.config.command ? [[m.config.command, ...(m.config.args ?? [])].join(" ")] : [])));
  const terminals = $derived(srv ? Object.values(srv.terminalById).filter((t) => (t.status === "starting" || t.status === "running") && inProject(srv.projectBySession[t.sessionId])) : []);

  // One row per project: its chats, MCP servers (and how many are down) and open terminals.
  const projectRows = $derived(
    srv
      ? projects.filter(inProject).map((path) => {
          const mcp = srv.mcpByProject[path]?.servers ?? [];
          return {
            path,
            name: srv.projectName(path),
            chats: srv.sessionsByProject[path]?.length ?? 0,
            mcp: mcp.length,
            down: mcp.filter((m) => m.state === "failed" || m.state === "needs_auth").length,
            terminals: Object.values(srv.terminalById).filter((t) => (t.status === "starting" || t.status === "running") && srv.projectBySession[t.sessionId] === path).length,
          };
        })
      : [],
  );

  // Failures grouped by cause, among the ones the server kept.
  function failureGroups(list: { tool: string; cause: string; atMs: number }[]) {
    const g = new Map<string, { cause: string; count: number; tools: Set<string>; atMs: number }>();
    for (const f of list) {
      const e = g.get(f.cause) ?? { cause: f.cause, count: 0, tools: new Set<string>(), atMs: 0 };
      e.count++;
      e.tools.add(f.tool);
      e.atMs = Math.max(e.atMs, f.atMs);
      g.set(f.cause, e);
    }
    return [...g.values()].sort((a, b) => b.count - a.count || b.atMs - a.atMs);
  }

  // Manual refresh: processes and problems are sampled now, and the buttons spin until the answer's newer.
  function refresh() {
    if (!cid) return;
    listProcesses(cid);
    listProblems(cid);
  }
  const checked = (ms: number | undefined) => (ms ? relTime(ms, app.now) : "–");
  const KIND_ICON = { Server: "server", Agent: "robot", MCP: "plug-connected", Terminal: "terminal-2", Subprocess: "bolt" } as const;
  const KIND_TONE = { Server: "neutral", Agent: "neutral", MCP: "neutral", Terminal: "neutral", Subprocess: "neutral" } as const;

  // Processes every poll; problems every fifth (10 s). Both are local-socket only (see `waited`).
  let tick = 0;
  onMount(() => {
    const poll = () => {
      if (document.hidden) return;
      live.forEach(([id]) => {
        listProcesses(id);
        if (tick % 5 === 0) listProblems(id);
      });
      tick++;
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  });

  // The process list is local-socket only (SPEC §3.1): a remote never answers, so say so after a few seconds.
  let waited = $state(false);
  onMount(() => {
    const t = setTimeout(() => (waited = true), 6000);
    return () => clearTimeout(t);
  });

  // Host figures from each server's heartbeat (answered over any connection), kept as rolling series.
  type Host = { load: number[]; mem: number[]; heap: number[] };
  let host = $state<Record<string, Host>>({});
  $effect(() => {
    for (const [id, s] of live) {
      const st = s.serverStatus;
      if (!st) continue;
      untrack(() => {
        const h = host[id] ?? { load: [], mem: [], heap: [] };
        const memUsed = st.memTotalBytes != null && st.memAvailBytes != null ? st.memTotalBytes - st.memAvailBytes : 0;
        host[id] = {
          load: [...h.load, st.load1 != null && st.cpus ? (st.load1 / st.cpus) * 100 : 0].slice(-HISTORY),
          mem: [...h.mem, memUsed].slice(-HISTORY),
          heap: [...h.heap, st.heapBytes].slice(-HISTORY),
        };
      });
    }
  });

  // Rolling totals per server, appended once per new sample.
  let hist = $state<Record<string, { cpu: number[]; rss: number[] }>>({});
  const seen = new Map<string, number>();
  $effect(() => {
    for (const [id, s] of live) {
      const l = s.processes;
      if (!l || seen.get(id) === l.sampledAtMs) continue;
      seen.set(id, l.sampledAtMs);
      const t = total(treeRows(l));
      untrack(() => {
        const h = hist[id] ?? { cpu: [], rss: [] };
        hist[id] = { cpu: [...h.cpu, t.cpu].slice(-HISTORY), rss: [...h.rss, t.rss].slice(-HISTORY) };
      });
    }
  });

  // Collapsed rows are remembered per row key ("pid:startTime"), shared across servers since pids differ.
  let collapsed = $state(new Set<string>());
  function toggle(key: string) {
    const n = new Set(collapsed);
    n.delete(key) || n.add(key);
    collapsed = n;
  }
  const total = (rows: { cpuPercent?: number; rssBytes: number }[]) => ({
    cpu: rows.reduce((a, r) => a + (r.cpuPercent ?? 0), 0),
    rss: rows.reduce((a, r) => a + r.rssBytes, 0),
  });

  // null sort = the process tree; a column = a flat list ordered by it.
  type SortKey = "name" | "cpu" | "rss" | "pid";
  let sort = $state<{ key: SortKey; desc: boolean } | null>(null);
  function setSort(key: SortKey) {
    sort = sort?.key === key ? (sort.desc === (key !== "name") ? { key, desc: !sort.desc } : null) : { key, desc: key !== "name" };
  }
  const val = (r: ProcessRow, k: SortKey) => (k === "name" ? r.name.toLowerCase() : k === "cpu" ? (r.cpuPercent ?? 0) : k === "rss" ? r.rssBytes : r.pid);
  function rowsOf(list: NonNullable<ServerState["processes"]>): ProcessRow[] {
    if (!sort) return treeRows(list, collapsed);
    const { key, desc } = sort;
    return treeRows(list)
      .map((r) => ({ ...r, depth: 0, hasChildren: false }))
      .sort((a, b) => (val(a, key) < val(b, key) ? -1 : val(a, key) > val(b, key) ? 1 : 0) * (desc ? -1 : 1));
  }

  // Each signal stays in flight until its process_signaled answer, or 6 s for a server that never sends one.
  async function signal(id: ConnectionId, pid: number, sig: "SIGINT" | "SIGKILL") {
    if (sig === "SIGKILL" && !(await askConfirm(`Send SIGKILL to process ${pid}? It can't handle this signal.`))) return;
    const s = app.servers[id];
    if (!s) return;
    s.signaling = [...s.signaling, pid];
    signalProcess(id, pid, sig);
    setTimeout(() => (s.signaling = s.signaling.filter((p) => p !== pid)), 6000);
  }

  const DEVICE = { desktop: "laptop", web: "world", server: "server" } as const;
  async function kick(id: ConnectionId, p: PeerInfo) {
    if (await askConfirm(`Disconnect "${p.name || "Unnamed"}" from this server?`)) disconnectPeer(id, p.peerId);
  }

  function uptime(ms: number) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "<1m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
  }
  const since = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "–" : uptime(app.now - Date.parse(iso)));

  // Polyline points for a series scaled to `max` (at least `floor`, so an idle server stays flat, not full-height).
  function points(v: number[], floor: number) {
    const max = Math.max(floor, ...v);
    return v.map((y, i) => `${((i / (HISTORY - 1)) * 100 + (100 * (HISTORY - v.length)) / (HISTORY - 1)).toFixed(1)},${(30 - (y / max) * 28).toFixed(1)}`).join(" ");
  }
</script>

{#snippet empty(icon: string, text: string)}
  <div class="empty"><Icon name={icon as any} size={18} /><span>{text}</span></div>
{/snippet}

{#snippet stat(icon: string, label: string, value: string, tone: "default" | "warning" | "danger" = "default", hint = "")}
  <div class="stat {tone}" {@attach tip(hint)}>
    <span class="k">{label}</span>
    <span class="v">{value}</span>
  </div>
{/snippet}

{#snippet head(icon: string, title: string, count?: string | number, extra?: import("svelte").Snippet)}
  <header class="sec-head">
    <span class="chip"><Icon name={icon as any} size={14} /></span>
    <h2>{title}</h2>
    {#if count !== undefined}<span class="count">{count}</span>{/if}
    <span class="grow"></span>
    {@render extra?.()}
  </header>
{/snippet}

{#snippet graph(icon: string, color: string, title: string, value: string, sub: string, v: number[], floor: number)}
  <div class="graph" style="--c: {color}">
    <div class="g-top">
      <span class="k"><Icon name={icon as any} size={12} />{title}</span>
    </div>
    <span class="v big">{value}</span>
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true">
      {#if v.length > 1}
        <polygon points="{points(v, floor)} 100,30 {100 - (100 * (v.length - 1)) / (HISTORY - 1)},30" />
        <polyline points={points(v, floor)} />
      {/if}
    </svg>
    <span class="sub">{sub}</span>
  </div>
{/snippet}

{#snippet th(key: SortKey, label: string, cls = "")}
  <th class={cls} aria-sort={sort?.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
    <button type="button" class="sort" onclick={() => setSort(key)}>
      {label}{#if sort?.key === key}<Icon name={sort.desc ? "chevron-down" : "chevron-up"} size={11} />{/if}
    </button>
  </th>
{/snippet}

<div class="panel" class:sidebar-collapsed={app.sidebarCollapsed}>
  <PageHeader icon="activity" {items} value={cid} onchange={(v) => (picked = (v as ConnectionId) ?? null)} server={srv} triggerTitle="Which server to inspect" sub={{ items: projectItems, value: project, onchange: (v) => (projectPick = v ?? "*"), title: "Narrow projects, MCP servers and terminals to one project" }}>
    Diagnostics
    {#snippet controls()}
      <Button variant="ghost" size="sm" onclick={refresh}><Icon name="refresh" size={13} /> Refresh</Button>
    {/snippet}
  </PageHeader>
  <!-- Dragging a table's resize handle sets an inline height; lift the max-height cap so it can grow past it. -->
  <div
    class="body"
    onpointerup={(e) => {
      const el = e.target as HTMLElement;
      if (el.classList?.contains("scroll") && el.style.height) el.style.maxHeight = "none";
    }}
  >
    {#if cid && srv}
      {@const list = srv.processes}
      {@const all = list ? treeRows(list) : []}
      {@const kinds = kindsOf(all, mcpCmds)}
      {@const sum = total(all)}
      {@const count = (k: string) => [...kinds.values()].filter((v) => v === k).length}
      {@const h = hist[cid]}
      {@const st = srv.serverStatus}
      {@const hh = host[cid]}
      {@const pr = srv.problems}
      <section class="card">
        {@render head("server", "Server")}
        {#if st}
          {@const memUsed = st.memTotalBytes != null && st.memAvailBytes != null ? st.memTotalBytes - st.memAvailBytes : null}
          {@const cpuPct = st.load1 != null && st.cpus ? Math.round((st.load1 / st.cpus) * 100) : null}
          <div class="stats">
            {@render stat("clock", "Uptime", uptime(st.uptimeSec * 1000))}
            {@render stat("tag", "Version", st.version || "–")}
            {@render stat("player-play", "Active turns", String(st.activeTurns), "default", st.queuedTurns ? `${st.queuedTurns} more waiting for a slot` : "")}
            {@render stat("devices", "Clients", String(st.peers))}
            {@render stat("folder", "Open projects", String(st.openProjects))}
            {#if st.spend}{@render stat("coin", "Spend today", `$${st.spend.todayUsd.toFixed(2)}`, "default", `$${st.spend.monthUsd.toFixed(2)} this month`)}{/if}
          </div>
          <div class="graphs">
            {@render graph("cpu", "var(--accent)", "CPU load", cpuPct != null ? `${cpuPct}%` : "–", `${st.load1?.toFixed(2) ?? "–"} load · ${st.cpus} cores`, hh?.load ?? [], 100)}
            {@render graph("database", "var(--accent)", "Memory", memUsed != null ? fileSize(memUsed) : "–", st.memTotalBytes ? `of ${fileSize(st.memTotalBytes)}` : "", hh?.mem ?? [], st.memTotalBytes ?? 1)}
            {@render graph("gauge", "var(--accent)", "yoakeland heap", fileSize(st.heapBytes), "Go runtime", hh?.heap ?? [], 64 * 1024 * 1024)}
            {#if list && all.length}
              {@render graph("activity", "var(--accent)", "Process memory", fileSize(sum.rss), `${sum.cpu.toFixed(1)}% CPU · ${all.length} ${all.length === 1 ? "process" : "processes"}`, h?.rss ?? [], 64 * 1024 * 1024)}
            {/if}
          </div>
        {:else}
          {@render empty("clock", "Waiting for the server's first status…")}
        {/if}
      </section>

      {#snippet refreshed(at: number | undefined)}
        <span class="dim small" {@attach tip(at ? new Date(at).toLocaleString() : "")}>Checked {checked(at)}</span>
      {/snippet}
      <section class="card">
        {@render head("activity", "Live processes", list && all.length ? all.length : undefined)}
        {#if !list}
          {@render empty("lock", waited ? "This server doesn't share its process list: it is only offered over the local socket, since command lines can hold secrets." : "Sampling…")}
        {:else if !all.length}
          {@render empty("info-circle", "This server can't report its processes on this platform.")}
        {:else}
          <div class="stats">
            {@render stat("bolt", "Child processes", String(all.length - 1))}
            {@render stat("cpu", "CPU", `${sum.cpu.toFixed(1)}%`, "default", "Across the server and everything it started. 100% is one full core.")}
            {@render stat("database", "Memory", fileSize(sum.rss), "default", "Resident memory across the server and everything it started.")}
            {@render stat("robot", "Agents", String(count("Agent")))}
            {@render stat("plug-connected", "MCP servers", String(count("MCP")))}
            {@render stat("terminal-2", "Terminals", String(count("Terminal")))}
          </div>
          <div class="scroll tall">
            <table class="proc">
              <thead>
                <tr>
                  {@render th("name", "Process")}
                  <th class="s">Type</th>
                  <th class="s">Status</th>
                  {@render th("cpu", "CPU", "n")}
                  {@render th("rss", "Memory", "n m")}
                  {@render th("pid", "PID", "n p")}
                  <th class="act"></th>
                </tr>
              </thead>
              <tbody>
                {#each rowsOf(list) as r (r.key)}
                  {@const kind = kinds.get(r.key) ?? "Subprocess"}
                  {@const busy = srv.signaling.includes(r.pid)}
                  <tr>
                    <td style="padding-left: {Math.min(r.depth, 8) * 14 + 12}px">
                      <span class="name">
                        {#if r.hasChildren}
                          <button type="button" class="chev" aria-label={collapsed.has(r.key) ? "Expand" : "Collapse"} onclick={() => toggle(r.key)}>
                            <Icon name={collapsed.has(r.key) ? "chevron-right" : "chevron-down"} size={12} />
                          </button>
                        {:else if !sort}<span class="chev"></span>{/if}
                        <span class="kind-icon"><Icon name={KIND_ICON[kind]} size={13} /></span>
                        <span class="label" {@attach tip(r.command || r.name)}>{r.name}</span>
                      </span>
                    </td>
                    <td class="s"><Badge tone={KIND_TONE[kind]}>{kind}</Badge></td>
                    <td class="s dim">{({ R: "Running", S: "Idle", D: "Blocked", Z: "Zombie", T: "Stopped" } as Record<string, string>)[r.status] ?? r.status}</td>
                    <td class="n bar" style="--p: {Math.min(100, r.cpuPercent ?? 0)}%"><span>{(r.cpuPercent ?? 0).toFixed(1)}%</span></td>
                    <td class="n bar m" style="--p: {(r.rssBytes / Math.max(1, sum.rss)) * 100}%"><span>{fileSize(r.rssBytes)}</span></td>
                    <td class="n p dim">{r.pid}</td>
                    <td class="act">
                      {#if kind !== "Server"}
                        <button type="button" class="kill" disabled={busy} onclick={() => signal(cid, r.pid, "SIGINT")}>Interrupt</button>
                        <button type="button" class="kill danger" disabled={busy} onclick={() => signal(cid, r.pid, "SIGKILL")}>Kill</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <div class="pair">
        <section class="card">
          {#snippet manageProjects()}
            <Button variant="ghost" size="sm" onclick={() => app.openSettingsTab("projects")}><Icon name="settings" size={13} /> Manage</Button>
          {/snippet}
          {@render head("folder", "Projects", projectRows.length || undefined, manageProjects)}
          {#if projectRows.length}
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Project</th><th class="n">Chats</th><th class="n">MCP</th><th class="n">Terminals</th></tr>
                </thead>
                <tbody>
                  {#each projectRows as p (p.path)}
                    <tr>
                      <td class="pad-l"><span class="label" {@attach tip(p.path)}>{p.name}</span></td>
                      <td class="n dim">{p.chats}</td>
                      <td class="n" {@attach tip(p.down ? `${p.down} not connected` : "")}>{p.mcp ? (p.down ? `${p.mcp - p.down}/${p.mcp}` : p.mcp) : "–"}</td>
                      <td class="n dim">{p.terminals || "–"}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            {@render empty("folder", "No projects on this server.")}
          {/if}
        </section>


        <section class="card">
          {#snippet manageAccess()}
            <Button variant="ghost" size="sm" onclick={() => app.openSettingsTab("access")}><Icon name="settings" size={13} /> Manage</Button>
          {/snippet}
          {@render head("devices", "Clients", srv.peers.length || undefined, manageAccess)}
          {#if srv.peers.length}
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Client</th><th>Address</th><th class="n">Connected</th><th class="act"></th></tr>
                </thead>
                <tbody>
                  {#each srv.peers as p (p.peerId)}
                    {@const you = p.peerId === srv.selfPeerId}
                    <tr class:self={you}>
                      <td class="pad-l">
                        <span class="client">
                          <span class="avatar">
                            {#if isPhotoAvatar(p.avatar ?? "")}<img src={p.avatar} alt="" />{:else}<Icon name={DEVICE[p.deviceType] ?? "user"} size={15} />{/if}
                          </span>
                          <span class="who">
                            <span class="who-name"><span class="label">{p.name || "Unnamed"}</span>{#if you}<Badge tone="accent">You</Badge>{/if}</span>
                            <span class="dim small">{p.deviceType}</span>
                          </span>
                        </span>
                      </td>
                      <td class="dim">{p.ip || "–"}</td>
                      <td class="n dim">{since(p.connectedAt)}</td>
                      <td class="act">
                        {#if !you && cid}
                          <button type="button" class="kill danger" onclick={() => kick(cid, p)}>Kick</button>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            {@render empty("devices", "No clients connected.")}
          {/if}
        </section>

        <section class="card">
          {#snippet manageExtensions()}
            <Button variant="ghost" size="sm" onclick={() => app.openExtensions()}><Icon name="settings" size={13} /> Manage</Button>
          {/snippet}
          {@render head("plug-connected", "MCP servers", mcpServers.length || undefined, manageExtensions)}
          {#if mcpServers.length}
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Name</th><th class="s">Scope</th><th>State</th><th class="act"></th></tr>
                </thead>
                <tbody>
                  {#each mcpServers as m (`${m.scope}:${m.name}`)}
                    <tr>
                      <td class="pad-l"><span class="label">{m.name}</span></td>
                      <td class="s dim">{m.scope}</td>
                      <td><span {@attach tip(m.error)}><Badge tone={STATE_TONE[m.state]} dot>{STATE_LABEL[m.state]}</Badge></span></td>
                      <td class="act"><button type="button" class="kill" onclick={() => app.openExtensions(m.name)}>Open</button></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            {@render empty("plug-connected", `No MCP servers reported${project === "*" ? " yet" : " for this project"}.`)}
          {/if}
        </section>

        <section class="card">
          {@render head("terminal-2", "Terminals", terminals.length || undefined)}
          {#if terminals.length}
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Name</th><th>Directory</th><th class="s">Started by</th></tr>
                </thead>
                <tbody>
                  {#each terminals as t (t.terminalId)}
                    <tr>
                      <td class="pad-l"><span class="label">{terminalTitle(t)}</span></td>
                      <td class="dim"><span class="label" {@attach tip(t.cwd ?? "")}>{basename(t.cwd ?? "") || "–"}</span></td>
                      <td class="s"><Badge tone={t.agent ? "accent" : "neutral"}>{t.agent ? "Agent" : "You"}</Badge></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            {@render empty("terminal-2", "No open terminals.")}
          {/if}
        </section>
      </div>

      {#snippet logBtn()}
        {@render refreshed(pr?.readAtMs)}
        <Button variant="ghost" size="sm" {@attach tip("Download the server log (local server only)")} onclick={() => readLog(cid)}><Icon name="file-text" size={13} /> Download log</Button>
      {/snippet}
      <section class="card">
        {@render head("heart-rate-monitor", "Tool call health", undefined, pr ? logBtn : undefined)}
        {#if pr}
          <div class="stats">
            {@render stat("tool", "Tool calls", String(pr.toolCalls))}
            {@render stat("circle-x", "Failed", String(pr.failedCount), pr.failedCount > 0 ? "danger" : "default")}
            {@render stat("stopwatch", "Slow", String(pr.slowCount), pr.slowCount > 0 ? "warning" : "default", `Slower than ${duration(pr.slowThresholdMs)}`)}
            {@render stat("alert-triangle", "Warnings", String(pr.warnCount), pr.warnCount > 0 ? "warning" : "default")}
          </div>
        {:else}
          {@render empty("info-circle", waited ? "Not available from this server." : "Sampling…")}
        {/if}
      </section>

      {#if pr}
        <div class="pair">
          <section class="card">
            {@render head("circle-x", "Latest failures", pr.latestFailures.length || undefined)}
            {#if pr.latestFailures.length}
              <div class="scroll">
                <table>
                  <thead><tr><th>Tool</th><th>Cause</th><th class="n">Took</th><th class="n">When</th></tr></thead>
                  <tbody>
                    {#each pr.latestFailures as f, i (i)}
                      <tr>
                        <td class="pad-l"><span class="label" {@attach tip(f.tool)}>{f.tool}</span></td>
                        <td><span class="label" {@attach tip(f.cause)}>{f.cause}</span></td>
                        <td class="n dim">{duration(f.durationMs)}</td>
                        <td class="n dim" {@attach tip(new Date(f.atMs).toLocaleString())}>{relTime(f.atMs, app.now)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              {@render empty("circle-check", "No failures found.")}
            {/if}
          </section>
          <section class="card">
            {@render head("stack-2", "Most common failures")}
            {#if pr.latestFailures.length > 1}
              <div class="scroll">
                <table>
                  <thead><tr><th>Cause</th><th>Tools</th><th class="n">Count</th><th class="n">Last</th></tr></thead>
                  <tbody>
                    {#each failureGroups(pr.latestFailures) as g (g.cause)}
                      <tr>
                        <td class="pad-l"><span class="label" {@attach tip(g.cause)}>{g.cause}</span></td>
                        <td class="dim"><span class="label" {@attach tip([...g.tools].join(", "))}>{[...g.tools].join(", ")}</span></td>
                        <td class="n">{g.count}</td>
                        <td class="n dim" {@attach tip(new Date(g.atMs).toLocaleString())}>{relTime(g.atMs, app.now)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              {@render empty("circle-check", "No repeated failures found.")}
            {/if}
          </section>
          <section class="card">
            {@render head("stopwatch", "Slowest calls", pr.slowest.length || undefined)}
            {#if pr.slowest.length}
              <div class="scroll">
                <table>
                  <thead><tr><th>Tool</th><th class="n">Took</th><th class="n">When</th></tr></thead>
                  <tbody>
                    {#each pr.slowest as f, i (i)}
                      <tr>
                        <td class="pad-l"><span class="label" {@attach tip(f.tool)}>{f.tool}</span></td>
                        <td class="n dim">{duration(f.durationMs)}</td>
                        <td class="n dim" {@attach tip(new Date(f.atMs).toLocaleString())}>{relTime(f.atMs, app.now)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              {@render empty("circle-check", "No slow calls.")}
            {/if}
          </section>
          <section class="card">
            {@render head("alert-triangle", "Warnings and errors", pr.warnings.length || undefined)}
            {#if pr.warnings.length}
              <div class="scroll">
                <table>
                  <thead><tr><th class="s">Level</th><th>Message</th><th class="n">When</th></tr></thead>
                  <tbody>
                    {#each pr.warnings as w, i (i)}
                      <tr>
                        <td class="s pad-l"><Badge tone={w.level === "ERROR" ? "danger" : "warning"}>{w.level}</Badge></td>
                        <td><span class="label" {@attach tip(w.message)}>{w.message}</span></td>
                        <td class="n dim" {@attach tip(new Date(w.atMs).toLocaleString())}>{relTime(w.atMs, app.now)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              {@render empty("circle-check", "No warnings.")}
            {/if}
          </section>
        </div>
      {/if}
    {:else}
      <p class="dim">No connected servers.</p>
    {/if}
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
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 0.5rem 1.2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .body > :global(*) {
    flex: none; /* keep content height so .body scrolls instead of squashing the cards */
    width: 100%;
    max-width: 84rem;
    margin-inline: auto;
  }
  /* Small cards side by side while there's room for two, stacked below that. */
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(30rem, 100%), 1fr));
    gap: 1rem;
    align-items: stretch;
  }
  /* A card is one fill step above the panel, with a hairline: tonal elevation, as the rest of the app does it. */
  .card {
    --card-bg: var(--panel-bg);
    min-width: 0;
    background: none;
    overflow: hidden;
  }
  .sec-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--panel-border);
  }
  h2 {
    margin: 0;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    color: var(--text-dim);
  }
  .count {
    padding: 0 0.45rem;
    border-radius: var(--radius-pill);
    background: var(--wash-3);
    color: var(--text-dim);
    font-size: 0.79rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.4rem;
  }
  .grow {
    flex: 1;
  }
  .small {
    font-size: 0.79rem;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.6rem 1rem;
    text-align: center;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    border-bottom: 1px solid var(--panel-border);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.7rem 0.9rem;
    border-left: 1px solid var(--panel-border);
    min-width: 0;
  }
  .stat:first-child {
    border-left: 0;
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .v {
    font-size: 1.05rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat.danger .v {
    color: var(--danger);
  }
  .stat.warning .v {
    color: var(--warning);
  }
  .graphs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem;
    padding: 0.75rem;
  }
  /* Sunk into the card, with the metric's own colour carrying the icon, line and fill. */
  .graph {
    --c: var(--accent);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.7rem 0.8rem 0.6rem;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
  }
  .graph .k :global(.icon) {
    color: var(--c);
  }
  .graph .v.big {
    font-variant-numeric: tabular-nums;
    font-size: 1.6rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .sub {
    font-size: 0.79rem;
    color: var(--text-dim);
  }
  .spark {
    display: block;
    width: 100%;
    height: 3.2rem;
    margin-top: 0.2rem;
    overflow: visible;
    background: repeating-linear-gradient(to bottom, var(--panel-border) 0 1px, transparent 1px 33%);
    fill: none;
    stroke: var(--c);
    stroke-width: 1.75;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .spark polyline {
    vector-effect: non-scaling-stroke;
  }
  .spark polygon {
    fill: var(--c);
    fill-opacity: 0.18;
    stroke: none;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }
  th.n .sort {
    flex-direction: row-reverse;
  }
  .s {
    width: 6rem;
  }
  .act {
    width: 4.5rem;
    text-align: right;
    white-space: nowrap;
  }
  .proc .act {
    width: 9rem;
  }
  .kill {
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-xs, 4px);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.79rem;
    font-weight: 600;
    cursor: pointer;
  }
  .kill:hover:not(:disabled) {
    background: var(--wash-3);
  }
  @media (hover: hover) {
    .proc .kill {
      opacity: 0;
    }
    .proc tr:hover .kill,
    .proc tr:focus-within .kill {
      opacity: 1;
    }
  }
  .kill.danger:hover:not(:disabled) {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .kill + .kill {
    margin-left: 0.25rem;
  }
  .kill:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .scroll {
    max-height: 18rem;
    min-height: 6rem;
    overflow: auto;
    scrollbar-gutter: stable;
    resize: vertical; /* drag the bottom-right corner */
  }
  .scroll:not(:hover)::-webkit-resizer {
    display: none;
  }
  .scroll.tall {
    max-height: 20rem;
  }
  .scroll th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--card-bg);
  }
  .client {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    overflow: hidden;
    border-radius: 50%;
    background: var(--wash-3);
    color: var(--text-dim);
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  tbody tr.self {
    background: var(--accent-dim);
  }
  /* A bar is a faint track with the fill inside it, so where it starts and ends is clear without grid lines. */
  td.bar {
    position: relative;
  }
  td.bar::before {
    content: "";
    position: absolute;
    inset: 0.3rem 0.6rem;
    border-radius: var(--radius-xs, 4px);
    background: linear-gradient(to right, color-mix(in srgb, var(--accent, currentColor) 30%, transparent) var(--p), var(--wash-2) var(--p));
  }
  td.bar > span {
    position: relative;
    padding-right: 0.5rem;
  }
  @media (max-width: 720px) {
    .s,
    .m,
    .p {
      display: none;
    }
  }
  .dim {
    color: var(--text-dim);
    font-weight: 400;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--text-label-size);
  }
  th {
    white-space: nowrap;
    text-align: left;
    font-size: var(--text-label-size);
    font-weight: 500;
    color: var(--text-dim);
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--panel-border);
    white-space: nowrap;
  }
  th:first-child,
  td.pad-l {
    padding-left: 0.9rem;
  }
  tbody tr:hover {
    background: var(--wash-2);
  }
  td {
    padding: 0.45rem 0.6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    width: 7rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  th.n:last-child,
  td.n:last-child {
    padding-right: 0.9rem;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .kind-icon {
    display: inline-flex;
    color: var(--text-dim);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    display: inline-flex;
    flex: none;
    width: 1rem;
    height: 1rem;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
</style>

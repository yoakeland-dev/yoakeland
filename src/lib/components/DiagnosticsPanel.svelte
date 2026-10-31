<script lang="ts">
  // A task manager per server, as a page in the chat panel's place: the server process and everything it
  // has started (terminals, CLI agents, MCP servers, tool commands), sampled every few seconds while open.
  import { onMount } from "svelte";
  import { listProcesses } from "../ipc";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { treeRows } from "../processes";
  import { fileSize } from "../format";
  import { tip } from "../tooltip.svelte";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  const live = $derived((Object.entries(app.servers) as [ConnectionId, ServerState][]).filter(([, s]) => s.connectionStatus === "connected"));

  onMount(() => {
    const poll = () => live.forEach(([cid]) => listProcesses(cid));
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
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
</script>

<div class="panel" class:sidebar-collapsed={app.sidebarCollapsed}>
  <header class="head">
    <h1 class="chrome-surface island"><Icon name="activity" size={15} /> Diagnostics</h1>
  </header>
  <div class="body">
    {#each live as [cid, srv] (cid)}
      {@const list = srv.processes}
      {@const all = list ? treeRows(list) : []}
      {@const sum = total(all)}
      <section>
        <h2>
          <ServerAvatar name={srv.label} seed={srv.serverId} size={18} />
          {srv.label}
          {#if list}<span class="dim">{all.length} {all.length === 1 ? "process" : "processes"} · {sum.cpu.toFixed(1)}% CPU · {fileSize(sum.rss)}</span>{/if}
        </h2>
        {#if !list}
          <p class="dim">Sampling…</p>
        {:else if !all.length}
          <p class="dim">This server can't report its processes on this platform.</p>
        {:else}
          <table>
            <thead><tr><th>Process</th><th class="n">CPU</th><th class="n">Memory</th><th class="n">PID</th></tr></thead>
            <tbody>
              {#each treeRows(list, collapsed) as r (r.key)}
                <tr>
                  <td style="padding-left: {Math.min(r.depth, 8) * 14}px">
                    <span class="name">
                      {#if r.hasChildren}
                        <button type="button" class="chev" aria-label={collapsed.has(r.key) ? "Expand" : "Collapse"} onclick={() => toggle(r.key)}>
                          <Icon name={collapsed.has(r.key) ? "chevron-right" : "chevron-down"} size={12} />
                        </button>
                      {:else}<span class="chev"></span>{/if}
                      <span class="label" {@attach tip(r.command || r.name)}>{r.name}</span>
                    </span>
                  </td>
                  <td class="n">{(r.cpuPercent ?? 0).toFixed(1)}%</td>
                  <td class="n">{fileSize(r.rssBytes)}</td>
                  <td class="n dim">{r.pid}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {:else}
      <p class="dim">No connected servers.</p>
    {/each}
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
    margin: var(--chat-margin) var(--chat-margin) var(--chat-margin) 0;
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
  .head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-height: var(--header-line);
    padding: var(--header-pad-y) calc(var(--header-pad-x) + var(--chrome-reserve)) var(--header-pad-y) var(--chrome-inset-in-panel);
    background: var(--panel-bg);
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .panel.sidebar-collapsed .head {
    padding-left: var(--toggle-reserve-in-panel);
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .island {
    box-sizing: border-box;
    height: var(--chrome-h);
    padding: 0 calc(var(--chrome-pad) + var(--space-1));
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.5rem 1.2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .dim {
    color: var(--text-dim, var(--text));
    opacity: 0.6;
    font-weight: 400;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 0.85rem;
  }
  th {
    text-align: left;
    font-weight: 500;
    opacity: 0.6;
    padding: 0.3rem 0.5rem;
    position: sticky;
    top: 0;
    background: var(--panel-bg);
  }
  td {
    padding: 0.25rem 0.5rem;
    border-top: 1px solid var(--panel-border);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    width: 5.5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  th.n:last-child,
  td.n:last-child {
    width: 4.5rem;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
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

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Health snapshot comes from each server's ping (SPEC.md §2a status).
  import { Popover } from "bits-ui";
  import { app, type ServerState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let open = $state(false);

  const servers = $derived(Object.values(app.servers));
  const down = $derived(servers.filter((s) => s.connectionStatus !== "connected"));
  const STATE = { connecting: "connecting…", disconnected: "reconnecting…", error: "unreachable" } as const;

  interface Health {
    cpu?: number;
    mem?: number;
    memUsed?: number;
    memTotal?: number;
  }
  // Load average over core count stands in for CPU %; can exceed 100 when work is queued, so the bar caps it.
  function health(s: ServerState): Health {
    const st = s.connectionStatus === "connected" ? s.serverStatus : null;
    if (!st) return {};
    const h: Health = {};
    if (st.load1 != null && st.cpus) h.cpu = Math.round((st.load1 / st.cpus) * 100);
    if (st.memTotalBytes && st.memAvailBytes != null) {
      h.memTotal = st.memTotalBytes;
      h.memUsed = st.memTotalBytes - st.memAvailBytes;
      h.mem = Math.round((h.memUsed / h.memTotal) * 100);
    }
    return h;
  }
  const focused = $derived(app.active ?? servers.find((s) => s.connectionStatus === "connected"));
  const fh = $derived(focused ? health(focused) : {});

  const level = (pct: number) => (pct >= 90 ? "full" : pct >= 70 ? "hot" : "");
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}`;
  function uptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }
</script>

{#snippet serversCard()}
  <div class="tip-title">Servers</div>
  <ul class="tip-list">
    {#each servers as s (s.connectionId)}
      <li>
        <ServerAvatar name={s.label} seed={s.serverId} size={12} />
        <span class="grow">{s.label}</span>
        <span class="tip-dim">{s.connectionStatus}</span>
      </li>
    {/each}
  </ul>
{/snippet}

<Popover.Root bind:open>
  <Popover.Trigger
    class="sb-trigger servers"
    {@attach tip(servers.length ? serversCard : "Servers")}
    aria-label="Servers"
  >
    {#if servers.length}
      <span class="stack">
        {#each servers.slice(0, 3) as s (s.connectionId)}
          <span class="srv" class:down={s.connectionStatus !== "connected"}>
            <ServerAvatar name={s.label} seed={s.serverId} size={14} />
          </span>
        {/each}
        {#if servers.length > 3}<span class="more">+{servers.length - 3}</span>{/if}
      </span>
    {:else}
      <Icon name="server" size={12} /> No servers
    {/if}
    {#if fh.cpu != null}<span class="metric"><span class="dim">CPU</span> <span class="sb-level {level(fh.cpu)}">{fh.cpu}%</span></span>{/if}
    {#if fh.mem != null}<span class="metric"><span class="dim">RAM</span> <span class="sb-level {level(fh.mem)}">{fh.mem}%</span></span>{/if}
    {#if down.length === 1}
      <span class="down-label"><span class="down-name">{down[0].label}</span> <span class="state {down[0].connectionStatus}">{STATE[down[0].connectionStatus as keyof typeof STATE]}</span></span>
    {:else if down.length}
      <span class="state"><Icon name="alert-circle" size={12} /> {down.length} offline</span>
    {/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="sb-panel servers-panel" side="top" align="start" sideOffset={8}>
      {#if servers.length}
        <ul class="sb-list">
          {#each servers as s (s.connectionId)}
            {@const h = health(s)}
            {@const st = s.connectionStatus === "connected" ? s.serverStatus : null}
            <li class="sb-row srv-row" class:current={s === focused && servers.length > 1} class:offline={!st}>
              <span class="sb-row-main">
                <ServerAvatar name={s.label} seed={s.serverId} size={24} />
                <span class="sb-row-text">
                  <span class="sb-row-name">{s.label}</span>
                  <span class="sb-row-meta">
                    {#if st}
                      <span class="dot"></span>up {uptime(st.uptimeSec)}{#if st.version}&nbsp;· v{st.version}{/if}
                    {:else if s.connectionStatus === "connected"}
                      Waiting for its first status…
                    {:else}
                      <span class="state {s.connectionStatus}">{STATE[s.connectionStatus as keyof typeof STATE] ?? s.connectionStatus}</span>&nbsp;· showing cached chats
                    {/if}
                  </span>
                  {#if st}
                    <span class="sb-row-meta facts">
                      <span class="fact" class:busy={st.activeTurns > 0} {@attach tip(`${st.activeTurns} running`)}><Icon name="player-play" size={11} />{st.activeTurns}</span>
                      <span class="fact" {@attach tip(`${st.openProjects} ${st.openProjects === 1 ? "project" : "projects"}`)}><Icon name="folder" size={11} />{st.openProjects}</span>
                      <span class="fact" {@attach tip(`${st.peers} ${st.peers === 1 ? "client" : "clients"}`)}><Icon name="devices" size={11} />{st.peers}</span>
                      <span {@attach tip("yoakeland's own memory")}>{Math.round(st.heapBytes / 1024 ** 2)} MB</span>
                    </span>
                  {/if}
                </span>
                {#if st}
                  <span class="meters">
                    {#if h.cpu != null}
                      <span class="m" {@attach tip(`Load ${st.load1?.toFixed(2)} across ${st.cpus} cores`)}>
                        <span class="k">CPU</span>
                        <span class="sb-bar"><span class="sb-fill {level(h.cpu)}" style="width: {Math.min(h.cpu, 100)}%"></span></span>
                        <span class="v sb-level {level(h.cpu)}">{h.cpu}%</span>
                      </span>
                    {/if}
                    {#if h.mem != null}
                      <span class="m" {@attach tip(`${gb(h.memUsed!)} of ${gb(h.memTotal!)} GB in use`)}>
                        <span class="k">RAM</span>
                        <span class="sb-bar"><span class="sb-fill {level(h.mem)}" style="width: {h.mem}%"></span></span>
                        <span class="v sb-level {level(h.mem)}">{h.mem}%</span>
                      </span>
                      <span class="gb">{gb(h.memUsed!)} / {gb(h.memTotal!)} GB</span>
                    {/if}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="sb-empty">No servers yet</p>
      {/if}
      <div class="sb-foot">
        <span class="sb-foot-title">Servers</span>
        <span class="sb-foot-meta">{servers.length - down.length} of {servers.length} online</span>
        <button type="button" class="sb-foot-btn" onclick={() => ((open = false), app.openPalette("servers"))}>
          <Icon name="settings" size={12} /> Manage
        </button>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.sb-trigger.servers) {
    gap: 0.5rem;
  }
  .stack {
    display: inline-flex;
    align-items: center;
  }
  .srv {
    display: inline-flex;
    border-radius: 28%;
    /* Cut-out ring against the bar, so overlapping monograms stay distinct. */
    box-shadow: 0 0 0 1.5px var(--statusbar-bg);
  }
  .srv + .srv {
    margin-left: -4px;
  }
  .srv.down :global(.server-avatar) {
    filter: grayscale(1);
    opacity: 0.55;
  }
  .more {
    margin-left: 0.29rem;
    font-size: 0.66rem;
    opacity: 0.8;
  }
  .metric {
    font-variant-numeric: tabular-nums;
  }
  .dim {
    opacity: 0.6;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    color: var(--warning);
  }
  .down-label {
    display: inline-flex;
    gap: 0.29rem;
    min-width: 0;
  }
  .down-name {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .state.error {
    color: var(--danger);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
  }
  :global(.servers-panel) {
    width: min(30rem, 92vw);
  }
  .srv-row .sb-row-main {
    align-items: flex-start;
    padding-block: 0.5rem;
  }
  .srv-row .sb-row-text {
    gap: 0.14rem;
  }
  .srv-row.offline :global(.server-avatar) {
    filter: grayscale(1);
    opacity: 0.55;
  }
  .facts {
    gap: 0;
  }
  .facts span + span::before {
    content: "·";
    margin: 0 0.36rem;
  }
  .fact {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
  }
  .busy {
    color: var(--accent);
  }
  .meters {
    flex-shrink: 0;
    width: 8.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    padding-top: 0.14rem;
  }
  .m {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
  }
  .k {
    width: 1.7rem;
    color: var(--text-dim);
  }
  .v {
    min-width: 2rem;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .gb {
    align-self: flex-end;
    font-size: 0.64rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>

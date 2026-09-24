<script lang="ts">
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

<Popover.Root bind:open>
  <Popover.Trigger
    class="sb-trigger servers"
    title={servers.map((s) => `${s.label} — ${s.connectionStatus}`).join("\n") || "Servers"}
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
    {#each down as s (s.connectionId)}
      <span class="down-label">{s.label} <span class="state {s.connectionStatus}">{STATE[s.connectionStatus as keyof typeof STATE]}</span></span>
    {/each}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="sb-panel" side="top" align="start" sideOffset={8}>
      {#if servers.length}
        <div class="sb-cards">
          {#each servers as s (s.connectionId)}
            {@const h = health(s)}
            {@const st = s.connectionStatus === "connected" ? s.serverStatus : null}
            <div
              class="sb-card"
              class:selected={s === focused && servers.length > 1}
              class:offline={!st}
              title={s.connectionStatus !== "connected" ? "Showing cached chats until it reconnects" : undefined}
            >
              <span class="sb-card-head">
                <ServerAvatar name={s.label} seed={s.serverId} size={24} />
                <span class="sb-who">
                  <span class="sb-card-title">{s.label}</span>
                  <span class="sb-card-sub">
                    {#if st}
                      <span class="dot"></span> up {uptime(st.uptimeSec)}{#if st.version}&nbsp;· v{st.version}{/if}
                    {:else}
                      <span class="state {s.connectionStatus}">{STATE[s.connectionStatus as keyof typeof STATE] ?? s.connectionStatus}</span>
                    {/if}
                  </span>
                </span>
              </span>
              {#if st}
                <span class="sb-rows">
                  {#if h.cpu != null}
                    <span class="sb-meter">
                      <span class="sb-meter-top">
                        <span class="sb-meter-name">CPU</span>
                        <span class="sb-meter-note">load {st.load1?.toFixed(2)} · {st.cpus} cores</span>
                      </span>
                      <span class="sb-meter-row">
                        <span class="sb-bar"><span class="sb-fill {level(h.cpu)}" style="width: {Math.min(h.cpu, 100)}%"></span></span>
                        <span class="sb-value {level(h.cpu)}">{h.cpu}%</span>
                      </span>
                    </span>
                  {/if}
                  {#if h.mem != null}
                    <span class="sb-meter">
                      <span class="sb-meter-top">
                        <span class="sb-meter-name">Memory</span>
                        <span class="sb-meter-note">{gb(h.memUsed!)} / {gb(h.memTotal!)} GB</span>
                      </span>
                      <span class="sb-meter-row">
                        <span class="sb-bar"><span class="sb-fill {level(h.mem)}" style="width: {h.mem}%"></span></span>
                        <span class="sb-value {level(h.mem)}">{h.mem}%</span>
                      </span>
                    </span>
                  {/if}
                </span>
                <dl class="sb-facts">
                  <dt>Running turns</dt><dd>{st.activeTurns}</dd>
                  <dt>Open projects</dt><dd>{st.openProjects}</dd>
                  <dt>Connected clients</dt><dd>{st.peers}</dd>
                  <dt>yoakeland memory</dt><dd>{Math.round(st.heapBytes / 1024 ** 2)} MB</dd>
                </dl>
              {:else if s.connectionStatus === "connected"}
                <span class="sb-meter-note">Waiting for its first status…</span>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="sb-empty">No servers yet</p>
      {/if}
      <div class="sb-foot">
        <span class="sb-foot-title">Servers</span>
        <span class="sb-foot-actions">
          <button type="button" class="sb-foot-btn" onclick={() => ((open = false), app.openPalette("servers"))}>
            <Icon name="network" size={12} /> Switch
          </button>
          <button type="button" class="sb-foot-btn" onclick={() => ((open = false), (app.settingsTab = "servers"), (app.showSettings = true))}>
            <Icon name="settings" size={12} /> Manage
          </button>
        </span>
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
    color: var(--warning);
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
  /* Nothing to meter: a slim full-width row under the live cards. */
  .sb-card.offline {
    grid-column: 1 / -1;
    padding-block: 0.43rem;
  }
  .sb-card.offline :global(.server-avatar) {
    filter: grayscale(1);
    opacity: 0.55;
  }
</style>

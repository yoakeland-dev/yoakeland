<script lang="ts">
  // App-wide, not per-server: multiple servers/chats run at once, so this only shows what
  // spans all of them. Per-chat numbers (context, session cost) live in the chat header instead.
  import { app, type ConnectionId } from "../state.svelte";
  import { openChatSession } from "../ipc";
  import Icon from "./Icon.svelte";
  import NotificationCenter from "./NotificationCenter.svelte";
  import UsageWidget from "./UsageWidget.svelte";
  import ServerHealthWidget from "./ServerHealthWidget.svelte";
  import GitWidget from "./GitWidget.svelte";
  import TerminalsWidget from "./TerminalsWidget.svelte";
  import PeersWidget from "./PeersWidget.svelte";

  const servers = $derived(Object.values(app.servers));

  type Ref = { cid: ConnectionId; sessionId: string };
  const waiting = $derived(
    servers.flatMap((s) =>
      [...new Set(s.pendingAsks.map((a) => a.sessionId))].map((sessionId) => ({ cid: s.connectionId, sessionId })),
    ),
  );
  const running = $derived(
    servers.flatMap((s) =>
      Object.entries(s.activeTurnBySession)
        .filter(([, turn]) => !!turn)
        .map(([sessionId]) => ({ cid: s.connectionId, sessionId })),
    ),
  );
  const localSpend = $derived(app.spendToday.day === new Date().toDateString() ? app.spendToday.usd : 0);
  // Servers reporting spend (v2.15+ ping status) count every client's turns; older ones fall back to local tracking.
  const reporting = $derived(servers.filter((s) => s.serverStatus?.spend));
  const spend = $derived(
    reporting.length
      ? {
          today: reporting.reduce((n, s) => n + (s.serverStatus!.spend!.todayUsd ?? 0), 0),
          month: reporting.reduce((n, s) => n + (s.serverStatus!.spend!.monthUsd ?? 0), 0),
        }
      : { today: localSpend, month: undefined },
  );
  const queued = $derived(servers.reduce((n, s) => n + (s.serverStatus?.queuedTurns ?? 0), 0));

  // Clicking a count jumps to the next chat in it, cycling on repeat clicks.
  let cursor = 0;
  function jump(list: Ref[]) {
    if (!list.length) return;
    const r = list[cursor++ % list.length];
    openChatSession(r.cid, r.sessionId);
  }
  function titleOf(r: Ref): string {
    const s = app.servers[r.cid];
    const summary = Object.values(s?.sessionsByProject ?? {})
      .flat()
      .find((x) => x.sessionId === r.sessionId);
    return summary?.title || "Untitled chat";
  }
</script>

<footer class="statusbar">
  <div class="left">
    <ServerHealthWidget />
    <PeersWidget />
    <GitWidget />
  </div>
  <div class="right">
    <TerminalsWidget />
    {#if waiting.length}
      <button
        class="item attention"
        title={"Waiting on you:\n" + waiting.map(titleOf).join("\n")}
        onclick={() => jump(waiting)}
      >
        <Icon name="alert-circle" size={12} /> {waiting.length} waiting
      </button>
    {/if}
    {#if running.length}
      <button class="item busy" title={"Running:\n" + running.map(titleOf).join("\n")} onclick={() => jump(running)}>
        <span class="spin"><Icon name="loader-2" size={12} /></span> {running.length} running
      </button>
    {/if}
    {#if queued > 0}
      <span class="item" title="Turns waiting for their chat's current turn to finish">
        <Icon name="clock" size={12} /> {queued} queued
      </span>
    {/if}
    <UsageWidget />
    {#if spend.today > 0 || spend.month}
      <span
        class="item"
        title={reporting.length
          ? `Spent across ${reporting.length === 1 ? reporting[0].label : `${reporting.length} servers`} (server-local day/month)` +
            (spend.month != null ? `\nThis month: $${spend.month.toFixed(2)}` : "")
          : "Spent today across every server (turns this app has seen)"}
        >${spend.today.toFixed(2)} today{#if spend.month != null}<span class="dim">&nbsp;· ${spend.month.toFixed(2)} mo</span>{/if}</span
      >
    {/if}
    <NotificationCenter />
  </div>
</footer>

<style>
  .statusbar {
    height: 1.86rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 0.57rem;
    background: var(--statusbar-bg);
    color: var(--statusbar-fg);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--panel-border);
    white-space: nowrap;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    min-width: 0;
  }
  .left {
    overflow: hidden;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    height: 1.43rem;
    padding: 0 0.43rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    font: inherit;
    cursor: default;
  }
  button.item {
    cursor: pointer;
  }
  button.item:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .attention {
    color: var(--warning);
  }
  .busy {
    color: var(--accent);
  }
  .dim {
    opacity: 0.7;
  }
  .spin {
    display: inline-flex;
    animation: spin calc(1s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

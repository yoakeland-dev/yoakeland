<script lang="ts">
  // One row per device (matched by deviceId, §3.2 peer_list) even if it's on several servers.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { disconnectPeer, openChatSession, thisDeviceId } from "../ipc";
  import { basename, relTime, sessionTitle } from "../format";
  import type { PeerInfo } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let open = $state(false);

  interface Conn {
    cid: ConnectionId;
    srv: ServerState;
    p: PeerInfo;
  }
  interface Device {
    key: string;
    p: PeerInfo; // its newest connection, for name/avatar/type
    conns: Conn[];
    at?: Conn; // a connection that has a chat open
  }

  const me = thisDeviceId();
  const multiServer = $derived(Object.keys(app.servers).length > 1);
  const devices = $derived.by(() => {
    const byKey = new Map<string, Device>();
    for (const srv of Object.values(app.servers)) {
      if (srv.connectionStatus !== "connected") continue;
      for (const p of srv.peers) {
        // Ourselves: this connection, or this install on another server.
        if (p.peerId === srv.selfPeerId || p.deviceId === me) continue;
        // No deviceId means it can't be matched across servers/reconnects; each connection is its own row.
        const key = p.deviceId ?? `${srv.connectionId}:${p.peerId}`;
        const c: Conn = { cid: srv.connectionId, srv, p };
        const d = byKey.get(key);
        if (!d) byKey.set(key, { key, p, conns: [c], at: p.sessionId ? c : undefined });
        else {
          d.conns.push(c);
          if (p.connectedAt > d.p.connectedAt) d.p = p;
          if (p.sessionId && !d.at) d.at = c;
        }
      }
    }
    return [...byKey.values()].sort((a, b) => b.p.connectedAt.localeCompare(a.p.connectedAt));
  });

  const pictured = $derived(devices.filter((d) => d.p.avatar));

  const DEVICE = { desktop: "laptop", web: "world", server: "server" } as const;

  function chatName(c: Conn): string {
    const s = c.srv.sessionById.get(c.p.sessionId!);
    return s ? sessionTitle(s) : `a chat in ${basename(c.p.projectPath ?? "")}`;
  }
  function follow(d: Device) {
    const c = d.at;
    if (!c?.p.sessionId) return;
    open = false;
    // A chat in a project this client hasn't listed yet still opens.
    if (c.p.projectPath) c.srv.projectBySession[c.p.sessionId] ??= c.p.projectPath;
    openChatSession(c.cid, c.p.sessionId);
  }
  function kick(d: Device) {
    const where = d.conns.length > 1 ? `${d.conns.length} servers` : d.conns[0].srv.label;
    if (!confirm(`Disconnect "${d.p.name}" from ${where}?`)) return;
    for (const c of d.conns) disconnectPeer(c.cid, c.p.peerId);
  }
</script>

{#snippet avatar(p: PeerInfo, size: number)}
  <span class="avatar" style="width: {size / 14}rem; height: {size / 14}rem">
    {#if p.avatar}<img src={p.avatar} alt="" />{:else}<Icon name={DEVICE[p.deviceType] ?? "user"} size={Math.round(size * 0.6)} />{/if}
  </span>
{/snippet}

{#if devices.length}
  <Popover.Root bind:open>
    <Popover.Trigger class="sb-trigger" title={devices.map((d) => d.p.name).join("\n")} aria-label="Your other devices">
      <!-- Photos stack; type icons would just clip each other, so no photos means one icon. -->
      {#if pictured.length}
        <span class="stack">
          {#each pictured.slice(0, 3) as d (d.key)}{@render avatar(d.p, 14)}{/each}
        </span>
      {:else}
        <Icon name="devices" size={12} />
      {/if}
      {devices.length}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel peers-panel" side="top" align="start" sideOffset={8}>
        <ul class="sb-list">
          {#each devices as d (d.key)}
            <li class="sb-row">
              <button
                type="button"
                class="sb-row-main"
                disabled={!d.at}
                title={d.at ? "Open the same chat here" : `${d.p.deviceType}${d.p.ip ? ` · ${d.p.ip}` : ""}`}
                onclick={() => follow(d)}
              >
                {@render avatar(d.p, 24)}
                <span class="sb-row-text">
                  <span class="sb-row-name">{d.p.name}</span>
                  <span class="sb-row-meta">
                    {#if d.at}
                      <Icon name="message-circle" size={11} />
                      <span class="chat">{chatName(d.at)}</span>
                    {:else}
                      <Icon name={DEVICE[d.p.deviceType] ?? "user"} size={11} />
                      {d.p.deviceType}&nbsp;· connected {relTime(d.p.connectedAt, app.now)}
                    {/if}
                  </span>
                </span>
                {#if multiServer}
                  <span class="servers">
                    {#each d.conns as c (c.cid)}<ServerAvatar name={c.srv.label} seed={c.srv.serverId} size={13} />{/each}
                  </span>
                {/if}
              </button>
              <button type="button" class="sb-row-action danger" title="Disconnect" aria-label="Disconnect" onclick={() => kick(d)}>
                <Icon name="unlink" size={12} />
              </button>
            </li>
          {/each}
        </ul>
        <div class="sb-foot">
          <span class="sb-foot-title">Devices</span>
          <button type="button" class="sb-foot-btn" onclick={() => ((open = false), (app.settingsTab = "access"), (app.showSettings = true))}>
            <Icon name="settings" size={12} /> Access
          </button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.peers-panel) {
    width: min(20rem, 92vw);
  }
  .stack {
    display: inline-flex;
  }
  .stack .avatar + .avatar {
    margin-left: -4px;
  }
  .avatar {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text) 12%, var(--statusbar-bg));
    color: var(--text-dim);
    box-shadow: 0 0 0 1.5px var(--statusbar-bg);
  }
  .sb-row .avatar {
    box-shadow: none;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .chat {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .servers {
    display: inline-flex;
    gap: 2px;
  }
  .sb-row-main:disabled {
    cursor: default;
  }
</style>

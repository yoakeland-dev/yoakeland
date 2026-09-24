<script lang="ts">
  // Status-bar terminals: every terminal on every server (terminal_index,
  // §3.2 — including ones started from other devices), so a shell left
  // running in a chat you've moved away from isn't forgotten. Clicking one
  // opens its chat with the drawer on that tab; the x kills it
  // (terminal_close).
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { openChatSession, terminalClose } from "../ipc";
  import { basename, sessionTitle } from "../format";
  import type { TerminalTab } from "../types";
  import { markOverflow } from "../overflow";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let open = $state(false);

  interface Row {
    key: string;
    cid: ConnectionId;
    srv: ServerState;
    t: TerminalTab;
    chat: string;
  }
  const multiServer = $derived(Object.keys(app.servers).length > 1);
  const rows = $derived(
    Object.values(app.servers).flatMap((srv) =>
      Object.entries(srv.terminalsBySession).flatMap(([sid, ids]) =>
        ids.flatMap((id) => {
          const t = srv.terminalById[id];
          if (!t) return [];
          const s = srv.sessionById.get(sid);
          return [{ key: `${srv.connectionId}:${id}`, cid: srv.connectionId, srv, t, chat: s ? sessionTitle(s) : "Chat" }];
        }),
      ),
    ),
  );
  const live = $derived(rows.filter((r) => r.t.status === "running" || r.t.status === "starting"));

  function show(r: Row) {
    open = false;
    openChatSession(r.cid, r.t.sessionId);
    r.srv.activeTerminalBySession[r.t.sessionId] = r.t.terminalId;
    r.srv.terminalOpenBySession[r.t.sessionId] = true;
  }
</script>

{#if rows.length}
  <Popover.Root bind:open>
    <Popover.Trigger class="sb-trigger" title="Terminals" aria-label="Terminals">
      <Icon name="terminal-2" size={12} />
      {live.length}{#if live.length !== rows.length}<span class="dim">/{rows.length}</span>{/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel terminals-panel" side="top" align="end" sideOffset={8}>
        <ul class="sb-list" use:markOverflow>
          {#each rows as r (r.key)}
            <li class="sb-row">
              <button type="button" class="sb-row-main" onclick={() => show(r)} title={r.t.cwd}>
                <span class="state {r.t.status}" title={r.t.status === "exited" && r.t.exitCode != null ? `exited (${r.t.exitCode})` : r.t.status}></span>
                <span class="sb-row-text">
                  <span class="sb-row-name mono">{r.t.title || r.t.label}</span>
                  <span class="sb-row-meta">{r.chat}{#if r.t.cwd}&nbsp;· {basename(r.t.cwd)}{/if}</span>
                </span>
                {#if multiServer}<ServerAvatar name={r.srv.label} seed={r.srv.serverId} size={13} />{/if}
              </button>
              <button type="button" class="sb-row-action danger" title="Close terminal" aria-label="Close terminal" onclick={() => terminalClose(r.cid, r.t.sessionId, r.t.terminalId)}>
                <Icon name="xmark" size={12} />
              </button>
            </li>
          {/each}
        </ul>
        <div class="sb-foot">
          <span class="sb-foot-title">Terminals</span>
          <span class="sb-foot-meta">{live.length} running</span>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.terminals-panel) {
    width: min(21rem, 92vw);
  }
  .dim {
    opacity: 0.6;
  }
  .state {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-dim);
  }
  .state.running {
    background: var(--success);
  }
  .state.starting {
    background: var(--accent);
  }
  .state.error {
    background: var(--danger);
  }
  .mono {
    font-family: var(--code-font-family, monospace);
  }
</style>

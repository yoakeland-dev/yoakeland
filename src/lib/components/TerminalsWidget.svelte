<script lang="ts">
  // The terminal taskbar: every terminal on every server (terminal_index, §3.2), including ones
  // started from other devices, grouped by the chat that owns it. Picking one opens that chat
  // with its drawer on that terminal, since a terminal only makes sense next to its chat.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { openChatSession, terminalClose } from "../ipc";
  import { basename, sessionTitle, terminalTitle } from "../format";
  import type { TerminalTab } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import TerminalStatusIcon, { terminalState } from "./TerminalStatusIcon.svelte";

  let open = $state(false);

  interface Group {
    key: string;
    cid: ConnectionId;
    srv: ServerState;
    sessionId: string;
    chat: string;
    project?: string;
    terms: TerminalTab[];
  }
  const multiServer = $derived(Object.keys(app.servers).length > 1);
  const groups = $derived(
    Object.values(app.servers).flatMap((srv) =>
      Object.entries(srv.terminalsBySession).flatMap(([sid, ids]): Group[] => {
        const terms = ids.map((id) => srv.terminalById[id]).filter((t): t is TerminalTab => !!t);
        if (!terms.length) return [];
        const s = srv.sessionById.get(sid);
        const path = Object.entries(srv.sessionsByProject).find(([, list]) => list.some((x) => x.sessionId === sid))?.[0];
        return [
          {
            key: `${srv.connectionId}:${sid}`,
            cid: srv.connectionId,
            srv,
            sessionId: sid,
            chat: s ? sessionTitle(s) : "Chat",
            project: path && srv.projectName(path),
            terms,
          },
        ];
      }),
    ),
  );
  const all = $derived(groups.flatMap((g) => g.terms));
  const busy = $derived(all.filter((t) => t.busy).length);
  const failed = $derived(all.filter((t) => t.status === "error" || (!t.busy && t.lastExit)).length);

  function isShown(g: Group, t: TerminalTab) {
    return (
      g.cid === app.activeConnectionId &&
      g.sessionId === g.srv.currentSessionId &&
      !!g.srv.terminalOpenBySession[g.sessionId] &&
      (g.srv.activeTerminalBySession[g.sessionId] === t.terminalId || (!!g.srv.terminalSplitBySession[g.sessionId] && g.srv.splitTerminalBySession[g.sessionId] === t.terminalId))
    );
  }

  function show(g: Group, t: TerminalTab) {
    open = false;
    if (g.sessionId !== g.srv.currentSessionId || g.cid !== app.activeConnectionId) openChatSession(g.cid, g.sessionId);
    if (!isShown(g, t)) g.srv.setActiveTerminalTab(g.sessionId, t.terminalId);
    g.srv.terminalOpenBySession[g.sessionId] = true;
  }
</script>

{#if all.length}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="sb-trigger"
      title={busy ? `${busy} running, ${all.length} terminals` : `${all.length} terminals`}
      aria-label="Terminals"
    >
      {#if busy}
        <span class="spin busy"><Icon name="loader-2" size={12} /></span>
      {:else}
        <Icon name="terminal-2" size={12} />
      {/if}
      <span>{all.length}</span>
      {#if failed}<span class="failed" title="{failed} with a failed command or error">{failed}</span>{/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel terminals-panel" side="top" align="end" sideOffset={8}>
        <div class="groups">
          {#each groups as g (g.key)}
            <section class="group">
              <button type="button" class="group-head" title="Open this chat" onclick={() => show(g, g.terms.find((t) => t.terminalId === g.srv.activeTerminalBySession[g.sessionId]) ?? g.terms[0])}>
                <Icon name="message-circle" size={12} />
                <span class="chat">{g.chat}</span>
                {#if g.project}<span class="project">{g.project}</span>{/if}
                {#if multiServer}<ServerAvatar name={g.srv.label} seed={g.srv.serverId} size={12} />{/if}
              </button>
              <ul class="sb-list">
                {#each g.terms as t (t.terminalId)}
                  <li class="sb-row" class:current={isShown(g, t)}>
                    <button type="button" class="sb-row-main" onclick={() => show(g, t)} title={t.cwd}>
                      <TerminalStatusIcon tab={t} />
                      <span class="sb-row-text">
                        <span class="sb-row-name">{terminalTitle(t)}</span>
                        <span class="sb-row-meta">
                          {#if t.cwd}<span class="cwd">{basename(t.cwd)}</span><span class="sep">·</span>{/if}
                          <span class="state {terminalState(t).tone}">{terminalState(t).text}</span>
                        </span>
                      </span>
                    </button>
                    <button type="button" class="sb-row-action danger" title="Kill terminal" aria-label="Kill terminal" onclick={() => terminalClose(g.cid, g.sessionId, t.terminalId)}>
                      <Icon name="xmark" size={12} />
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
        <div class="sb-foot">
          <span class="sb-foot-title">Terminals</span>
          <span class="sb-foot-meta">{busy ? `${busy} running · ` : ""}{all.length} open</span>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.terminals-panel) {
    width: min(22rem, 92vw);
  }
  .busy {
    color: var(--info);
  }
  .failed {
    color: var(--danger);
  }
  .failed::before {
    content: "✕";
    margin-right: 0.14rem;
    font-size: 0.85em;
  }
  .groups {
    max-height: min(60vh, 28rem);
    overflow-y: auto;
  }
  .group + .group {
    border-top: 1px solid var(--panel-border);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    width: 100%;
    padding: 0.43rem 0.71rem 0.14rem;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    text-align: left;
    cursor: pointer;
  }
  .group-head:hover .chat {
    color: var(--text);
  }
  .chat {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .project {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .cwd {
    flex-shrink: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--code-font-family, monospace);
  }
  .state {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .state.info {
    color: var(--info);
  }
  .state.danger {
    color: var(--danger);
  }
</style>

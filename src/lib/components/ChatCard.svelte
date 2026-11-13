<script module lang="ts">
  import { askLine } from "../chatBrief";
  import { callActivity } from "../activity.svelte";
  import { IN_FLIGHT } from "../subagents";
  import { titleFor, vendorMetaFor } from "../modelVendor";
  import { app as appState, type ServerState } from "../state.svelte";
  import { describeProvider, forwardWaitLabel } from "../forwarding";

  /** One line on what a chat is doing: the ask it's blocked on, the call in flight, or how its last reply started. */
  export function chatActivity(server: ServerState | undefined, sessionId: string): string {
    const ask = server?.pendingAsks.find((a) => a.sessionId === sessionId);
    if (ask) return ask.kind === "question" ? ask.question : askLine(ask.description) || "Needs your approval";
    const last = (server?.messagesBySession[sessionId] ?? []).findLast((m) => m.role === "assistant");
    // Any call still going, not just the last: parallel subagents outlast the calls after them.
    const going = last?.toolCalls.findLast((c) => IN_FLIGHT.has(c.status));
    // Finished: show how it ended, to answer from the sidebar.
    if (!server?.activeTurnBySession[sessionId]) return last?.text.replace(/[#*`>_\[\]]/g, "").trim().split("\n")[0] || "Done";
    return going ? callActivity(going) : forwardWaitLabel(appState, server, sessionId) ?? (last?.toolCalls.length ? "Writing…" : "Thinking…");
  }

  /** The model a chat last answered with (or is set to), with its vendor mark, for the card and the sidebar row. */
  export function chatModel(server: ServerState | undefined, sessionId: string): { title: string; icon: string | undefined } | undefined {
    const m = (server?.messagesBySession[sessionId] ?? []).findLast((x) => x.role === "assistant" && x.model);
    const providerName = m?.provider ?? server?.providerBySession[sessionId];
    const modelId = m?.model ?? server?.modelBySession[sessionId];
    if (!modelId) return undefined;
    // A borrowed provider (via:<server>:<name>) is described by the server that lends it.
    const { info: provider, models } = describeProvider(appState, server, providerName);
    if (!provider) return { title: modelId, icon: undefined };
    const entry = { provider, model: models.find((x) => x.id === modelId) ?? { id: modelId } };
    return { title: titleFor(entry), icon: vendorMetaFor(entry).icon };
  }
</script>

<script lang="ts">
  // The hover card for a chat: sidebar rows and the header's live tabs both show it, so the
  // rows of detail stay in one place. Every derived value is lazy, so it only computes while shown.
  import { app, CHAT_PROJECT, type ConnectionId } from "../state.svelte";
  import { fileSize, relTime, sessionTitle, shortNum, usd } from "../format";
  import { ringState } from "../contextBreakdown";
  import { STATUS_ICON } from "../liveChats";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let { connectionId, session: s }: { connectionId: ConnectionId; session: SessionSummary } = $props();

  const server = $derived(app.servers[connectionId]);
  const messages = $derived(server?.messagesBySession[s.sessionId] ?? []);
  const status = $derived(server?.sessionStatus(s.sessionId) ?? "idle");
  const syncing = $derived(!!server?.syncingSessions[s.sessionId]);

  const projectPath = $derived(
    server?.projectBySession[s.sessionId] ??
      Object.entries(server?.sessionsByProject ?? {}).find(([, list]) => list.some((x) => x.sessionId === s.sessionId))?.[0],
  );
  const model = $derived(chatModel(server, s.sessionId));
  const ring = $derived(ringState(server?.contextBySession[s.sessionId]));
  const git = $derived(projectPath ? server?.gitStatusByProject[projectPath] : undefined);
  const unsandboxed = $derived(!!server?.isUnsandboxed(projectPath));
  const shellOff = $derived(!!server?.shellDisabled(projectPath));

  // Runtime: only for a chat that's doing something or just did.
  const activity = $derived(status === "idle" ? undefined : chatActivity(server, s.sessionId));
  const since = $derived(messages.findLast((m) => m.role === "user")?.createdAt);
  const spend = $derived(server?.spendBySession[s.sessionId]);
  const busyTerminals = $derived(
    (server?.terminalsBySession[s.sessionId] ?? []).filter((id) => server?.terminalById[id]?.busy).length,
  );
</script>

<div class="card">
  <div class="head">
    <span class="state {status}" aria-hidden="true">
      {#if status === "action"}<span class="lamp"></span>{:else}<Icon name={STATUS_ICON[status]} size={14} />{/if}
    </span>
    <span class="title">{sessionTitle(s)}</span>
    {#if status === "working" && since}<span class="age">{relTime(since, app.now)}</span>{/if}
  </div>
  {#if activity}<p class="activity">{activity}</p>{/if}

  <dl class="facts">
    {#if projectPath === CHAT_PROJECT}
      <dt>Where</dt>
      <dd>Chat{#if s.workspaceBytes} <span class="dim">· {fileSize(s.workspaceBytes)} of files</span>{/if}</dd>
    {:else if projectPath}
      <dt>Project</dt>
      <dd>{server?.projectLabel(projectPath)}</dd>
    {/if}
    {#if git}
      <dt>Branch</dt>
      <dd class="branch">
        <span class="name">{git.detached ? "detached" : git.branch}</span>
        {#if git.dirtyFiles}<span class="dirty">±{git.dirtyFiles}</span>{/if}
        {#if git.hasUpstream && git.ahead}<span class="dim">↑{git.ahead}</span>{/if}
        {#if git.hasUpstream && git.behind}<span class="dim">↓{git.behind}</span>{/if}
      </dd>
    {/if}
    {#if server}
      <dt>Server</dt>
      <dd><ServerAvatar name={server.label} seed={server.serverId} size={13} /><span class="name">{server.label}</span></dd>
    {/if}
    {#if model}
      <dt>Model</dt>
      <dd>
        {#if model.icon}<LobeIcon name={model.icon} variant="mono" fallback="openrouter" size={13} />{:else}<Icon name="brain" size={13} />{/if}
        <span class="name">{model.title}</span>
      </dd>
    {/if}
    {#if ring.kind === "ok" && ring.pct !== null}
      <dt>Context</dt>
      <dd class="meter-row">
        <span class="meter" class:high={ring.pct >= 85}><i style:width="{Math.min(100, ring.pct)}%"></i></span>
        <span>{ring.estimated ? "~" : ""}{ring.pct}%</span>
        <span class="dim">{shortNum(ring.used)} / {shortNum(ring.limit)}</span>
      </dd>
    {/if}
    {#if spend?.sessionTotalUsd}
      <dt>Spend</dt>
      <dd>
        {usd(spend.sessionTotalUsd, spend.sessionCostUnknown)}
        {#if server?.sessionCapUsd}<span class="dim">of {usd(server.sessionCapUsd)} cap</span>{/if}
      </dd>
    {/if}
  </dl>

  {#if unsandboxed}
    <div class="alert"><Icon name="warning" size={13} />No sandbox{shellOff ? " · bash and terminals off" : ""}</div>
  {/if}
  {#if busyTerminals || syncing}
    <div class="foot">
      {#if busyTerminals}<Icon name="terminal-2" size={12} />{busyTerminals} command{busyTerminals === 1 ? "" : "s"} running{/if}
      {#if syncing}Syncing with the server…{/if}
    </div>
  {/if}
</div>

<style>
  .card {
    display: grid;
    gap: 0.6rem;
    width: 19rem;
    max-width: 100%;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .state {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--sidebar-fg-dim);
  }
  .state.action {
    color: var(--lamp);
  }
  .state.finished {
    color: var(--success);
  }
  .state.working {
    color: var(--info);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: var(--text-body-size);
  }
  .age {
    flex-shrink: 0;
    font-size: 0.79rem;
    font-variant-numeric: tabular-nums;
    color: var(--info);
    padding: 0 0.4rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--info) 14%, transparent);
  }
  /* What it is doing now: the one line that can be long (an ask's text), so it wraps, capped. */
  .activity {
    margin: -0.25rem 0 0;
    padding-left: calc(14px + 0.5rem);
    color: var(--text-dim);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.35rem 0.9rem;
    align-items: center;
    margin: 0;
    padding-top: 0.6rem;
    border-top: 1px solid var(--panel-border);
  }
  .facts dt {
    color: var(--text-dim);
    font-size: 0.79rem;
  }
  .facts dd {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    margin: 0;
  }
  .facts dd > :global(svg) {
    flex-shrink: 0;
    color: var(--text-dim);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim {
    color: var(--text-dim);
  }
  .dirty {
    color: var(--warning);
  }
  .branch {
    font-variant-numeric: tabular-nums;
  }
  .meter-row {
    font-variant-numeric: tabular-nums;
  }
  .meter {
    flex: 1;
    min-width: 2rem;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--wash-3);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--info);
  }
  .meter.high i {
    background: var(--warning);
  }
  .alert {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-dim);
    font-size: 0.79rem;
  }
</style>

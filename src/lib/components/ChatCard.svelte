<script module lang="ts">
  import { callActivity } from "../activity.svelte";
  import { IN_FLIGHT } from "../subagents";
  import type { ServerState } from "../state.svelte";

  /** One line on what a chat is doing: the ask it's blocked on, the call in flight, or how its last reply started. */
  export function chatActivity(server: ServerState | undefined, sessionId: string): string {
    const ask = server?.pendingAsks.find((a) => a.sessionId === sessionId);
    if (ask) return ask.kind === "question" ? ask.question : ask.description || "Needs your approval";
    const last = (server?.messagesBySession[sessionId] ?? []).findLast((m) => m.role === "assistant");
    // Any call still going, not just the last: parallel subagents outlast the calls after them.
    const going = last?.toolCalls.findLast((c) => IN_FLIGHT.has(c.status));
    // Finished: show how it ended, to answer from the sidebar.
    if (!server?.activeTurnBySession[sessionId]) return last?.text.replace(/[#*`>_\[\]]/g, "").trim().split("\n")[0] || "Done";
    return going ? callActivity(going) : last?.toolCalls.length ? "Writing…" : "Thinking…";
  }
</script>

<script lang="ts">
  // The hover card for a chat: sidebar rows and the header's live tabs both show it, so the
  // rows of detail stay in one place. Every derived value is lazy, so it only computes while shown.
  import { app, CHAT_PROJECT, type ConnectionId } from "../state.svelte";
  import { fileSize, relTime, sessionTitle, shortNum, usd } from "../format";
  import { titleFor, vendorMetaFor } from "../modelVendor";
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
  const model = $derived.by(() => {
    const m = messages.findLast((x) => x.role === "assistant" && x.model);
    const providerName = m?.provider ?? server?.providerBySession[s.sessionId];
    const modelId = m?.model ?? server?.modelBySession[s.sessionId];
    if (!modelId) return undefined;
    const provider = server?.providers.find((p) => p.name === providerName);
    if (!provider) return { title: modelId, icon: undefined };
    const entry = { provider, model: server?.modelsByProvider[provider.name]?.find((x) => x.id === modelId) ?? { id: modelId } };
    return { title: titleFor(entry), icon: vendorMetaFor(entry).icon };
  });
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

<div class="tip-title">{sessionTitle(s)}</div>
<ul class="tip-list">
  {#if activity}
    <li class="activity {status}">
      <span class="tip-icon"><Icon name={STATUS_ICON[status]} size={13} /></span>
      <span class="grow">{activity}</span>
    </li>
    {#if status === "working" && since}
      <li><span class="tip-icon"><Icon name="clock" size={13} /></span><span class="grow">Running for {relTime(since, app.now)}</span></li>
    {/if}
  {/if}
  {#if projectPath === CHAT_PROJECT}
    <li>
      <span class="tip-icon"><Icon name="message-circle" size={13} /></span>
      <span class="grow">Chat{#if s.workspaceBytes} <span class="tip-dim">· {fileSize(s.workspaceBytes)} of files</span>{/if}</span>
    </li>
  {:else if projectPath}<li><span class="tip-icon"><Icon name="folder" size={13} /></span><span class="grow">{server?.projectLabel(projectPath)}</span></li>{/if}
  {#if git}
    <li>
      <span class="tip-icon"><Icon name="git-branch" size={13} /></span>
      <span class="grow">
        {git.detached ? "detached" : git.branch}
        {#if git.dirtyFiles}<span class="dirty">±{git.dirtyFiles}</span>{/if}
        {#if git.hasUpstream && git.ahead}<span class="tip-dim">↑{git.ahead}</span>{/if}
        {#if git.hasUpstream && git.behind}<span class="tip-dim">↓{git.behind}</span>{/if}
      </span>
    </li>
  {/if}
  {#if unsandboxed}
    <li class="warn">
      <span class="tip-icon"><Icon name="warning" size={13} /></span>
      <span class="grow">No sandbox{shellOff ? " · bash and terminals off" : ""}</span>
    </li>
  {/if}
  {#if server}<li><span class="tip-icon"><ServerAvatar name={server.label} seed={server.serverId} size={13} /></span><span class="grow">{server.label}</span></li>{/if}
  {#if model}
    <li>
      <span class="tip-icon">{#if model.icon}<LobeIcon name={model.icon} variant="mono" fallback="openrouter" size={13} />{:else}<Icon name="brain" size={13} />{/if}</span>
      <span class="grow">{model.title}</span>
    </li>
  {/if}
  {#if ring.kind === "ok" && ring.pct !== null}
    <li>
      <span class="tip-icon"><span class="tip-ring" style="--pct: {ring.pct}"></span></span>
      <span class="grow">{ring.estimated ? "~" : ""}{ring.pct}% context <span class="tip-dim">· {shortNum(ring.used)} / {shortNum(ring.limit)}</span></span>
    </li>
  {/if}
  {#if spend?.sessionTotalUsd}
    <li>
      <span class="tip-icon"><Icon name="coin" size={13} /></span>
      <span class="grow">
        {usd(spend.sessionTotalUsd, spend.sessionCostUnknown)} this session
        {#if server?.sessionCapUsd}<span class="tip-dim">· cap {usd(server.sessionCapUsd)}</span>{/if}
      </span>
    </li>
  {/if}
  {#if busyTerminals}
    <li><span class="tip-icon"><Icon name="terminal-2" size={13} /></span><span class="grow">{busyTerminals} command{busyTerminals === 1 ? "" : "s"} running</span></li>
  {/if}
</ul>
{#if syncing}<div class="tip-dim tip-foot">Syncing with the server…</div>{/if}

<style>
  .dirty {
    color: var(--warning);
  }
  .warn,
  .warn .tip-icon {
    color: var(--danger);
  }
  .activity.action .tip-icon {
    color: var(--warning);
  }
  .activity.finished .tip-icon {
    color: var(--success);
  }
  .activity.working .tip-icon {
    color: var(--info);
  }
  /* The one line that can be long (an ask's text): wrap it instead of clipping. */
  .activity .grow {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
</style>

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // §3.2 git_status: every project's git state on every server, where the
  // chat header only shows the open chat's.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { openChatSession, newChat } from "../ipc";
  import type { GitStatus } from "../types";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let open = $state(false);

  interface Repo {
    key: string;
    cid: ConnectionId;
    srv: ServerState;
    path: string;
    name: string;
    git: GitStatus;
  }
  const multiServer = $derived(Object.keys(app.servers).length > 1);
  const repos = $derived(
    Object.values(app.servers)
      .flatMap((srv) =>
        Object.values(srv.gitStatusByProject).map(
          (git): Repo => ({
            key: `${srv.connectionId}:${git.projectPath}`,
            cid: srv.connectionId,
            srv,
            path: git.projectPath,
            name: srv.projectName(git.projectPath),
            git,
          }),
        ),
      )
      .sort((a, b) => b.git.dirtyFiles - a.git.dirtyFiles || b.git.ahead + b.git.behind - (a.git.ahead + a.git.behind) || a.name.localeCompare(b.name)),
  );
  const current = $derived(app.active && app.activeConnectionId ? `${app.activeConnectionId}:${app.active.currentProjectPath}` : "");
  // The trigger speaks for the open chat's repo; with none open it sums them all.
  const here = $derived(repos.find((r) => r.key === current));
  const scope = $derived(here ? [here] : repos);
  const dirty = $derived(here ? here.git.dirtyFiles : repos.filter((r) => r.git.dirtyFiles > 0).length);
  const ahead = $derived(scope.reduce((n, r) => n + (r.git.hasUpstream ? r.git.ahead : 0), 0));
  const behind = $derived(scope.reduce((n, r) => n + (r.git.hasUpstream ? r.git.behind : 0), 0));

  function latestChat(r: Repo) {
    return [...(r.srv.sessionsByProject[r.path] ?? [])]
      .filter((s) => s.messageCount > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  function openRepo(r: Repo) {
    open = false;
    const latest = latestChat(r);
    if (latest) openChatSession(r.cid, latest.sessionId);
    else void newChat(r.cid, r.path);
  }
</script>

{#snippet reposCard()}
  <div class="tip-title">Git</div>
  <ul class="tip-list">
    {#each repos.slice(0, 8) as r (r.cid + r.path)}
      <li>
        <span class="grow">{r.name}</span>
        <span class="tip-dim">{r.git.detached ? "detached" : r.git.branch}</span>
        {#if r.git.dirtyFiles}<span>±{r.git.dirtyFiles}</span>{/if}
      </li>
    {/each}
    {#if repos.length > 8}<li class="tip-dim">and {repos.length - 8} more</li>{/if}
  </ul>
{/snippet}

{#if repos.length}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="sb-trigger"
      {@attach tip(reposCard)}
      aria-label="Git"
    >
      <Icon name="git-branch" size={12} />
      {#if here}<span class="branch" style="max-width: 10rem; white-space: nowrap">{here.git.detached ? "detached" : here.git.branch}</span>{/if}
      {#if dirty}<span class="changed">{here ? `±${dirty}` : `${dirty} changed`}</span>{:else if !here}<span class="dim">clean</span>{/if}
      {#if ahead}<span>↑{ahead}</span>{/if}
      {#if behind}<span>↓{behind}</span>{/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel git-panel" side="top" align="start" sideOffset={8}>
        <ul class="sb-list">
          {#each repos as r (r.key)}
            <li class="sb-row" class:current={r.key === current}>
              <button type="button" class="sb-row-main" {@attach tip("Open its latest chat")} onclick={() => openRepo(r)}>
                <span class="lead"><Icon name="folder" size={14} /></span>
                <span class="sb-row-text">
                  <span class="sb-row-name">{r.name}</span>
                  <span class="sb-row-meta" {@attach tip(r.path)}>
                    <Icon name="git-branch" size={11} />
                    <span class="branch">{r.git.detached ? "detached HEAD" : r.git.branch}</span>
                    {#if multiServer}<ServerAvatar name={r.srv.label} seed={r.srv.serverId} size={12} />{/if}
                  </span>
                </span>
                <span class="counts">
                  {#if r.git.dirtyFiles}<span class="changed" {@attach tip((r.git.files ?? []).map((f) => `${f.status}  ${f.path}`).join("\n") || undefined)}>±{r.git.dirtyFiles}</span>{/if}
                  {#if r.git.hasUpstream}
                    {#if r.git.ahead}<span {@attach tip("To push")}>↑{r.git.ahead}</span>{/if}
                    {#if r.git.behind}<span class="behind" {@attach tip("To pull")}>↓{r.git.behind}</span>{/if}
                    {#if !r.git.dirtyFiles && !r.git.ahead && !r.git.behind}<span class="dim">in sync</span>{/if}
                  {:else}
                    <span class="dim" {@attach tip("No upstream branch")}>local</span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="sb-foot">
          <span class="sb-foot-title">Git</span>
          <span class="sb-foot-meta">{repos.length} {repos.length === 1 ? "repo" : "repos"}</span>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.git-panel) {
    width: min(22rem, 92vw);
  }
  .changed {
    color: var(--warning);
  }
  .dim {
    opacity: 0.6;
  }
  .lead {
    display: flex;
    color: var(--text-dim);
  }
  .branch {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .counts {
    flex-shrink: 0;
    display: flex;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .counts .behind {
    color: var(--accent);
  }
</style>

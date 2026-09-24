<script lang="ts">
  // Status-bar git overview: every project's git state on every server
  // (§3.2 git_status), where the chat header only shows the open chat's.
  // Collapsed it counts repos with uncommitted changes and unpushed/unpulled
  // commits; the popup is a row per repo (clicking opens its most recent
  // chat) that expands to its changed files.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { openChatSession, newChat } from "../ipc";
  import type { GitStatus } from "../types";
  import { markOverflow } from "../overflow";
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
      // Most in need of attention first: changes, then unsynced commits.
      .sort((a, b) => b.git.dirtyFiles - a.git.dirtyFiles || b.git.ahead + b.git.behind - (a.git.ahead + a.git.behind) || a.name.localeCompare(b.name)),
  );
  const current = $derived(app.active && app.activeConnectionId ? `${app.activeConnectionId}:${app.active.currentProjectPath}` : "");
  const dirty = $derived(repos.filter((r) => r.git.dirtyFiles > 0).length);
  const ahead = $derived(repos.reduce((n, r) => n + (r.git.hasUpstream ? r.git.ahead : 0), 0));
  const behind = $derived(repos.reduce((n, r) => n + (r.git.hasUpstream ? r.git.behind : 0), 0));

  // The open chat's repo starts expanded; the rest are one click away.
  let toggled = $state<Record<string, boolean>>({});
  const isExpanded = (r: Repo) => toggled[r.key] ?? r.key === current;

  // Letter → color, matching how editors tint git decorations.
  const TONE: Record<string, string> = { M: "mod", T: "mod", A: "add", "?": "add", D: "del", U: "del", R: "ren", C: "ren" };
  const SHOWN = 8;

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
  // Terminals belong to a chat, so "a terminal in this repo" is its latest
  // chat's drawer.
  function openTerminal(r: Repo) {
    open = false;
    const latest = latestChat(r);
    if (!latest) return void newChat(r.cid, r.path);
    openChatSession(r.cid, latest.sessionId);
    r.srv.terminalOpenBySession[latest.sessionId] = true;
  }
</script>

{#if repos.length}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="sb-trigger"
      title={repos.map((r) => `${r.name}: ${r.git.detached ? "detached" : r.git.branch}${r.git.dirtyFiles ? ` ±${r.git.dirtyFiles}` : ""}`).join("\n")}
      aria-label="Git"
    >
      <Icon name="git-branch" size={12} />
      {#if dirty}<span class="changed">{dirty} changed</span>{:else}<span class="dim">clean</span>{/if}
      {#if ahead}<span>↑{ahead}</span>{/if}
      {#if behind}<span>↓{behind}</span>{/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel git-panel" side="top" align="start" sideOffset={8}>
        <ul class="sb-list" use:markOverflow>
          {#each repos as r (r.key)}
            {@const files = r.git.files ?? []}
            {@const expanded = files.length > 0 && isExpanded(r)}
            <li class="sb-row" class:current={r.key === current}>
              <button type="button" class="sb-row-main" title="Open its latest chat" onclick={() => openRepo(r)}>
                <span class="lead"><Icon name="folder" size={14} /></span>
                <span class="sb-row-text">
                  <span class="sb-row-name">{r.name}</span>
                  <span class="sb-row-meta" title={r.path}>
                    <Icon name="git-branch" size={11} />
                    <span class="branch">{r.git.detached ? "detached HEAD" : r.git.branch}</span>
                    {#if multiServer}<ServerAvatar name={r.srv.label} seed={r.srv.serverId} size={12} />{/if}
                  </span>
                </span>
                <span class="counts">
                  {#if r.git.dirtyFiles}<span class="changed">±{r.git.dirtyFiles}</span>{/if}
                  {#if r.git.hasUpstream}
                    {#if r.git.ahead}<span title="To push">↑{r.git.ahead}</span>{/if}
                    {#if r.git.behind}<span class="behind" title="To pull">↓{r.git.behind}</span>{/if}
                    {#if !r.git.dirtyFiles && !r.git.ahead && !r.git.behind}<span class="dim">in sync</span>{/if}
                  {:else}
                    <span class="dim" title="No upstream branch">local</span>
                  {/if}
                </span>
              </button>
              <button type="button" class="sb-row-action" title="Open a terminal in its latest chat" aria-label="Terminal" onclick={() => openTerminal(r)}>
                <Icon name="terminal-2" size={12} />
              </button>
              {#if files.length}
                <button
                  type="button"
                  class="sb-row-action toggle"
                  class:open={expanded}
                  title={expanded ? "Hide changes" : "Show changes"}
                  aria-label="Changed files"
                  aria-expanded={expanded}
                  onclick={() => (toggled[r.key] = !expanded)}
                >
                  <Icon name="chevron-down" size={12} />
                </button>
              {/if}
            </li>
            {#if expanded}
              <li class="files">
                {#each files.slice(0, SHOWN) as f (f.path)}
                  {@const cut = f.path.lastIndexOf("/") + 1}
                  <span class="file" title={f.path}>
                    <span class="st {TONE[f.status] ?? ''}">{f.status}</span>
                    <span class="path"><span class="base">{f.path.slice(cut)}</span>{#if cut}<span class="dir">{f.path.slice(0, cut - 1)}</span>{/if}</span>
                  </span>
                {/each}
                {#if r.git.dirtyFiles > SHOWN}
                  <span class="more">+{r.git.dirtyFiles - SHOWN} more</span>
                {/if}
              </li>
            {/if}
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
  /* The toggle stays visible (it carries state); only the terminal action
     waits for hover. */
  .toggle {
    opacity: 1;
  }
  .toggle :global(.icon) {
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .toggle:not(.open) :global(.icon) {
    transform: rotate(-90deg);
  }
  .files {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0.14rem 0.5rem 0.36rem 2.07rem;
  }
  .file {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    font-size: var(--text-label-size);
  }
  .st {
    flex-shrink: 0;
    width: 0.71rem;
    font-family: var(--code-font-family, monospace);
    font-weight: 600;
    color: var(--text-dim);
  }
  .st.mod {
    color: var(--warning);
  }
  .st.add {
    color: var(--success);
  }
  .st.del {
    color: var(--danger);
  }
  .st.ren {
    color: var(--accent);
  }
  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir {
    margin-left: 0.43rem;
    color: var(--text-dim);
  }
  .more {
    padding-left: 1.21rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>

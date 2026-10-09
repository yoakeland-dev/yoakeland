<script lang="ts">
  // The composer's branch chip: where this chat's project stands in git, and a way into the Git tab.
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const project = $derived(server?.projectBySession[sessionId]);
  const git = $derived(project ? server?.gitStatusByProject[project] : undefined);
  const branch = $derived(git?.detached ? "detached" : (git?.branch ?? ""));
</script>

{#snippet card()}
  {#if git}
    <div class="tip-title">{git.detached ? "Detached HEAD" : git.branch}</div>
    <dl class="tip-rows">
      <dt>Changed</dt><dd>{git.dirtyFiles} file{git.dirtyFiles === 1 ? "" : "s"}</dd>
      {#if git.hasUpstream}
        <dt>Ahead</dt><dd>{git.ahead} to push</dd>
        <dt>Behind</dt><dd>{git.behind} to pull</dd>
      {:else}
        <dt>Upstream</dt><dd class="tip-dim">none</dd>
      {/if}
    </dl>
  {/if}
{/snippet}

{#if git}
  <button
    type="button"
    class="picker-trigger git-chip"
    aria-label="Git: {branch}{git.dirtyFiles ? `, ${git.dirtyFiles} changed` : ''}"
    {@attach tip(card)}
    onclick={() => server?.openSidebarPanel(sessionId, "git")}
  >
    <Icon name="git-branch" size={14} />
    <span class="trigger-label">{branch}</span>
    {#if git.dirtyFiles}<span class="dirty">±{git.dirtyFiles}</span>{/if}
    {#if git.hasUpstream && git.ahead}<span>↑{git.ahead}</span>{/if}
    {#if git.hasUpstream && git.behind}<span>↓{git.behind}</span>{/if}
  </button>
{/if}

<style>
  /* The first thing to give way in a narrow composer: the branch name clips, the counts stay. */
  .git-chip {
    flex: 0 1 auto;
    min-width: 0;
    gap: 0.29rem;
    padding: 0 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  .git-chip .trigger-label {
    min-width: 0;
    max-width: 8rem;
  }
  .git-chip > :not(.trigger-label) {
    flex: none;
  }
  .dirty {
    color: var(--warning);
  }
</style>

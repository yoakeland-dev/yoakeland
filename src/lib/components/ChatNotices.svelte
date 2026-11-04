<script lang="ts">
  // Warnings about this chat that shouldn't hide in a chip: they sit over the composer, only while
  // they apply.
  import { fade } from "svelte/transition";
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const project = $derived(server?.projectBySession[sessionId]);
  const unsandboxed = $derived(!!server?.isUnsandboxed(project));
  const shellOff = $derived(!!server?.shellDisabled(project));
</script>

{#if unsandboxed}
  <div class="notices" role="status" transition:fade={{ duration: 120 }}>
    <div
      class="notice"
      {@attach tip(shellOff
        ? "No sandbox here, so the model gets no bash or terminals"
        : "Bash and terminals here have no sandbox. They can read and change anything the server's user can")}
    >
      <Icon name="warning" size={13} />
      <span>No sandbox<span class="more">{shellOff ? " · bash and terminals are off" : " · bash can reach anything on this machine"}</span></span>
    </div>
  </div>
{/if}

<style>
  /* A tab on the composer's top edge: opaque, inset past its corner radius, its bottom edge
     tucked under the box's top border so the two read as one shape. */
  .notices {
    position: relative;
    z-index: 0;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    margin: 0 0 calc(-1 * var(--radius-float));
    padding-bottom: var(--radius-float);
    background: var(--float-bg);
    color: var(--text-dim);
    border: 1px solid var(--float-border);
    border-bottom: 0;
    border-radius: var(--radius-float) var(--radius-float) 0 0;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
    padding: 0.36rem 0.71rem;
    font-size: var(--text-label-size);
  }
  .notice :global(svg) {
    flex-shrink: 0;
  }
  /* The tooltip has the rest; a narrow composer keeps just the name of it. */
  @container (max-width: 26rem) {
    .more {
      display: none;
    }
  }
  .notice > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

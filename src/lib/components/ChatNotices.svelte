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
  const takenOver = $derived(!!server?.takenOverSessions[sessionId]);
</script>

{#if unsandboxed || takenOver}
  <div class="notices" role="status" transition:fade={{ duration: 120 }}>
    {#if unsandboxed}
      <div
        class="notice"
        {@attach tip(shellOff
          ? "This project has no sandbox, so the model is not given bash or terminals here"
          : "bash and terminals in this project have no sandbox isolation: they can read and change anything the server's user can")}
      >
        <Icon name="warning" size={13} />
        <span>No sandbox{shellOff ? " · bash and terminals are off" : " · bash can reach anything on this machine"}</span>
      </div>
    {/if}
    {#if takenOver}
      <div class="notice"><Icon name="warning" size={13} /><span>Opened elsewhere</span></div>
    {/if}
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
    margin: 0 22px -1px;
    background: color-mix(in srgb, var(--danger) 14%, var(--panel-bg));
    color: var(--danger);
    border: 1px solid var(--float-border);
    border-bottom: 0;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    min-width: 0;
    padding: 0.36rem 0.71rem;
    font-size: var(--text-label-size);
  }
  .notice + .notice {
    border-top: 1px solid var(--float-border);
  }
  .notice span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

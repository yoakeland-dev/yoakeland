<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // A saved pairing (splitPartnerFor, linkedSessionId, SPEC.md §3.1 set_session_layout):
  // `primary` keeps its normal position; `secondary` tags along underneath regardless of its own state.
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionLayout } from "../ipc";
  import Icon from "./Icon.svelte";
  import ChatRow from "./ChatRow.svelte";
  import type { SessionSummary } from "../types";

  let {
    primary,
    secondary,
    connectionId,
    variant = "default",
  }: {
    primary: SessionSummary;
    secondary: SessionSummary;
    connectionId: ConnectionId;
    variant?: "default" | "running" | "attention";
  } = $props();

  let server = $derived(app.servers[connectionId]);
  const active = $derived(
    connectionId === app.activeConnectionId &&
      (primary.sessionId === server?.currentSessionId || secondary.sessionId === server?.currentSessionId),
  );
</script>

<div class="split-entry" class:active>
  {#each [primary, secondary] as s, i (s.sessionId)}
    <div class="half">
      <ChatRow {connectionId} session={s} variant={i === 0 ? variant : "default"} compact>
        {#snippet actions()}
          {#if i === 0}
            <button
              type="button"
              class="act"
              {@attach tip("Ungroup")}
              aria-label="Ungroup"
              onclick={() => setSessionLayout(connectionId, primary.sessionId, null)}
            >
              <Icon name="unlink" size={12} />
            </button>
          {/if}
        {/snippet}
      </ChatRow>
    </div>
  {/each}
</div>

<style>
  /* One chat drawn as two rows: the group takes the row background, a thin rail ties them together. */
  .split-entry {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    margin: 0.14rem 0;
    border-radius: var(--radius-sm);
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .split-entry::before {
    content: "";
    position: absolute;
    left: 0.25rem;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--accent) 45%, transparent);
    pointer-events: none;
  }
  .split-entry:hover {
    background: var(--sidebar-hover);
  }
  .split-entry.active {
    background: var(--sidebar-active);
  }
  .act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
  }
  .act:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
</style>

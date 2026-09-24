<script lang="ts">
  // A saved pairing (splitPartnerFor, linkedSessionId, SPEC.md §3.1 set_session_layout):
  // `primary` keeps its normal position; `secondary` tags along underneath regardless of its own state.
  import { app, type ConnectionId } from "../state.svelte";
  import { setSessionLayout, openChatSession } from "../ipc";
  import { sessionTitle } from "../format";
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
    <div class="half" class:secondary={i === 1}>
      <ChatRow {connectionId} session={s} variant={i === 0 ? variant : "default"} compact>
        {#snippet actions()}
          <button
            type="button"
            class="act"
            title="Maximize"
            aria-label={`Maximize ${sessionTitle(s)}`}
            onclick={() => {
              setSessionLayout(connectionId, primary.sessionId, null);
              openChatSession(connectionId, s.sessionId);
            }}
          >
            <Icon name="maximize" size={12} />
          </button>
          {#if i === 0}
            <button
              type="button"
              class="act"
              title="Ungroup"
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
  .split-entry {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--accent-dim);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    margin: 0.14rem 0;
    overflow: hidden;
  }
  .split-entry.active {
    border-color: var(--accent);
  }
  .half.secondary {
    border-top: 1px solid var(--panel-border);
    opacity: 0.85;
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
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
    cursor: pointer;
  }
  .act:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
</style>

<script lang="ts">
  // A saved pairing (see splitPartnerFor, driven by the anchor session's own
  // server-persisted linkedSessionId — SPEC.md §3.1 set_session_layout),
  // rendered as one entry with both sessions stacked vertically rather than
  // as two separate rows — `primary` keeps the position it'd have on its
  // own (its section, its timestamp slot); `secondary` just tags along
  // underneath regardless of its own timestamp or running state. Used both
  // from Sidebar.svelte's Running section and from ProjectGroup.svelte, so a
  // pairing works however the two sessions are otherwise split across
  // sections.
  import { app } from "../state.svelte";
  import { setSessionLayout, openChatSession } from "../ipc";
  import { sessionTitle } from "../format";
  import Icon from "./Icon.svelte";
  import type { SessionSummary } from "../types";

  let { primary, secondary }: { primary: SessionSummary; secondary: SessionSummary } = $props();

  const statusIcon = {
    working: "loader-2",
    action: "alert-circle",
    finished: "circle-check",
    idle: "message-circle",
  } as const;
</script>

<!-- A plain container, not a <button>: each row below is independently
     clickable (open that specific session) AND carries its own "maximize"
     button, and a native <button> cannot contain another interactive
     control (nested <button>s are invalid HTML — the browser silently
     splits/hoists one out, breaking layout and click handling). Rows use
     role="button" + a keydown handler instead, the standard "clickable row
     with a nested action button" pattern (the row isn't itself a focusable
     native control, but the maximize button inside it is a real <button>,
     which is exactly what should get keyboard/AT focus for that action). -->
<div
  class="split-entry"
  class:active={primary.sessionId === app.currentSessionId ||
    secondary.sessionId === app.currentSessionId}
>
  {#each [primary, secondary] as s, i (s.sessionId)}
    <div
      class="split-row"
      class:secondary={i === 1}
      role="button"
      tabindex="0"
      onclick={() => openChatSession(s.sessionId)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openChatSession(s.sessionId);
        }
      }}
    >
      <span class="status-icon status-{app.sessionStatus(s.sessionId)}">
        <Icon name={statusIcon[app.sessionStatus(s.sessionId)]} size={12} />
      </span>
      <span class="label">{sessionTitle(s)}</span>
      <button
        type="button"
        class="maximize-btn"
        title="Maximize"
        aria-label={`Maximize ${sessionTitle(s)}`}
        onclick={(e) => {
          e.stopPropagation();
          setSessionLayout(primary.sessionId, null);
          openChatSession(s.sessionId);
        }}
      >
        <Icon name="maximize" size={12} />
      </button>
    </div>
  {/each}
  <button
    type="button"
    class="ungroup-btn"
    title="Ungroup"
    aria-label="Ungroup"
    onclick={() => setSessionLayout(primary.sessionId, null)}
  >
    <Icon name="unlink" size={12} />
  </button>
</div>

<style>
  .split-entry {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--accent-dim);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    margin: 0.14rem 0;
    overflow: hidden;
  }
  .ungroup-btn {
    position: absolute;
    top: 0.36rem;
    right: 0.36rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .split-entry:hover .ungroup-btn {
    opacity: 1;
  }
  .ungroup-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .split-entry.active {
    border-color: var(--accent);
  }
  .split-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.64rem;
    color: var(--text);
    font-size: 0.8rem;
    min-width: 0;
    cursor: pointer;
  }
  .split-row:hover,
  .split-row:focus-visible {
    background: var(--sidebar-hover);
  }
  .split-row.secondary {
    border-top: 1px solid var(--panel-border);
    opacity: 0.8;
  }
  .maximize-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    margin: 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity calc(0.15s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .split-row:hover .maximize-btn,
  .split-row:focus-within .maximize-btn {
    opacity: 1;
  }
  .maximize-btn:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .status-icon {
    flex-shrink: 0;
    display: inline-flex;
  }
  .status-icon.status-idle {
    color: var(--sidebar-fg-dim);
  }
  .status-icon.status-action {
    color: var(--warning);
  }
  .status-icon.status-finished {
    color: var(--success);
  }
  .status-icon.status-working {
    color: var(--info);
  }
  .status-icon.status-working :global(svg) {
    animation: spin calc(1s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

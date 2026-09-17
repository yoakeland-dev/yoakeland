<script lang="ts">
  // Bottom drawer, toggled from StatusBar — placeholder for an integrated
  // terminal (not implemented yet). Spans the full width below both the main
  // chat and the right sidebar. `overflow: hidden` + height:0 when closed
  // means there's nothing in flow to scroll to — collapsing it isn't just
  // moving it off-screen, the content genuinely isn't reachable.
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";

  const HEIGHT = 240;
</script>

<div
  class="terminal-slot"
  class:open={app.terminalOpen}
  style="height: {app.terminalOpen ? `calc(${HEIGHT}px + var(--chat-margin))` : '0px'}"
>
  <div class="terminal-panel">
    <Icon name="terminal-2" size={18} />
    <span>Integrated terminal — coming soon</span>
  </div>
</div>

<style>
  .terminal-slot {
    flex-shrink: 0;
    overflow: hidden;
    transition: height calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .terminal-panel {
    height: 240px;
    /* Left is 0, not --chat-margin — same alignment as the chat panel above
       it (ChatPanel.svelte's .panel), which also touches the content
       column's left edge with no gap. */
    margin: 0 var(--chat-margin) var(--chat-margin) 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: var(--text-body-size);
    font-family: var(--code-font-family);
  }
</style>

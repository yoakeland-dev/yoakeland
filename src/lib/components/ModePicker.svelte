<script module lang="ts">
  import type { ChatMode } from "../types";
  import type { ComponentProps } from "svelte";
  import type IconComp from "./Icon.svelte";

  export type ModeMeta = {
    id: ChatMode;
    label: string;
    hint: string;
    icon: ComponentProps<typeof IconComp>["name"];
    // Color this mode's trigger/row lights up to on hover/open. Only
    // Autonomous carries one: it's the mode that bypasses permission checks
    // outright, so it's the one worth flagging.
    tint?: string;
  };

  export const MODES: ModeMeta[] = [
    {
      id: "read_only",
      label: "Read Only",
      hint: "The model can only read files — no writes, no bash, no web tools",
      icon: "eye",
    },
    {
      id: "read_write",
      label: "Read/Write",
      hint: "Ask before every mutating tool call",
      icon: "question-mark",
    },
    {
      id: "autonomous",
      label: "Autonomous",
      hint: "Every permission check is bypassed — nothing will ask first",
      icon: "player-track-next",
      tint: "var(--warning)",
    },
    {
      id: "plan",
      label: "Plan",
      hint: "Draft a plan before acting — the model only gets read-only tools",
      icon: "clipboard-list",
    },
  ];

  export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ChatMode, ModeMeta>;
</script>

<script lang="ts">
  import { Popover } from "bits-ui";
  import { app } from "../state.svelte";
  import { setMode, setWebToolsEnabled } from "../ipc";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  let open = $state(false);

  const currentMode = $derived(server?.modeBySession[sessionId] ?? "read_write");
  const currentModeMeta = $derived(MODE_BY_ID[currentMode]);
  const projectPath = $derived(server?.projectBySession[sessionId]);
  const webToolsEnabled = $derived(
    projectPath ? (server?.webToolsEnabledByProject[projectPath] ?? true) : true,
  );

  function pick(id: ChatMode) {
    if (!cid || !server) return;
    // Optimistic — mode_set (state.svelte.ts) confirms/corrects this once the
    // round trip lands, same pattern as every other set_* call here.
    server.modeBySession[sessionId] = id;
    server.setLastUsedMode(id);
    setMode(cid, sessionId, id);
    open = false;
  }

  function toggleWebTools() {
    if (cid && projectPath) setWebToolsEnabled(cid, projectPath, !webToolsEnabled);
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={`picker-trigger${open ? " open" : ""}${currentModeMeta.tint ? " tinted" : ""}`}
    style={`--mode-tint: ${currentModeMeta.tint ?? "var(--text)"}`}
    title={currentModeMeta.hint}
  >
    <Icon name={currentModeMeta.icon} size={13} />
    <span class="trigger-label">{currentModeMeta.label}</span>
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content class="mode-panel" side="top" align="start" sideOffset={8}>
      <div class="mode-list">
        {#each MODES as mode (mode.id)}
          <button
            type="button"
            class="mode-row"
            class:selected={mode.id === currentMode}
            style={`--mode-tint: ${mode.tint ?? "var(--text)"}`}
            onclick={() => pick(mode.id)}
          >
            <Icon name={mode.icon} size={15} />
            <span class="mode-row-text">
              <span class="mode-row-label">{mode.label}</span>
              <span class="mode-row-hint">{mode.hint}</span>
            </span>
            {#if mode.id === currentMode}<Icon name="check" size={13} />{/if}
          </button>
        {/each}
      </div>

      {#if projectPath}
        <div class="tools-row">
          <button
            type="button"
            class="tool-chip"
            class:active={webToolsEnabled}
            title={webToolsEnabled ? "Web search enabled for this project" : "Web search disabled for this project"}
            onclick={toggleWebTools}
          >
            <Icon name="search" size={14} />
          </button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.picker-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    height: 1.86rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    padding: 0 0.71rem;
    font-size: var(--text-label-size);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.picker-trigger:hover),
  :global(.picker-trigger.open) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  /* Autonomous is the one mode that bypasses permission checks outright —
     it stays tinted at rest (not just on hover/open) so that's visible from
     a glance at the collapsed toolbar, not just from opening the popover. */
  :global(.picker-trigger.tinted) {
    color: var(--mode-tint);
  }
  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.mode-panel) {
    width: 18rem;
    max-width: calc(100vw - 2rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    padding: 0.43rem;
    z-index: var(--z-popover);
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.mode-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  .mode-list {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .mode-row {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    padding: 0.5rem 0.57rem;
    color: var(--text-dim);
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .mode-row:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--mode-tint);
  }
  .mode-row.selected {
    background: var(--sidebar-active);
    color: var(--mode-tint);
  }
  .mode-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .mode-row-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }
  .mode-row-hint {
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .tools-row {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    margin-top: 0.43rem;
    padding: 0.43rem 0.57rem 0.14rem;
    border-top: 1px solid var(--panel-border);
  }
  .tool-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.86rem;
    height: 1.86rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .tool-chip:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .tool-chip.active {
    background: var(--accent-dim);
    color: var(--accent);
  }
</style>

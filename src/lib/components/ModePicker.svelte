<script module lang="ts">
  import type { ChatMode } from "../types";
  import type { ComponentProps } from "svelte";
  import type IconComp from "./Icon.svelte";

  export type ModeMeta = {
    id: ChatMode;
    label: string;
    hint: string;
    icon: ComponentProps<typeof IconComp>["name"];
    // Only Autonomous carries one: the mode that bypasses permission checks
    // outright is the one worth flagging.
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
  import { tip } from "../tooltip.svelte";
  import { Popover, Switch } from "bits-ui";
  import { app } from "../state.svelte";
  import { setMode, setWebToolsEnabled } from "../ipc";
  import { isCli, cliMeta } from "../modelVendor";
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

  // §4c/§6b: a CLI agent brings its own tools, so mode maps onto its own
  // permission mode and yoakeland's web tools don't apply.
  const cliProvider = $derived.by(() => {
    const p = server?.providers.find((x) => x.name === server?.providerBySession[sessionId]);
    return p && isCli(p) ? p : undefined;
  });

  function pick(id: ChatMode) {
    if (!cid || !server) return;
    // Optimistic; mode_set (state.svelte.ts) confirms/corrects once the round trip lands.
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
    {@attach tip(currentModeMeta.hint, "chat.mode")}
  >
    <span class="trigger-icon">
      <span class="crossfade a"><Icon name={currentModeMeta.icon} size={13} /></span>
      <span class="crossfade b"><Icon name="chevron-down" size={13} /></span>
    </span>
    <span class="trigger-label">{currentModeMeta.label}</span>
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content class="mode-panel" side="bottom" align="start" sideOffset={8} collisionPadding={8}>
      <div class="panel-heading">Mode</div>
      <div class="mode-list" role="radiogroup" aria-label="Mode">
        {#each MODES as mode (mode.id)}
          <button
            type="button"
            role="radio"
            aria-checked={mode.id === currentMode}
            class="mode-row"
            class:selected={mode.id === currentMode}
            style={`--mode-tint: ${mode.tint ?? "var(--accent)"}`}
            onclick={() => pick(mode.id)}
          >
            <span class="tile"><Icon name={mode.icon} size={14} /></span>
            <span class="row-text">
              <span class="row-label">{mode.label}</span>
              <span class="row-hint">{mode.hint}</span>
            </span>
            <span class="radio" aria-hidden="true"></span>
          </button>
        {/each}
      </div>

      {#if cliProvider}
        <p class="cli-note">
          {cliMeta(cliProvider).title} runs its own tools: this maps onto its own permission mode.
          {#if currentMode === "autonomous"}
            <strong>Autonomous is the agent's bypass mode, with no sandbox at all.</strong>
          {/if}
        </p>
      {:else if projectPath}
        <div class="panel-heading tools">Tools <span class="scope">this project</span></div>
        <label class="tool-row">
          <span class="tile" class:on={webToolsEnabled}><Icon name="world" size={14} /></span>
          <span class="row-text">
            <span class="row-label">Web search</span>
            <span class="row-hint">Search the web and fetch pages</span>
          </span>
          <Switch.Root class="switch-root" checked={webToolsEnabled} onCheckedChange={toggleWebTools}>
            <Switch.Thumb class="switch-thumb" />
          </Switch.Root>
        </label>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  /* Autonomous is the one mode that bypasses permission checks outright:
     it stays tinted at rest (not just on hover/open) so that's visible from
     a glance at the collapsed toolbar, not just from opening the popover. */
  :global(.picker-trigger.tinted) {
    color: var(--mode-tint);
  }

  .cli-note {
    margin: 0.36rem 0.5rem 0.2rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    line-height: 1.4;
  }
  .cli-note strong {
    color: var(--warning);
    font-weight: 500;
  }
  :global(.mode-panel) {
    width: 19rem;
    max-width: calc(100vw - 2rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    padding: 0.36rem;
    z-index: var(--z-popover);
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.mode-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  /* Same small-caps label as the palette's and Settings' group headings. */
  .panel-heading {
    display: flex;
    align-items: baseline;
    gap: 0.43rem;
    padding: 0.43rem 0.57rem 0.29rem;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .panel-heading.tools {
    margin-top: 0.29rem;
    padding-top: 0.71rem;
    border-top: 1px solid var(--panel-border);
  }
  .scope {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    opacity: 0.7;
  }
  .mode-list {
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .mode-row,
  .tool-row {
    display: flex;
    align-items: center;
    gap: 0.64rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.43rem 0.57rem;
    color: var(--text-dim);
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .mode-row:hover,
  .tool-row:hover {
    background: var(--sidebar-hover);
  }
  .mode-row.selected {
    background: var(--sidebar-active);
  }
  /* Icon on a small tile, lit in the mode's own tint once selected. */
  .tile {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.86rem;
    height: 1.86rem;
    border-radius: var(--radius-xs);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .mode-row.selected .tile {
    background: color-mix(in srgb, var(--mode-tint) 18%, transparent);
    color: var(--mode-tint);
  }
  .tool-row .tile.on {
    background: var(--accent-dim);
    color: var(--accent);
  }
  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .row-label {
    font-size: var(--text-body-size);
    font-weight: 500;
    color: var(--text);
  }
  .row-hint {
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--text-dim);
  }
  /* A radio dot rather than a trailing checkmark: one of these is always
     picked, and the empty ring on the others says so. */
  .radio {
    flex-shrink: 0;
    width: 0.86rem;
    height: 0.86rem;
    border-radius: 50%;
    border: 1.5px solid var(--panel-border);
    transition:
      border-color calc(0.12s * var(--anim-speed, 1)) ease,
      box-shadow calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .mode-row.selected .radio {
    border-color: var(--mode-tint);
    box-shadow: inset 0 0 0 2.5px var(--float-bg), inset 0 0 0 5px var(--mode-tint);
  }
</style>

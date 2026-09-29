<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { Popover, Switch } from "bits-ui";
  import { app } from "../state.svelte";
  import { setWebToolsEnabled } from "../ipc";
  import { cliMeta } from "../modelVendor";
  import { LADDER, PLAN, MODE_BY_ID, modeHint, sessionModes, chooseMode, nearestAvailable, getRunOnce, setRunOnce } from "../modes";
  import type { ChatMode, ModeSpec } from "../types";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  let open = $state(false);

  const currentMode = $derived(server?.modeBySession[sessionId] ?? "read_write");
  const inPlan = $derived(currentMode === "plan");
  // In Plan the ladder shows the rung the plan will be carried out on, dimmed.
  const rung = $derived<ChatMode>(inPlan ? (server?.tierBeforePlan[sessionId] ?? "read_write") : currentMode);
  const currentMeta = $derived(MODE_BY_ID[currentMode] ?? MODE_BY_ID.read_write);
  const projectPath = $derived(server?.projectBySession[sessionId]);
  const webToolsEnabled = $derived(projectPath ? (server?.webToolsEnabledByProject[projectPath] ?? true) : true);

  // §4c/§6b: a CLI agent brings its own tools, so mode maps onto its own permission mode and
  // yoakeland's web tools don't apply.
  const info = $derived(sessionModes(server, sessionId));
  const cliProvider = $derived(info.cli ? info.provider : undefined);
  const rungs = $derived(LADDER.filter((m) => info.available.includes(m.id)));

  // A model switch can leave the chat in a mode the new model doesn't have.
  $effect(() => {
    if (!server || !cid || !info.specs) return;
    if (!info.available.includes(currentMode)) chooseMode(server, cid, sessionId, nearestAvailable(currentMode, info.available));
  });

  let runOnce = $state(getRunOnce());
  const runOnceActive = $derived(!!server?.runOnce[sessionId]);
  function toggleRunOnce() {
    runOnce = !runOnce;
    setRunOnce(runOnce);
  }

  function pick(id: ChatMode) {
    if (!cid || !server) return;
    chooseMode(server, cid, sessionId, id);
    open = false;
  }

  function toggleWebTools() {
    if (cid && projectPath) setWebToolsEnabled(cid, projectPath, !webToolsEnabled);
  }

  const CELLS = [
    ["read", "Read"],
    ["edit", "Edit"],
    ["run", "Run"],
    ["network", "Web"],
  ] as const;
  const POLICY_WORD = { allow: "without asking", ask: "asks first", deny: "not allowed" };
  const cellTip = (spec: ModeSpec, cell: (typeof CELLS)[number]) => `${cell[1]}: ${POLICY_WORD[spec.policy[cell[0]]]}`;

  const planHow = (spec?: ModeSpec) =>
    !cliProvider || !spec?.plan || spec.plan === "yoakeland"
      ? ""
      : spec.plan === "native"
        ? `${cliMeta(cliProvider).title}'s own plan mode`
        : `${cliMeta(cliProvider).title} is asked to plan`;
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={`picker-trigger${open ? " open" : ""}${currentMeta.tint ? " tinted" : ""}`}
    style={`--mode-tint: ${currentMeta.tint ?? "var(--text)"}`}
    {@attach tip(modeHint(currentMode, info.specs?.[currentMode]), "chat.mode")}
  >
    <span class="trigger-icon">
      <span class="crossfade a"><Icon name={currentMeta.icon as any} size={13} /></span>
      <span class="crossfade b"><Icon name="chevron-down" size={13} /></span>
    </span>
    <span class="trigger-label">{currentMeta.label}{runOnceActive ? " · 1 turn" : ""}</span>
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content class="mode-panel" side="bottom" align="start" sideOffset={8} collisionPadding={8}>
      <div class="panel-heading">Without asking</div>
      <div class="mode-list" role="radiogroup" aria-label="Mode">
        {#each rungs as mode (mode.id)}
          {@const spec = info.specs?.[mode.id]}
          <button
            type="button"
            role="radio"
            aria-checked={mode.id === rung && !inPlan}
            class="mode-row"
            class:selected={mode.id === rung && !inPlan}
            class:resting={mode.id === rung && inPlan}
            style={`--mode-tint: ${mode.tint ?? "var(--accent)"}`}
            onclick={() => pick(mode.id)}
          >
            <span class="tile"><Icon name={mode.icon as any} size={14} /></span>
            <span class="row-text">
              <span class="row-label">
                {mode.label}
                {#if cliProvider && spec?.enforcedBy === "yoakeland"}
                  <span class="badge" {@attach tip(`${cliMeta(cliProvider).title} has no matching mode, so yoakeland's own checks enforce this one.`)}>yoakeland</span>
                {:else if cliProvider && spec?.native}
                  <span class="native">{spec.native}</span>
                {/if}
              </span>
              <span class="row-hint">{modeHint(mode.id, spec)}</span>
              {#if spec}
                <span class="strip" aria-hidden="true">
                  {#each CELLS as cell (cell[0])}
                    <span class={`cell ${spec.policy[cell[0]]}`} {@attach tip(cellTip(spec, cell))}><i></i>{cell[1]}</span>
                  {/each}
                </span>
              {/if}
            </span>
            <span class="radio" aria-hidden="true"></span>
          </button>
        {/each}
      </div>

      {#if info.available.includes("plan")}
        {@const spec = info.specs?.plan}
        <div class="divider"></div>
        <button
          type="button"
          role="radio"
          aria-checked={inPlan}
          class="mode-row"
          class:selected={inPlan}
          style="--mode-tint: var(--accent)"
          onclick={() => pick(inPlan ? rung : "plan")}
        >
          <span class="tile"><Icon name={PLAN.icon as any} size={14} /></span>
          <span class="row-text">
            <span class="row-label">
              {PLAN.label}
              {#if planHow(spec)}<span class="native">{planHow(spec)}</span>{/if}
            </span>
            <span class="row-hint">{modeHint("plan")}</span>
          </span>
          <span class="radio" aria-hidden="true"></span>
        </button>
      {/if}

      {#if rungs.some((m) => m.id === "autonomous")}
        <label class="tool-row once">
          <span class="tile" class:on={runOnce}><Icon name="clock" size={14} /></span>
          <span class="row-text">
            <span class="row-label">Run for one turn</span>
            <span class="row-hint">Choosing Run drops back when the turn ends</span>
          </span>
          <Switch.Root class="switch-root" checked={runOnce} onCheckedChange={toggleRunOnce}>
            <Switch.Thumb class="switch-thumb" />
          </Switch.Root>
        </label>
      {/if}

      {#if cliProvider}
        <p class="cli-note">{cliMeta(cliProvider).title} runs its own tools; these modes map onto its own permission settings.</p>
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
  .row-label {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .native,
  .badge {
    font-size: 0.64rem;
    font-weight: 400;
    color: var(--text-dim);
  }
  .badge {
    padding: 0 0.32rem;
    border-radius: var(--radius-xs);
    background: rgba(255, 255, 255, 0.06);
  }
  /* What the mode leaves free (filled), asks about (half) or forbids (empty), read left to right. */
  .strip {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.22rem;
  }
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.64rem;
    color: var(--text-dim);
  }
  .cell i {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }
  .cell.allow i {
    background: currentColor;
  }
  .cell.ask i {
    background: linear-gradient(90deg, currentColor 50%, transparent 50%);
  }
  .cell.deny {
    opacity: 0.45;
  }
  .mode-row.resting {
    background: color-mix(in srgb, var(--sidebar-active) 45%, transparent);
  }
  .divider {
    height: 1px;
    margin: 0.29rem 0.57rem;
    background: var(--panel-border);
  }
  .tool-row.once {
    margin-top: 0.07rem;
  }
</style>

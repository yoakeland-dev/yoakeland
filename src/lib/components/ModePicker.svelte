<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { slide } from "svelte/transition";
  import { app } from "../state.svelte";
  import { setWebToolsEnabled, setRuntimeSettings } from "../ipc";
  import { LADDER, MODES, PLAN, MODE_BY_ID, modeHint, sessionModes, chooseMode, nearestAvailable, getRunOnce, setRunOnce } from "../modes";
  import type { ChatMode } from "../types";
  import Icon from "./Icon.svelte";
  import ModeDetail from "./ModeDetail.svelte";
  import SlideText from "./SlideText.svelte";
  import Slider from "./ui/Slider.svelte";
  import Switch from "./ui/Switch.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);
  let open = $state(false);

  const currentMode = $derived(server?.modeBySession[sessionId] ?? "read_write");
  const inPlan = $derived(currentMode === "plan");
  // In Plan the ladder rests on the rung the plan will be carried out on.
  const rung = $derived<ChatMode>(inPlan ? (server?.tierBeforePlan[sessionId] ?? "read_write") : currentMode);
  const currentMeta = $derived(MODE_BY_ID[currentMode] ?? MODE_BY_ID.read_write);
  const projectPath = $derived(server?.projectBySession[sessionId]);
  const webToolsEnabled = $derived(projectPath ? (server?.webToolsEnabledByProject[projectPath] ?? true) : true);

  const info = $derived(sessionModes(server, sessionId));
  const cliProvider = $derived(info.cli ? info.provider : undefined);
  // Only yoakeland's own bash is affected: a CLI agent runs commands under its own sandbox and rules.
  const unsandboxed = $derived(!cliProvider && !!server?.isUnsandboxed(projectPath));
  const shellOff = $derived(unsandboxed && !!server?.shellDisabled(projectPath));
  function toggleShellOff() {
    if (cid) setRuntimeSettings(cid, { disableBashWhenUnsandboxed: !server?.runtime?.disableBashWhenUnsandboxed });
  }
  const rungs = $derived(LADDER.filter((m) => info.available.includes(m.id)));
  const canPlan = $derived(info.available.includes("plan"));

  // A model switch can leave the chat in a mode the new model doesn't have.
  $effect(() => {
    if (!server || !cid || !info.specs) return;
    if (!info.available.includes(currentMode)) chooseMode(server, cid, sessionId, nearestAvailable(currentMode, info.available));
  });

  // The detail follows the pointer over a rung, and rests on the chat's own mode.
  let hovered = $state<ChatMode | null>(null);
  const shown = $derived<ChatMode>(hovered ?? currentMode);

  let runOnce = $state(getRunOnce());
  const runOnceActive = $derived(!!server?.runOnce[sessionId]);
  // Flipped while already on Run, it applies to this chat right away.
  function toggleRunOnce() {
    runOnce = !runOnce;
    setRunOnce(runOnce);
    if (!server || currentMode !== "autonomous") return;
    if (runOnce) server.runOnce[sessionId] = server.lastUsedMode && server.lastUsedMode !== "autonomous" ? server.lastUsedMode : "read_write";
    else delete server.runOnce[sessionId];
  }

  // Plan is a phase in front of the dial: while planning, the dial says where the plan lands.
  function pick(id: ChatMode) {
    if (!cid || !server) return;
    if (inPlan) server.tierBeforePlan[sessionId] = id;
    else chooseMode(server, cid, sessionId, id);
  }
  function togglePlan() {
    if (cid && server) chooseMode(server, cid, sessionId, inPlan ? rung : "plan");
  }
  const index = $derived(Math.max(0, rungs.findIndex((m) => m.id === rung)));
  const stops = $derived(rungs.map((m) => ({ key: m.id, short: m.label, name: m.label })));
  // Which way the trigger label rolls: up when the mode went further along the scale.
  let dir = $state(1);
  let lastPos = -1;
  $effect.pre(() => {
    const at = MODES.findIndex((m) => m.id === currentMode);
    dir = at >= lastPos ? 1 : -1;
    lastPos = at;
  });
  function toggleWebTools() {
    if (cid && projectPath) setWebToolsEnabled(cid, projectPath, !webToolsEnabled);
  }
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
    <span class="trigger-label"><SlideText text={currentMeta.label + (runOnceActive ? " · 1 turn" : "")} {dir} /></span>
    {#if unsandboxed}<span class="danger-dot" class:off={shellOff} aria-label="No sandbox"></span>{/if}
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content class="mode-panel" side="bottom" align="start" sideOffset={8} collisionPadding={8}>
      <div class="panel-head">
        <span class="panel-heading">Mode</span>
        {#if canPlan}
          <button
            type="button"
            class="plan-chip"
            class:on={inPlan}
            aria-pressed={inPlan}
            onclick={togglePlan}
            onpointerenter={() => (hovered = "plan")}
            onpointerleave={() => (hovered = null)}
          >
            <Icon name={PLAN.icon as any} size={12} />Plan
          </button>
        {/if}
      </div>

      {#if unsandboxed}
        <div class="danger" role="alert">
          <Icon name="warning" size={14} />
          <div>
            <strong>{shellOff ? "No sandbox: bash is off" : "No sandbox: bash is unprotected"}</strong>
            <p>
              {#if shellOff}
                This project has no isolation, so the model is not given bash or terminals here.
              {:else}
                This project has no isolation. Bash and terminals run straight on this machine and can read or change anything
                the server's user can, and there is nothing to contain a mistake.
              {/if}
            </p>
          </div>
        </div>
        <label class="line danger-line">
          <span>Turn bash off <em>when there's no sandbox</em></span>
          <Switch checked={shellOff} onchange={toggleShellOff} />
        </label>
      {/if}

      <Slider
        {stops}
        value={index}
        hot={rung === "autonomous"}
        dim={inPlan}
        tone="neutral"
        label="Mode"
        oninput={(i) => pick(rungs[i].id)}
        onhover={(i) => (hovered = i === null ? null : rungs[i].id)}
      />

      <ModeDetail mode={shown} spec={info.specs?.[shown]} cli={cliProvider} {unsandboxed} {shellOff} />

      {#if shown === "autonomous" || (currentMode === "autonomous" && !hovered)}
        <label class="line" transition:slide={{ duration: 160 * (app.settings.animationSpeed || 0) }}>
          <span>Just this turn</span>
          <Switch checked={runOnce} onchange={toggleRunOnce} />
        </label>
      {/if}
      {#if !cliProvider && projectPath}
        <label class="line foot">
          <span>Web search <em>this project</em></span>
          <Switch checked={webToolsEnabled} onchange={toggleWebTools} />
        </label>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  /* Run stays tinted at rest, so a glance at the collapsed toolbar shows nothing will ask. */
  :global(.picker-trigger.tinted) {
    color: var(--mode-tint);
  }
  :global(.mode-panel) {
    width: 16.5rem;
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
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.29rem 0.57rem 0.29rem;
  }
  .panel-heading {
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .plan-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.14rem 0.5rem;
    font-size: 0.7rem;
    color: var(--text-dim);
    background: none;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .plan-chip:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .plan-chip.on {
    background: var(--accent-dim);
    border-color: transparent;
    color: var(--accent);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.29rem 0.57rem;
    font-size: 0.74rem;
    color: var(--text);
    cursor: pointer;
  }
  .line em {
    font-style: normal;
    font-size: 0.66rem;
    color: var(--text-dim);
    margin-left: 0.3rem;
  }
  .danger {
    display: flex;
    gap: 0.5rem;
    margin: 0.14rem 0.29rem 0.29rem;
    padding: 0.5rem 0.57rem;
    border: 1px solid var(--danger);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--danger-dim);
    color: var(--danger);
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .danger p {
    margin: 0.14rem 0 0;
    color: var(--text);
  }
  .danger-line {
    color: var(--danger);
  }
  :global(.picker-trigger) .danger-dot {
    width: 0.46rem;
    height: 0.46rem;
    border-radius: 50%;
    background: var(--danger);
    margin-left: 0.28rem;
  }
  :global(.picker-trigger) .danger-dot.off {
    background: none;
    border: 1.5px solid var(--danger);
    box-sizing: border-box;
  }
  .line.foot {
    margin-top: 0.14rem;
    border-top: 1px solid var(--panel-border);
    padding-top: 0.5rem;
  }
</style>

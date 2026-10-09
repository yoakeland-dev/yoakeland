<script module lang="ts">
  import type { ModelInfo, ProviderInfo } from "../types";
  import type { ServerState } from "../state.svelte";

  /** The effort levels a model takes (SPEC.md §3.1 set_model_options), or null
   * when it has no effort control. What the model list advertises wins; the
   * fallbacks cover providers whose model lists don't say. */
  const RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const rank = (l: string) => (RANK.includes(l) ? RANK.indexOf(l) : RANK.length);

  export function effortLevels(provider: ProviderInfo | undefined, model: ModelInfo | undefined, modelId?: string): string[] | null {
    if (!provider) return null;
    const caps = model?.capabilities;
    // Some providers (OpenRouter) list them high to low; the slider always runs low to high.
    const sorted = (l: string[]) => [...l].sort((a, b) => rank(a) - rank(b));
    if (caps?.reasoningEfforts?.length) return sorted(caps.reasoningEfforts);
    if (caps?.reasoning?.supported_efforts?.length) return sorted(caps.reasoning.supported_efforts);
    const id = modelId ?? model?.id ?? "";
    if (provider.kind === "api_key") {
      if (provider.httpProvider === "anthropic") return ["low", "medium", "high", "xhigh", "max"];
      if (provider.httpProvider === "openai" && /^(o\d|gpt-5)/.test(id)) return ["minimal", "low", "medium", "high"];
      return null;
    }
    if (provider.kind === "cli_claude") return ["low", "medium", "high", "xhigh", "max"];
    if (provider.kind === "cli_codex") return ["low", "medium", "high"];
    return null;
  }

  /** What a chat's picker resolves to: its provider and model, the model's effort levels
   * (null when it has none) and the level the chat has set, if any. */
  export function sessionEffort(server: ServerState | null | undefined, sessionId: string) {
    const provider = server?.providers.find((p) => p.name === server?.providerBySession[sessionId]);
    const modelId = server?.modelBySession[sessionId];
    const model = provider ? server?.modelsByProvider[provider.name]?.find((m) => m.id === modelId) : undefined;
    return {
      model,
      levels: effortLevels(provider, model, modelId),
      current: server?.modelOptionsBySession[sessionId]?.reasoningEffort as string | undefined,
    };
  }

  /** One or two letters, for under a stop: L, M, H, E(xtra), X for max, U(ltracode). */
  const SHORT: Record<string, string> = { none: "–", minimal: "Mi", low: "L", medium: "M", high: "H", xhigh: "E", max: "X", ultracode: "U" };
  export const effortShort = (level: string) => SHORT[level] ?? level.charAt(0).toUpperCase();

  export const effortLabel = (level: string) => (level === "xhigh" ? "Extra" : level.charAt(0).toUpperCase() + level.slice(1));
</script>

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { app } from "../state.svelte";
  import { setModelOptions } from "../ipc";
  import Icon from "./Icon.svelte";
  import SlideText from "./SlideText.svelte";
  import Slider from "./ui/Slider.svelte";
  import Switch from "./ui/Switch.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);
  let open = $state(false);

  const info = $derived(sessionEffort(server, sessionId));
  const model = $derived(info.model);
  const levels = $derived(info.levels);
  const current = $derived(info.current);

  // The model's own default, marked on the slider rather than offered as an option. It
  // stands in for "no override": at rest the slider sits on it, and picking it resets
  // rather than pinning the level. Most lists don't say what it is, so medium then.
  const defaultLevel = $derived.by(() => {
    const d = model?.capabilities?.reasoning?.default_effort;
    if (d && levels?.includes(d)) return d;
    return levels?.includes("medium") ? "medium" : levels?.[Math.floor((levels.length - 1) / 2)];
  });
  const restLevel = $derived(current ?? defaultLevel);
  const defaultIndex = $derived(levels && defaultLevel ? levels.indexOf(defaultLevel) : 0);
  const restIndex = $derived(levels && restLevel ? levels.indexOf(restLevel) : 0);

  const index = $derived(restIndex);
  const shown = $derived(levels?.[index]);
  const stops = $derived((levels ?? []).map((l) => ({ key: l, short: effortShort(l), name: effortLabel(l), warm: l === "ultracode" })));
  // Max and beyond: the slider's lamp fill.
  const lamp = $derived(restLevel === "max" || restLevel === "ultracode");
  const fastSupported = $derived(!!model?.capabilities?.fastMode);
  const fast = $derived(!!server?.modelOptionsBySession[sessionId]?.fastMode);
  function toggleFast() {
    if (!cid || !server) return;
    const opts = { ...(server.modelOptionsBySession[sessionId] ?? {}), fastMode: !fast };
    server.modelOptionsBySession = { ...server.modelOptionsBySession, [sessionId]: opts };
    setModelOptions(cid, sessionId, { fastMode: !fast });
  }

  // Which way the trigger label rolls: up when the level rose, down when it fell. Worked out
  // before the DOM updates, since the transition reads it as the new text arrives.
  let restDir = $state(1);
  let lastRest = -1;
  $effect.pre(() => {
    restDir = restIndex >= lastRest ? 1 : -1;
    lastRest = restIndex;
  });

  // Optimistic; model_options_set confirms once the round trip lands.
  function commit(i: number) {
    const level = levels?.[i];
    if (!cid || !server || !level || level === restLevel) return;
    const isDefault = level === defaultLevel;
    const opts = { ...(server.modelOptionsBySession[sessionId] ?? {}) };
    if (isDefault) delete opts.reasoningEffort;
    else opts.reasoningEffort = level;
    server.modelOptionsBySession = { ...server.modelOptionsBySession, [sessionId]: opts };
    setModelOptions(cid, sessionId, { reasoningEffort: isDefault ? "default" : level });
  }
</script>

{#if levels}
  <Popover.Root bind:open>
    <Popover.Trigger
      class={`picker-trigger${open ? " open" : ""}${restLevel === "ultracode" ? " ultra" : ""}`}
      {@attach tip("How hard the model thinks: more effort is slower and costs more")}
    >
      <span class="trigger-icon">
        <span class="crossfade a"><Icon name={fastSupported && fast ? "bolt" : "brain"} size={13} /></span>
        <span class="crossfade b"><Icon name="chevron-down" size={13} /></span>
      </span>
      <span class="trigger-label"><SlideText text={restLevel ? effortLabel(restLevel) : ""} dir={restDir} /></span>
    </Popover.Trigger>

    <Popover.Portal>
      <Popover.Content class="effort-panel" side="bottom" align="start" sideOffset={8} collisionPadding={8}>
        <div class="panel-head">
          <span class="panel-heading">Effort</span>
          <button
            type="button"
            class="recommended"
            disabled={restLevel === defaultLevel}
            onclick={() => commit(defaultIndex)}
            aria-label="Back to recommended"
            {@attach tip("Back to recommended")}
          >
            <Icon name="arrow-back-up" size={14} />
          </button>
        </div>
        <Slider {stops} value={index} {defaultIndex} hot={lamp} tone="neutral" label="Effort" oninput={commit} />
        {#if fastSupported}
          <label class="line">
            <span>Fast <em>quicker output, costs more</em></span>
            <Switch checked={fast} onchange={toggleFast} />
          </label>
        {/if}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.effort-panel) {
    width: 15rem;
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
  :global(.effort-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.43rem 0.57rem 0.29rem;
  }
  .panel-heading {
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .recommended {
    display: grid;
    place-items: center;
    padding: 0.2rem;
    color: var(--text);
    border-radius: var(--radius-pill);
    background: none;
    border: none;
    transition:
      opacity 0.15s ease,
      background 0.15s ease;
  }
  .recommended:hover:not(:disabled) {
    background: var(--sidebar-hover);
  }
  .recommended:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* Ultracode is a workflow, not a deeper level of thinking: it gets the lamp colour. */
  :global(.picker-trigger.ultra),
  :global(.picker-trigger.ultra:hover),
  :global(.picker-trigger.ultra.open) {
    color: rgb(var(--quiet-light, 255 196 140));
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.29rem 0.57rem 0.36rem;
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
</style>

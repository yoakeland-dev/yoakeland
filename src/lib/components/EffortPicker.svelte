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

  export const effortLabel = (level: string) => (level === "xhigh" ? "Extra" : level.charAt(0).toUpperCase() + level.slice(1));
</script>

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import { setModelOptions } from "../ipc";
  import Icon from "./Icon.svelte";
  import SlideText from "./SlideText.svelte";

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
  // The ball drifts a fraction of the way toward the pointer but stays tied to the
  // selected stop while dragging, and settles back on release.
  const PULL = 0.3;
  let track = $state<HTMLElement>();
  let hover = $state<number | null>(null);
  const visual = $derived(hover === null || !levels ? index : index + (hover - index) * PULL);
  // The ball eases toward that target a frame at a time; a CSS transition would restart on
  // every pointer move and judder.
  let pos = $state(0);
  let raf = 0;
  $effect(() => {
    const target = visual;
    cancelAnimationFrame(raf);
    const step = () => {
      const d = target - pos;
      pos = Math.abs(d) < 0.002 ? target : pos + d * 0.3;
      if (pos !== target) raf = requestAnimationFrame(step);
    };
    untrack(step);
    return () => cancelAnimationFrame(raf);
  });
  let dragging = false;
  const stop = () => {
    dragging = false;
    hover = null;
  };
  function follow(e: PointerEvent) {
    if (!dragging || !track || !levels) return;
    const r = track.getBoundingClientRect();
    const edge = 3 + 0.475 * 16;
    const f = ((e.clientX - r.left - edge) / (r.width - 2 * edge)) * (levels.length - 1);
    hover = Math.min(levels.length - 1, Math.max(0, f));
  }
  const isMax = $derived(!!levels && levels.length > 1 && index === levels.length - 1);

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

<svelte:window onpointerup={stop} onpointercancel={stop} />

{#if levels}
  <Popover.Root bind:open>
    <Popover.Trigger
      class={`picker-trigger${open ? " open" : ""}`}
      {@attach tip("How hard the model thinks: more effort is slower and costs more")}
    >
      <span class="trigger-icon">
        <span class="crossfade a"><Icon name="brain" size={13} /></span>
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
        <div class="slider" class:max={isMax} style:--n={levels.length - 1} style:--i={pos}>
          <!-- svelte-ignore a11y_no_static_element_interactions (the range input inside is the control) -->
          <div class="track" bind:this={track} onpointerdown={(e) => { dragging = true; follow(e); }} onpointermove={follow}>
            {#each levels as level, i (level)}
              <span class="tick" class:is-default={level === defaultLevel} style:--j={i}></span>
            {/each}
            <div class="fill"><span class="ball"></span></div>
            <input
              type="range"
              min="0"
              max={levels.length - 1}
              step="1"
              value={index}
              aria-label="Effort"
              aria-valuetext={shown ? effortLabel(shown) : undefined}
              oninput={(e) => commit(+e.currentTarget.value)}
            />
          </div>
        </div>
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
  /* One pill fill that ends in the ball, over a native range for keyboard and
     screen readers. Every position below is the ball's centre at step --i of
     --n, which travels from one ball-plus-inset in from each end. */
  .slider {
    --lamp: var(--quiet-light, 255 196 140);
    --inset: 3px;
    --ball: 0.95rem;
    --edge: calc(var(--inset) + var(--ball) / 2);
    --at: calc(var(--edge) + (100% - 2 * var(--edge)) * var(--i) / var(--n));
    padding: 0.14rem 0.57rem 0.43rem;
  }
  .track {
    position: relative;
    height: calc(var(--ball) + 2 * var(--inset));
    border-radius: var(--radius-pill);
    background: var(--sidebar-active);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  /* One dot per stop, under the translucent fill so they show through it. The model's
     default stop is a short line instead. */
  .tick {
    position: absolute;
    left: calc(var(--edge) + (100% - 2 * var(--edge)) * var(--j) / var(--n));
    top: 50%;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    translate: -50% -50%;
    background: color-mix(in srgb, var(--text) 35%, transparent);
  }
  .tick.is-default {
    width: 1.5px;
    height: 42%;
    border-radius: 1px;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--at) + var(--edge));
    border-radius: inherit;
    background: color-mix(in srgb, var(--text) 18%, transparent);
  }
  /* Warm lamplight at max, the one place the picker steps off the accent. */
  .fill::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent 15%, rgb(var(--lamp) / 0.65));
    box-shadow: inset 0 0 8px rgb(var(--lamp) / 0.5);
    opacity: 0;
    transition: opacity calc(0.6s * var(--anim-speed, 1)) ease;
  }
  .slider.max .fill::before {
    opacity: 1;
  }
  /* Lit from above: a gradient body inside a gradient rim, bright on top and
     shaded underneath, like the float surfaces' own border. */
  .ball {
    position: absolute;
    top: var(--inset);
    right: var(--inset);
    width: var(--ball);
    height: var(--ball);
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #dfe1e8);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .slider:has(input:focus-visible) .ball {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  input[type="range"] {
    position: absolute;
    inset: 0 var(--inset);
    width: calc(100% - 2 * var(--inset));
    height: 100%;
    margin: 0;
    appearance: none;
    background: none;
    cursor: pointer;
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: var(--ball);
    height: var(--ball);
    opacity: 0;
  }
</style>

<script lang="ts">
  // The phone's top bar: back, what you're looking at, and the two tool toggles. Native apps keep
  // this one row of chrome per screen; the desktop's floating islands don't survive a thumb.
  import { app, CHAT_PROJECT } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import { viewport } from "../viewport.svelte";

  let { title, sessionId, onBack }: { title: string; sessionId?: string | null; onBack: () => void } = $props();

  // Small dim line under the title: whatever a page put in viewport.sub, else the chat's project.
  const project = $derived.by(() => {
    const p = sessionId ? server?.projectBySession[sessionId] : null;
    return p && p !== CHAT_PROJECT ? server!.projectName(p) : null;
  });
  const sub = $derived(viewport.sub ?? project);

  // The hairline only appears once something has scrolled under the bar. Scroll doesn't bubble, so listen
  // in the capture phase on the screen the bar lives in.
  let bar = $state<HTMLElement>();
  let scrolled = $state(false);
  $effect(() => {
    title;
    scrolled = false;
  });
  $effect(() => {
    const screen = bar?.parentElement;
    if (!screen) return;
    const on = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLElement && t.scrollHeight > t.clientHeight) scrolled = t.scrollTop > 4;
    };
    screen.addEventListener("scroll", on, { capture: true, passive: true });
    return () => screen.removeEventListener("scroll", on, true);
  });

  const server = $derived(app.active);
  // The same lamp the fleet list uses, so the state you left Home with is the state you see here.
  const status = $derived(sessionId ? server?.sessionStatus(sessionId) : undefined);
  const toolsOpen = $derived(!!sessionId && !!server?.chatSidebarOpenBySession[sessionId]);
  const termOpen = $derived(!!sessionId && !!server?.terminalOpenBySession[sessionId]);
</script>

<header class="bar mobile-bar" class:scrolled bind:this={bar}>
  <button class="btn" aria-label="Back" onclick={onBack}><Icon name="chevron-left" size={20} /></button>
  <div class="title">
    {#if status && status !== "idle"}<span class="lamp {status}" role="img" aria-label={status}></span>{/if}
    <div class="tt"><b class="text">{title}</b>{#if sub}<small>{sub}</small>{/if}</div>
  </div>
  {#if sessionId}
    <button class="btn" class:on={termOpen} aria-label={termOpen ? "Hide terminal" : "Show terminal"} aria-pressed={termOpen} onclick={() => server?.toggleTerminal(sessionId)}>
      <Icon name="terminal-2" size={18} />
    </button>
    <button class="btn" class:on={toolsOpen} aria-label={toolsOpen ? "Hide tools" : "Show tools"} aria-pressed={toolsOpen} onclick={() => server?.toggleChatSidebar(sessionId)}>
      <Icon name="layout-sidebar-right" size={18} />
    </button>
  {/if}
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    height: 3.25rem;
    padding: 0 0.35rem;
    background: var(--panel-bg);
    border-bottom: 1px solid transparent;
    transition: border-color calc(0.16s * var(--anim-speed, 1)) ease;
    position: relative;
    z-index: 14;
  }
  .bar.scrolled {
    border-bottom-color: var(--panel-border);
  }
  .tt {
    min-width: 0;
  }
  .tt small {
    display: block;
    font-size: 0.79rem;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .btn {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-pill);
    color: var(--text-dim);
    transition:
      background-color 0.1s ease,
      transform 0.1s var(--ui-ease);
  }
  .btn:active {
    transform: scale(0.94);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .btn.on {
    color: var(--accent-ink);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.25rem;
  }
  .text {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
    font-size: var(--text-body-size);
  }
  .lamp {
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--text-dim);
  }
  .lamp.action {
    background: var(--lamp);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--lamp) 28%, transparent);
  }
  .lamp.working {
    width: 0.85rem;
    height: 0.85rem;
    background: none;
    border: 2px solid color-mix(in srgb, var(--accent) 18%, transparent);
    border-top-color: var(--accent);
    animation: spin calc(1.1s * var(--anim-speed, 1)) linear infinite;
  }
  .lamp.finished {
    background: var(--success);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lamp.working {
      animation: none;
    }
  }
</style>

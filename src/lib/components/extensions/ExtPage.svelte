<script lang="ts">
  // The shared frame of an extension's page, after the VS Code marketplace: a centered column with the
  // identity up top, tabbed content on the left and a "Details" rail on the right (under it when narrow).
  import type { Snippet } from "svelte";
  import Markdown from "../Markdown.svelte";
  import ExtIcon from "./ExtIcon.svelte";

  type Tab = { id: string; label: string; count?: number };
  let {
    name,
    kind,
    hint,
    title,
    subtitle,
    mono = false,
    tabs,
    tab = $bindable(),
    toggle,
    badges,
    actions,
    alerts,
    body,
    rail,
  }: {
    name: string;
    kind: "mcp" | "skill";
    hint?: string;
    title: string;
    subtitle?: string;
    mono?: boolean;
    tabs: Tab[];
    tab: string;
    toggle?: Snippet;
    badges?: Snippet;
    actions?: Snippet;
    alerts?: Snippet;
    body: Snippet<[string]>;
    rail: Snippet;
  } = $props();

  // A skill's description can run to paragraphs: show a few lines, the rest on request.
  let expanded = $state(false);
  let overflows = $state(false);
  function measure(el: HTMLElement) {
    const ro = new ResizeObserver(() => {
      if (!expanded) overflows = el.scrollHeight > el.clientHeight + 1;
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }
</script>

<article class="page">
  <header class="hero">
    <ExtIcon {name} {kind} {hint} size={72} />
    <div class="id">
      <div class="line">
        <h2>{title}</h2>
        {@render toggle?.()}
      </div>
      {#if subtitle && mono}
        <p class="sub mono selectable">{subtitle}</p>
      {:else if subtitle}
        <div class="sub md selectable" class:clamped={!expanded} {@attach measure}><Markdown text={subtitle} /></div>
        {#if overflows || expanded}
          <button type="button" class="more" onclick={() => (expanded = !expanded)}>{expanded ? "Show less" : "Show more"}</button>
        {/if}
      {/if}
      {#if badges}<p class="chips">{@render badges()}</p>{/if}
      {#if actions}<div class="acts">{@render actions()}</div>{/if}
    </div>
  </header>

  <div class="cols">
    <div class="main">
      {@render alerts?.()}
      {#if tabs.length > 1}
        <div class="tabs" role="tablist">
          {#each tabs as t (t.id)}
            <button type="button" role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>
              {t.label}{#if t.count !== undefined} <span class="n">{t.count}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      {@render body(tab)}
    </div>
    <aside class="rail" aria-label="Details">
      <h3>Details</h3>
      {@render rail()}
    </aside>
  </div>
</article>

<style>
  .page {
    box-sizing: border-box;
    width: 100%;
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.6rem 0 3rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    container-type: inline-size;
  }
  .hero {
    display: flex;
    gap: 1.4rem;
    align-items: flex-start;
    padding-bottom: 1.6rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .id {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .sub {
    margin: 0;
    max-width: 42rem;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .sub.md {
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .sub.md :global(p) {
    margin: 0 0 0.5em;
  }
  .sub.md :global(p:last-child) {
    margin-bottom: 0;
  }
  .sub.clamped {
    max-height: 3lh;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 60%, transparent);
  }
  .more {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .more:hover {
    text-decoration: underline;
  }
  .sub.mono {
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .chips {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 3rem;
    align-items: start;
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  .tabs {
    display: flex;
    gap: 0.14rem;
  }
  .tabs button {
    padding: 0.3rem 0.64rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .tabs button.active {
    color: var(--text);
    background: var(--sidebar-active);
  }
  .n {
    margin-left: 0.2rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }
  .rail h3 {
    margin: 0 0 1rem;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }
  .rail :global(dl) {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .rail :global(dt) {
    margin-bottom: 0.25rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .rail :global(dd) {
    margin: 0;
    font-size: var(--text-body-size);
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .rail :global(dd.mono) {
    font-family: var(--font-mono, monospace);
    font-size: 0.76rem;
    white-space: pre-line;
  }
  .rail :global(dd.chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  @container (max-width: 46rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 2rem;
    }
    .rail {
      order: -1;
    }
  }
  @container (max-width: 30rem) {
    .hero {
      flex-direction: column;
    }
  }
</style>

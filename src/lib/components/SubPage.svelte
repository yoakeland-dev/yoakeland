<script lang="ts">
  // Phone settings: a section that opens as its own page. The children stay where they are written in
  // SettingsPanel (same markup, same state); on a phone this renders a row in their place and moves the
  // page itself into the settings page stack. Elsewhere it renders the children as they always were.
  import type { Snippet } from "svelte";
  import { viewport } from "../viewport.svelte";
  import { hairline, useNav } from "../settingsNav.svelte";
  import Icon from "./Icon.svelte";

  let {
    id,
    title,
    link,
    lazy = false,
    inCard = false,
    wrap,
    end,
    children,
  }: {
    id: string;
    title: string;
    /** The row on the parent page: its value, and extra words search can match. `false`: no row, open it from code. */
    link?: { value?: string; hint?: string } | false;
    /** Only build the children while the page is open (an editor that should start fresh). */
    lazy?: boolean;
    /** The row sits inside a card the caller already draws (otherwise it gets its own). */
    inCard?: boolean;
    /** How the children sit on the page when they are bare rows (a card around them). */
    wrap?: Snippet<[Snippet]>;
    /** Right side of the page's bar. */
    end?: Snippet;
    children: Snippet;
  } = $props();

  const nav = useNav();
  // Lives under .settings-tabs so it can cover the pages without being inside the one that shifts.
  function portal(node: HTMLElement) {
    node.closest(".settings-tabs")?.querySelector(":scope > .sub-stage")?.append(node);
    return () => node.remove();
  }
  $effect(() => {
    if (nav) nav.titles[id] = title;
  });
  const crumb = $derived(nav ? nav.crumb(id) : "");
  const open = $derived(!lazy || !!nav?.has(id));
</script>

{#if !viewport.narrow || !nav}
  {@render children()}
{:else}
  {#snippet row(l: { value?: string; hint?: string })}
    <button type="button" class="sub-link setting-row" onclick={() => nav.push(id)}>
      <span class="sl-text">
        <span class="sl-title">{title}</span>
        {#if l.hint}<span class="sl-hint">{l.hint}</span>{/if}
      </span>
      {#if l.value}<span class="sl-value">{l.value}</span>{/if}
      <Icon name="chevron-right" size={16} />
    </button>
  {/snippet}
  {#if link !== false}
    {@const l = link ?? {}}
    {#if inCard}{@render row(l)}{:else}<div class="sub-card">{@render row(l)}</div>{/if}
  {/if}
  <div class="sub-page" data-sub={id} {@attach portal} {@attach hairline}>
    <header class="sp-bar">
      <button type="button" class="sp-back" aria-label="Back" onclick={() => nav.pop()}><Icon name="chevron-left" size={18} /></button>
      <div class="sp-titles">
        <small>{crumb}</small>
        <h2>{title}</h2>
      </div>
      {@render end?.()}
    </header>
    <div class="sp-scroll">
      <div class="sub-body">
        {#if open}{#if wrap}{@render wrap(children)}{:else}{@render children()}{/if}{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* The row that opens the page: the same inset, hairlined row as the card it sits in. */
  .sub-card {
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    overflow: clip;
  }
  .sub-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 52px;
    padding: 0.6rem 1rem;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sub-link:active {
    background: var(--wash-3);
  }
  .sl-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sl-hint {
    font-size: max(12px, 0.8rem);
    color: var(--text-dim);
  }
  .sl-value {
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .sub-link :global(.icon) {
    flex: none;
    opacity: 0.55;
  }
  .sub-link:global(.search-dim) {
    opacity: 0.35;
  }

  /* The page: absolutely placed over the others, moved by settingsNav. */
  .sub-page {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    background: var(--panel-bg);
    will-change: transform;
    box-shadow: -12px 0 28px -16px rgb(0 0 0 / 0.5);
  }
  .sp-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 3.5rem;
    padding: 0 0.35rem;
    border-bottom: 1px solid transparent;
    transition: border-color calc(0.16s * var(--anim-speed, 1)) ease;
  }
  .sub-page:global(.scrolled) .sp-bar {
    border-bottom-color: var(--panel-border);
  }
  .sp-back {
    display: grid;
    place-items: center;
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 50%;
    color: var(--text);
  }
  .sp-back:active {
    background: var(--wash-3);
  }
  .sp-titles {
    flex: 1;
    min-width: 0;
  }
  .sp-titles small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: max(11px, 0.72rem);
    line-height: 1.2;
    color: var(--text-dim);
  }
  .sp-titles h2 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1.25;
  }
  .sp-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.4rem 0.8rem calc(var(--safe-bottom, 0px) + 1.4rem);
    touch-action: pan-y;
  }
  .sub-body {
    --ctrl-h: 3rem;
    --text-body-size: 1rem;
    --text-label-size: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  .sub-body :global(.dropdown-trigger) {
    min-width: 0;
  }
  /* The bar already names the page. */
  .sub-body > :global(.settings-section:first-child > .section-heading:first-child) {
    display: none;
  }
</style>

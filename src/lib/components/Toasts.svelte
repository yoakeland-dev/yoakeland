<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Live notifications pop up for a few seconds (see AppState.toast for which ones); the bell
  // in the status bar keeps them. Grouped per chat like iOS: a collapsed stack of cards that
  // unfolds on click, with a floating title + minimize button (above on phones, below on desktop).
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { app } from "../state.svelte";
  import { viewport } from "../viewport.svelte";
  import { openNotificationTarget } from "../ipc";
  import { swipe } from "../gestures";
  import Icon from "./Icon.svelte";

  const ICONS = { info: "bell", success: "circle-check", warning: "warning", error: "alert-circle" } as const;

  type Toast = (typeof app.toasts)[number];
  // Chat toasts share a stack; local ones (no chat) stand alone.
  const groups = $derived.by(() => {
    const by = new Map<string, { key: string; connectionId: Toast["connectionId"]; sessionId?: string; items: Toast[] }>();
    for (const t of app.toasts) {
      const key = t.sessionId ? `${t.connectionId}|${t.sessionId}` : t.id;
      const g = by.get(key) ?? by.set(key, { key, connectionId: t.connectionId, sessionId: t.sessionId, items: [] }).get(key)!;
      g.items.unshift(t); // newest first
    }
    return [...by.values()];
  });
  let expanded = $state(new Set<string>());
  let hovered = $state(new Set<string>());
  const anyOpen = $derived(groups.some((g) => g.items.length > 1 && expanded.has(g.key)));
  // An open or hovered stack doesn't time out; a vanished one forgets its state.
  $effect(() => {
    for (const g of groups) app.holdToast(g.key, hovered.has(g.key) || (g.items.length > 1 && expanded.has(g.key)));
    if ([...expanded].some((k) => !groups.some((g) => g.key === k))) expanded = new Set([...expanded].filter((k) => groups.some((g) => g.key === k)));
  });
  function mark(set: Set<string>, key: string, on: boolean) {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  }
  function toggle(key: string, on: boolean) {
    expanded = mark(expanded, key, on);
  }
  function title(g: (typeof groups)[number]): string {
    return (g.sessionId && app.servers[g.connectionId]?.sessionById.get(g.sessionId)?.title) || "Untitled chat";
  }
  /** Phones: drag an open stack up to fold it. */
  function foldSwipe(key: string) {
    return (node: HTMLElement) => {
      const move = (dy: number, animate = false) => {
        node.style.transition = animate ? "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
        node.style.transform = dy ? `translateY(${dy}px)` : "";
      };
      return swipe(() => ({
        axis: "y",
        start: () => viewport.narrow && expanded.has(key),
        accept: (d) => d < 0,
        onMove: (d) => move(Math.min(0, d)),
        onEnd: (d, v) => {
          if (d < -50 || v < -0.4) toggle(key, false);
          move(0, true);
        },
        onCancel: () => move(0, true),
      }))(node);
    };
  }
  const dy = $derived(viewport.narrow ? -16 : 12);
  // A folded stack is the real cards overlapped: each older card is pulled up behind the one in
  // front with a negative margin (its own height minus a small peek), so folding, unfolding and new
  // arrivals are all plain CSS transitions on margin/scale and nothing is measured per frame.
  const PEEK = 12;
  const GAP = 6;
  let heights = $state<Record<string, number>>({});
  /** Records the card's height, then (a frame later, so the first layout doesn't animate) turns transitions on. */
  function measure(id: string) {
    return (node: HTMLElement) => {
      heights[id] = node.offsetHeight;
      const raf = requestAnimationFrame(() => node.classList.add("anim"));
      return () => cancelAnimationFrame(raf);
    };
  }
  function margin(i: number, stacked: boolean, id: string): number {
    if (i === 0) return 0;
    if (!stacked) return GAP;
    const h = heights[id] ?? 0;
    return i < 3 ? PEEK - h : -h;
  }
  function enter(_node: Element) {
    return { duration: 220, easing: cubicOut, css: (t: number, u: number) => `opacity:${t};transform:scale(${1 - u * 0.06})` };
  }
  /** Closes up / opens out (height and margins together) so neighbours slide over instead of snapping. */
  function collapse(node: HTMLElement) {
    const { marginTop, marginBottom } = getComputedStyle(node);
    const h = node.offsetHeight;
    const mt = parseFloat(marginTop);
    const mb = parseFloat(marginBottom);
    return {
      duration: 220,
      easing: cubicOut,
      css: (t: number) => `overflow:hidden;height:${t * h}px;margin-top:${t * mt}px;margin-bottom:${t * mb}px;opacity:${t}`,
    };
  }
</script>

{#snippet card(t: Toast)}
  <div class="toast level-{t.level}">
    <button
      type="button"
      class="body"
      onclick={() => {
        openNotificationTarget(t.connectionId, t);
        app.dropToast(t.id);
      }}
    >
      <Icon name={ICONS[t.level] ?? "bell"} size={14} />
      <span class="text">
        <span class="title">{t.title}</span>
        {#if t.body}<span class="detail">{t.body}</span>{/if}
      </span>
    </button>
    {#if t.action}
      <button
        type="button"
        class="action"
        onclick={() => {
          t.action?.run();
          app.dropToast(t.id);
        }}>{t.action.label}</button
      >
    {/if}
    {#if t.deny}
      <button
        type="button"
        class="action"
        onclick={() => {
          t.deny?.run();
          app.dropToast(t.id);
        }}>{t.deny.label}</button
      >
    {/if}
    <button type="button" class="x" {@attach tip("Close")} aria-label="Close" onclick={() => app.dropToast(t.id)}>
      <Icon name="xmark" size={12} />
    </button>
  </div>
{/snippet}

{#if anyOpen}
  <!-- Phones dim the page behind an open stack; on desktop it's just a click-away catcher. -->
  <button
    type="button"
    class="scrim"
    aria-label="Collapse notifications"
    transition:fade={{ duration: 160 }}
    onclick={() => (expanded = new Set())}
  ></button>
{/if}

<div class="toasts" aria-live="polite">
  {#each groups as g (g.key)}
    {@const open = g.items.length > 1 && expanded.has(g.key)}
    {@const stacked = g.items.length > 1 && !open}
    <div
      class="group"
      data-open={open}
      {@attach foldSwipe(g.key)}
      animate:flip={{ duration: 220 }}
      transition:fly={{ y: dy, duration: 180 }}
      onpointerenter={(e) => e.pointerType === "mouse" && (hovered = mark(hovered, g.key, true))}
      onpointerleave={() => (hovered = mark(hovered, g.key, false))}
    >
      {#if open}
        <div class="head" transition:collapse>
          <span class="group-title">{title(g)}</span>
          <button type="button" class="fold" {@attach tip("Collapse")} aria-label="Collapse" onclick={() => toggle(g.key, false)}>
            <Icon name="chevron-down" size={14} />
          </button>
        </div>
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="cards" class:stack={stacked} onclick={() => stacked && toggle(g.key, true)}>
        {#each g.items as t, i (t.id)}
          <div
            class="slot"
            data-stacked={stacked}
            data-back={stacked && i > 0}
            data-hidden={stacked && i > 2}
            style:--m="{margin(i, stacked, t.id)}px"
            style:--i={Math.min(i, 2)}
            style:z-index={g.items.length - i}
            {@attach measure(t.id)}
            in:enter
            out:collapse
          >
            {@render card(t)}
          </div>
        {/each}
        {#if stacked}<span class="badge" transition:fade={{ duration: 160 }}>{g.items.length}</span>{/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 2.6rem; /* above the status bar */
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
    z-index: var(--z-popover);
    pointer-events: none;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-popover);
    background: transparent;
    border: none;
    padding: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    transition: margin 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  /* An open stack pulls away from its neighbours so you can see where it ends. */
  .group[data-open="true"] {
    margin-block: 0.71rem;
    touch-action: none;
  }
  .cards {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .slot {
    position: relative;
    margin-top: var(--m, 0);
    transform-origin: top center;
  }
  .slot:global(.anim) {
    transition:
      margin 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 0.3s ease;
  }
  .slot[data-stacked="true"] {
    transform: scale(calc(1 - var(--i, 0) * 0.05));
  }
  .slot[data-hidden="true"] {
    opacity: 0;
  }
  /* Behind the front card only their edge shows, never their text. */
  .slot :global(.toast) > :global(*) {
    transition: opacity 0.25s ease;
  }
  .slot[data-back="true"] :global(.toast) > :global(*) {
    opacity: 0;
  }
  /* A folded stack is one tap target: the cards' own buttons wait until it's open. */
  .stack {
    cursor: pointer;
    pointer-events: auto;
  }
  .stack :global(.toast) {
    pointer-events: none;
  }
  .badge {
    position: absolute;
    top: -0.36rem;
    left: -0.36rem;
    z-index: 20;
    min-width: 1.14rem;
    padding: 0 0.29rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: #0d1020;
    font-size: 0.64rem;
    line-height: 1.14rem;
    text-align: center;
  }
  /* Floating, no background: just the chat name and a fold button. */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.57rem;
    padding: 0 0.29rem;
    margin-bottom: 0.43rem;
    pointer-events: auto;
    color: var(--text);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
  }
  .group-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-label-size);
    font-weight: 600;
  }
  .fold {
    display: flex;
    padding: 0.29rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  .fold:hover {
    background: var(--float-hover-bg);
  }
  .toast {
    pointer-events: auto;
    width: min(22rem, 90vw);
    display: flex;
    align-items: flex-start;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    align-items: center;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.71rem;
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 0.71rem 0.5rem 0.71rem 0.86rem;
    cursor: pointer;
  }
  .level-success .body :global(.icon) {
    color: var(--success);
  }
  .level-warning .body :global(.icon) {
    color: var(--warning);
  }
  .level-error .body :global(.icon) {
    color: var(--danger);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
    min-width: 0;
  }
  .title {
    font-size: 0.82rem;
  }
  .detail {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action {
    align-self: center;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-label-size);
    font-weight: 600;
    padding: 0.29rem 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .action:hover,
  .x:hover {
    background: var(--sidebar-hover);
  }
  .x {
    display: flex;
    margin: 0 0.43rem 0 0.14rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    padding: 0.36rem;
    cursor: pointer;
  }
  .x:hover {
    color: var(--text);
  }

  /* Desktop is anchored bottom-right: the newest card stays put, older ones sit above it
     (peeking when folded) and the title goes underneath. */
  @media (min-width: 701px) {
    .head {
      order: 2;
      margin: 0.43rem 0 0;
    }
    .cards {
      flex-direction: column-reverse;
    }
    .badge {
      top: auto;
      bottom: -0.36rem;
    }
    .slot {
      margin-top: 0;
      margin-bottom: var(--m, 0);
      transform-origin: bottom center;
    }
  }

  /* Phone: drops in from the top, inset like iOS banners. */
  @media (max-width: 700px) {
    .toasts {
      left: 0;
      right: 0;
      top: calc(var(--header-height) + var(--safe-top));
      bottom: auto;
      padding: 0.43rem 0.57rem 0;
      gap: 0.43rem;
    }
    .group {
      pointer-events: none;
    }
    .toast {
      width: 100%;
    }
    .scrim {
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
    }
  }
</style>

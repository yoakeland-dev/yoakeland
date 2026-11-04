<script lang="ts">
  import { app } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import SlideText from "./SlideText.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const items = $derived(app.active?.todoBySession[sessionId]?.items ?? []);
  const done = $derived(items.filter((i) => i.status === "completed").length);
  const allDone = $derived(items.length > 0 && done === items.length);
  const current = $derived(items.find((i) => i.status === "in_progress"));

  const nowLabel = $derived(
    allDone ? "All done" : current ? current.activeForm || current.content : "Todo",
  );
  // Which way the label rolls: down the list as work advances, back up if it regresses.
  const currentIndex = $derived(allDone ? items.length : Math.max(0, items.findIndex((i) => i.status === "in_progress")));
  let dir = $state(1);
  let lastIndex = -1;
  $effect.pre(() => {
    const at = currentIndex;
    dir = at >= lastIndex ? 1 : -1;
    lastIndex = at;
  });

  // null = follow the list (open until everything is done); a click pins the choice until the list changes state.
  let pinned = $state<{ open: boolean; forDone: boolean } | null>(null);
  const open = $derived(pinned && pinned.forDone === allDone ? pinned.open : !allDone);
  function toggle() {
    pinned = { open: !open, forDone: allDone };
  }
</script>

{#if items.length > 0}
  <div class="todos">
    <button type="button" class="head" aria-expanded={open} onclick={toggle}>
      <span class="count">{done}/{items.length}</span>
      <span class="now"><SlideText text={nowLabel} {dir} /></span>
      <Icon name={open ? "chevron-down" : "chevron-up"} size={14} />
    </button>
    <div class="accordion" class:open inert={!open} aria-hidden={!open}>
      <div class="accordion-inner">
        <ul>
          {#each items as it (it.id)}
            <li class={it.status}>
              <span class="mark" aria-hidden="true">
                {#if it.status === "completed"}<Icon name="circle-check" size={14} />{:else if it.status === "in_progress"}<Icon name="loader-2" size={14} />{:else}<span class="ring"></span>{/if}
              </span>
              <span class="text">{it.status === "in_progress" && it.activeForm ? it.activeForm : it.content}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{/if}

<style>
  /* A tab on the composer's top edge, like ChatNotices. */
  .todos {
    position: relative;
    z-index: 0;
    margin: 0 22px -1px;
    background: var(--panel-bg);
    border: 1px solid var(--float-border);
    border-bottom: 0;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    font-size: var(--text-label-size);
    pointer-events: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.36rem 0.71rem;
    background: none;
    border: 0;
    color: var(--text-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .count {
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .now {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  /* Zero-JS accordion: 0fr/1fr tracks the list's real height, so collapsing to the header
     and expanding back both glide instead of snapping. */
  .accordion {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows calc(0.22s * var(--anim-speed, 1)) ease,
      opacity calc(0.18s * var(--anim-speed, 1)) ease;
  }
  .accordion.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }
  .accordion-inner {
    min-height: 0;
    overflow: hidden;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 0.71rem 0.5rem;
    max-height: 9.5rem;
    overflow-y: auto;
  }
  li {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.14rem 0;
    color: var(--text-dim);
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 14px;
    height: 1.3em;
  }
  .ring {
    width: 10px;
    height: 10px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    opacity: 0.6;
  }
  .in_progress {
    color: var(--accent-ink);
  }
  .in_progress .mark :global(svg) {
    animation: todo-spin 1.2s linear infinite;
  }
  .completed .mark {
    color: var(--success);
  }
  .completed .mark :global(svg) {
    animation: todo-check calc(0.24s * var(--anim-speed, 1)) ease-out;
  }
  .completed .text {
    text-decoration: line-through;
    opacity: 0.7;
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  @keyframes todo-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes todo-check {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .in_progress .mark :global(svg),
    .completed .mark :global(svg) {
      animation: none;
    }
    .accordion,
    .completed .text {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import { fade as fadeTransition } from "svelte/transition";
  import { isPhotoAvatar } from "../avatar";
  import { app } from "../state.svelte";
  import { basename } from "../format";
  import { startEditingMessage } from "../ipc";
  import type { ChatMessage } from "../types";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";
  import VersionCycle from "./VersionCycle.svelte";

  let { message, sessionId }: { message: ChatMessage; sessionId: string } = $props();
  const text = $derived(message.text);
  const author = $derived(message.author);
  const authorAvatar = $derived(message.authorAvatar);

  // SPEC.md §4d: editing archives everything generated after this message,
  // which may have run tool calls; the tooltip states that unconditionally
  // since the composer can't check if it actually applies.
  function edit() {
    const cid = app.activeConnectionId;
    if (!cid) return;
    startEditingMessage(cid, sessionId, message.id, message.text);
  }

  // Real height, not a character count, so it clips correctly regardless of
  // formatting (headings wrap very differently than a paragraph of the same length).
  const COLLAPSED_MAX = 180;

  let expanded = $state(false);
  // Measured on the inner content wrapper, never `.clip` itself: once capped,
  // `.clip`'s box stops changing size and a ResizeObserver on it would never fire again.
  let contentEl: HTMLDivElement | undefined = $state();
  let fullHeight = $state(0);

  $effect(() => {
    if (!contentEl) return;
    const el = contentEl;
    const ro = new ResizeObserver(() => (fullHeight = el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const overflowing = $derived(fullHeight > COLLAPSED_MAX + 4);
  const capped = $derived(overflowing && !expanded);
  // Before the first measurement this must be "none", not a stale px value,
  // else the bubble clips to 0 for a frame. The +1.42rem covers .clip's own
  // padding (0.71rem top+bottom), which fullHeight (measured on contentEl) doesn't include.
  const maxHeight = $derived(
    capped ? `${COLLAPSED_MAX}px` : fullHeight ? `calc(${fullHeight}px + 1.42rem)` : "none",
  );
  const clipPadBottom = $derived(capped ? "3rem" : "0.71rem");
</script>

<div class="row">
  <div class="column">
    {#if author}
      <span class="author">{author}</span>
    {/if}
    <div class="bubble">
      <div class="clip" style="max-height: {maxHeight}; padding-bottom: {clipPadBottom}">
        <div bind:this={contentEl}>
          <Markdown {text} mentions />
          {#if overflowing && expanded}
            <button class="toggle inline" transition:fadeTransition={{ duration: 120 }} onclick={() => (expanded = false)}>
              Show less
              <span class="chevron open"><Icon name="chevron-down" size={12} /></span>
            </button>
          {/if}
        </div>
      </div>
      {#if overflowing && capped}
        <div class="fade" transition:fadeTransition={{ duration: 160 }}>
          <button class="toggle overlay" onclick={() => (expanded = true)}>
            Show all
            <span class="chevron"><Icon name="chevron-down" size={12} /></span>
          </button>
        </div>
      {/if}
    </div>
    {#if message.attachments?.length}
      <ul class="attachments">
        {#each message.attachments as path (path)}
          <li title={path}><Icon name="file" size={12} /> {basename(path)}</li>
        {/each}
      </ul>
    {/if}
    <div class="footer">
      <VersionCycle {message} {sessionId} />
      <button
        class="action"
        onclick={edit}
        title="Edit — regenerates from here; doesn't undo any file changes the discarded reply made"
      >
        <Icon name="pencil" size={12} />
        Edit
      </button>
    </div>
  </div>
  <span class="avatar">
    {#if authorAvatar && isPhotoAvatar(authorAvatar)}
      <img src={authorAvatar} alt="" />
    {:else}
      {authorAvatar || "🐣"}
    {/if}
  </span>
</div>

<style>
  .attachments {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.29rem;
    margin: 0.29rem 0 0;
    padding: 0;
  }
  .attachments li {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    padding: 0.14rem 0.5rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-pill);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    /* flex-start, not flex-end: the avatar's sticky box is bounded by this
       row's height, so it needs to start at the row's top edge (level with
       the name) to have anywhere to slide down *to* while scrolling. */
    align-items: flex-start;
    gap: 8px;
  }
  .column {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    max-width: 70%;
  }
  .author {
    font-size: 0.72rem;
    color: var(--text-dim);
    margin: 0 0.2rem 0.25rem;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0.2rem 0;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
    background: none;
    border: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
    padding: 0;
  }
  .action:hover {
    color: var(--text);
  }
  .avatar {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--sidebar-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    overflow: hidden;
    /* Telegram-style tracking avatar: pinned near the top of the scroll
       viewport while a long message scrolls past, but never past this row's
       own bounds: it scrolls away normally once the message ends. */
    position: sticky;
    top: 8px;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bubble {
    position: relative;
    background: var(--bubble-user-bg);
    border-radius: 16px;
    font-size: 0.9rem;
    /* Bottom always rounds correctly, capped or expanded: the bubble itself
       clips, so nothing (fade, text) can square off its corners. */
    overflow: hidden;
  }
  .clip {
    position: relative;
    overflow: hidden;
    padding: 0.71rem 1rem;
    transition:
      max-height calc(0.22s * var(--anim-speed, 1)) ease,
      padding-bottom calc(0.22s * var(--anim-speed, 1)) ease;
  }
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3rem;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 0.6rem;
    background: linear-gradient(to bottom, transparent, var(--bubble-user-bg) 55%);
    pointer-events: none;
  }
  .fade .toggle {
    pointer-events: auto;
  }
  .toggle {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.21rem;
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.75rem;
    padding: 0.2rem 0;
    cursor: pointer;
  }
  .toggle.inline {
    margin-top: 0.43rem;
  }
  .chevron {
    display: inline-flex;
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chevron.open {
    transform: rotate(180deg);
  }
</style>

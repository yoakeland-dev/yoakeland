<script lang="ts">
  import { fade as fadeTransition } from "svelte/transition";
  import { isPhotoAvatar } from "../avatar";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";

  let { text, author, authorAvatar }: { text: string; author?: string; authorAvatar?: string } = $props();

  // How tall the bubble is allowed to get before it clips, in px. Real height
  // (not a character count) so it clips correctly regardless of formatting —
  // a message full of short markdown headings wraps very differently than
  // one long paragraph of the same length.
  const COLLAPSED_MAX = 180;

  let expanded = $state(false);
  // Measured on the *inner* content wrapper, never on the clipped `.clip`
  // itself — once `.clip` is capped its own box stops changing size, so a
  // ResizeObserver on it would never fire again no matter how much taller
  // the (still off-screen) content grows.
  let contentEl: HTMLDivElement | undefined = $state();
  let fullHeight = $state(0);

  // ResizeObserver keeps this current as markdown reflows (window resize, UI
  // font-size setting) so an already-expanded bubble is never mis-clipped by
  // a stale measurement.
  $effect(() => {
    if (!contentEl) return;
    const el = contentEl;
    const ro = new ResizeObserver(() => (fullHeight = el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const overflowing = $derived(fullHeight > COLLAPSED_MAX + 4);
  const capped = $derived(overflowing && !expanded);
  // Before the first measurement (fullHeight still 0) this must be "none",
  // not a stale px value — otherwise the bubble clips to 0 for a frame.
  // fullHeight is measured on contentEl, which has no padding of its own —
  // but max-height applies to .clip's border-box, which does (0.71rem top +
  // 0.71rem bottom). Miss that and the box is ~1.42rem short, clipping the
  // last line (or the inline "Show less" button) off every time.
  const maxHeight = $derived(
    capped ? `${COLLAPSED_MAX}px` : fullHeight ? `calc(${fullHeight}px + 1.42rem)` : "none",
  );
  // Extra bottom padding reserved for the fade + "Show all" overlay while
  // capped, so it never sits on top of the last line of text. Animated
  // alongside max-height so the overlay slides into place as it grows.
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
          <Markdown {text} />
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
       own bounds — it scrolls away normally once the message ends. */
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

<script lang="ts">
  import { untrack } from "svelte";
  import { tip } from "../tooltip.svelte";
  import { fade as fadeTransition } from "svelte/transition";
  import { isPhotoAvatar } from "../avatar";
  import { avatarSrc } from "../avatarCache.svelte";
  import { viewport } from "../viewport.svelte";
  import { app } from "../state.svelte";
  import { startEditingMessage, withdrawPrompt } from "../ipc";
  import type { ChatMessage } from "../types";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";
  import VersionCycle from "./VersionCycle.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Attachments from "./Attachments.svelte";
  import AnswerReceipt from "./AnswerReceipt.svelte";
  import { fmtDuration } from "../usage";

  // `queued`: sent mid-turn, waiting for that turn to end (§3.1 turn_started); undoable until then.
  // `steering`: sent into the running turn (§3.1 steer_turn), waiting for the agent to take it.
  let {
    message,
    sessionId,
    queued = false,
    steering = false,
    withdrawing = false,
  }: { message: ChatMessage; sessionId: string; queued?: boolean; steering?: boolean; withdrawing?: boolean } = $props();
  // Only a message sent just now eases in; history loading in (session switch, scroll hydration) stays still.
  const enter = untrack(() => queued || steering || Date.now() - message.createdAt < 2000);
  const text = $derived(message.text);
  // Not typed by a person: say where it came from in place of the author line.
  const TRIGGERS: Record<string, string> = { now: "now", at: "timer", limit_reset: "limit reset", repeat: "repeat" };
  const origin = $derived(message.origin);
  const originLabel = $derived(
    origin?.kind === "artifact"
      ? origin.label || "You answered in the page"
      : origin?.label === "limit-continue"
        ? origin.waitedMs && origin.waitedMs >= 60_000
          ? `Continued automatically · waited ${fmtDuration(origin.waitedMs)}`
          : "Continued automatically"
        : origin?.kind === "scheduled"
        ? `Scheduled · ${TRIGGERS[origin.trigger ?? ""] ?? origin.trigger ?? "turn"}`
        : "",
  );
  // The server wraps these for the model ("[The user acted in the artifact ...]"); the bubble shows what they mean.
  const answer = $derived.by((): { data?: Record<string, unknown>; text: string } => {
    if (origin?.kind !== "artifact") return { text };
    const body = text.replace(/^\[[^\]]*\]\s*/, "");
    try {
      const v = JSON.parse(body);
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) return { data: v, text };
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { text: String(v) };
    } catch { /* not JSON: show what the page sent as it is */ }
    return { text: body || text };
  });
  // The person's profile now, falling back to what was stored with the message.
  const profile = $derived(app.active?.profileOf(message) ?? { name: message.author ?? "", avatar: message.authorAvatar });
  const author = $derived(originLabel ? undefined : profile.name || undefined);
  const authorAvatar = $derived(profile.avatar)

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
  // A receipt runs edge to edge, so its clip has no vertical padding; the target must match the box
  // exactly, or the height overshoots and settles back.
  const padY = $derived(answer.data ? "0rem" : "0.71rem");
  const maxHeight = $derived(
    capped ? `${COLLAPSED_MAX}px` : fullHeight ? `calc(${fullHeight}px + ${padY} * 2)` : "none",
  );
  // Stacked (avatar + name in a strip above the bubble) on a phone, or when the chat pane itself is
  // thin (e.g. docked to the side) -- the window-wide `viewport.narrow` alone misses that.
  let rowWidth = $state(0);
  const narrow = $derived(viewport.narrow || (rowWidth > 0 && rowWidth < 520));
</script>

{#snippet avatarBody()}
  {#if authorAvatar && isPhotoAvatar(authorAvatar)}
    <img src={avatarSrc(authorAvatar)} alt="" />
  {:else}
    {authorAvatar || "🐣"}
  {/if}
{/snippet}

<div class="row" class:enter class:queued={queued || steering} class:from-origin={!!originLabel} class:stacked={narrow} bind:clientWidth={rowWidth}>
  {#if narrow}
    <div class="strip">
      <span class="avatar">
        {@render avatarBody()}
      </span>
      {#if author}
        <span class="author">{author}</span>
      {/if}
    </div>
  {/if}
  <div class="column">
    {#if originLabel}
      <span class="origin"><Icon name={origin?.kind === "artifact" ? "app-window" : "clock"} size={12} /> {originLabel}</span>
    {/if}
    {#if !narrow && author}
      <span class="author">{author}</span>
    {/if}
    <div class="bubble">
      <div class="clip" style="max-height: {maxHeight}; padding-block: {padY}">
        <div bind:this={contentEl}>
          {#if origin?.label === "limit-continue"}
            <div class="reset">
              <span class="ring"><Icon name="refresh" size={16} /></span>
              <span class="reset-text"><b>Usage limit reset</b><span>Picking up where it left off</span></span>
            </div>
          {:else if answer.data}
            <AnswerReceipt data={answer.data} />
          {:else}
            <Markdown text={answer.text} mentions />
          {/if}
          {#if overflowing && expanded}
            <button class="toggle inline" class:flush={!!answer.data} transition:fadeTransition={{ duration: 120 }} onclick={() => (expanded = false)}>
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
      <Attachments paths={message.attachments} {sessionId} />
    {/if}
    <div class="footer">
      {#if steering}
        <span class="queued-note"><Icon name="clock" size={12} /> Sending to the agent</span>
      {:else if queued}
        <span class="queued-note"><Icon name="clock" size={12} /> Queued · sends when this turn ends</span>
        <button
          class="action"
          disabled={withdrawing}
          onclick={() => app.activeConnectionId && message.turnId && withdrawPrompt(app.activeConnectionId, sessionId, message.turnId)}
          {@attach tip("Take it back into the composer")}
        >
          <Icon name="arrow-back-up" size={12} />
          {withdrawing ? "Undoing…" : "Undo"}
        </button>
      {:else}
        <VersionCycle {message} {sessionId} />
        <span class="actions">
          <CopyButton text={message.text} label="Copy message" />
          <button
            class="action"
            onclick={edit}
            aria-label="Edit"
            {@attach tip("Edit and regenerate from here. File changes the discarded reply made stay.")}
          >
            <Icon name="pencil" size={12} />
          </button>
        </span>
      {/if}
    </div>
  </div>
  {#if !narrow}
    <span class="avatar">
      {@render avatarBody()}
    </span>
  {/if}
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
  .row.enter {
    animation: send-in calc(0.4s * var(--anim-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1);
  }
  /* Rises from the composer at the bottom of the screen. */
  @keyframes send-in {
    from {
      opacity: 0;
      transform: translateY(40vh);
    }
  }
  .row.stacked {
    flex-direction: column;
    align-items: flex-end;
    gap: 0;
  }
  .column {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    max-width: 70%;
  }
  .row.stacked .column {
    max-width: 85%;
  }
  .row.stacked .avatar {
    /* Nothing to slide along in a strip. */
    position: static;
  }
  .author {
    font-size: 0.79rem;
    color: var(--text-dim);
    margin: 0 0.2rem 0.25rem;
  }
  .origin {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
    font-size: 0.79rem;
    color: var(--text-dim);
    margin: 0 0.2rem 0.25rem;
  }
  .reset { display: flex; align-items: center; gap: 0.7rem; }
  .reset-text { display: flex; flex-direction: column; line-height: 1.25; }
  .reset-text span { font-size: 0.79rem; color: var(--text-dim); }
  /* A full meter: the limit is back to 100%. */
  .ring {
    position: relative;
    flex: none;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--success);
    background: conic-gradient(var(--success) 100%, var(--wash-3) 0);
  }
  .ring::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--bubble-user-bg); }
  .ring :global(svg) { position: relative; }
  .row.from-origin .bubble {
    opacity: 0.7;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0.2rem 0;
    font-size: 0.79rem;
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
  .action:hover:not(:disabled) {
    color: var(--text);
  }
  .action:disabled {
    cursor: default;
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .row:not(:hover, :focus-within) .actions {
    opacity: 0;
    pointer-events: none;
  }
  .queued-note {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
  }
  /* Sent, but not read yet: a dashed, dimmer bubble until turn_started. */
  .row.queued .bubble {
    opacity: 0.6;
    outline: 1px dashed var(--panel-border);
    outline-offset: -1px;
  }
  .avatar {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
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
    /* Only the height animates. A padding that changed with it altered the box's natural height under the
       max-height cap, so the bubble overshot at the end of opening and the start of closing. */
    transition: max-height calc(0.22s * var(--anim-speed, 1)) ease;
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
    color: var(--accent-ink);
    font-size: 0.79rem;
    padding: 0.2rem 0;
    cursor: pointer;
  }
  .toggle.inline {
    margin-top: 0.43rem;
  }
  /* A receipt's clip has no bottom padding, so the button carries its own (padding, not margin, which would
     collapse out of the measured content and throw the height target off). */
  .toggle.inline.flush {
    padding-bottom: 0.9rem;
  }
  .chevron {
    display: inline-flex;
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chevron.open {
    transform: rotate(180deg);
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin-bottom: 0.25rem;
  }
  .strip .author {
    margin: 0;
  }
  /* Avatar on the right, smaller so it sits level with the name. */
  .strip {
    flex-direction: row-reverse;
  }
  .strip .avatar {
    width: 18px;
    height: 18px;
    font-size: 0.79rem;
  }

  /* Phone: no hover, so the row's actions stay in view (quietly), with a finger-sized hit area
     around the 12px icons; negative margins keep the footer's layout. */
  @media (max-width: 700px) {
    .row:not(:hover, :focus-within) .actions {
      opacity: 0.8;
      pointer-events: auto;
    }
    .action {
      padding: 1rem 0.85rem;
      margin: -1rem -0.2rem;
    }
  }
</style>

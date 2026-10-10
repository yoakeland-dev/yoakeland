<script lang="ts">
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";
  import CompactionDivider from "./CompactionDivider.svelte";

  // `scrolledUp`: far enough above the tail that the composer goes compact and offers a jump back.
  let {
    sessionId,
    paddingTop,
    scrolledUp = $bindable(false),
  }: { sessionId: string; paddingTop?: string; scrolledUp?: boolean } = $props();

  let container: HTMLDivElement;
  let rows: HTMLDivElement;
  const messages = $derived(app.active?.messagesBySession[sessionId] ?? []);
  const queued = $derived(app.active?.queuedBySession[sessionId] ?? []);
  const steering = $derived(app.active?.steeringBySession[sessionId] ?? []);

  // Editing a message regenerates from it: it gets outlined and whatever follows dims, so
  // what the edit will replace is visible rather than only described.
  const editingIndex = $derived.by(() => {
    const id = app.active?.editingMessageId[sessionId];
    return id ? messages.findIndex((m) => m.id === id) : -1;
  });

  // Markdown parsing and tool-call mounting are deferred for rows far above
  // the fold (the bulk of first-open cost; `content-visibility` below only
  // skips paint, not this JS work) and hydrated once, never torn down. The
  // most recent messages are exempt: a session opens scrolled to their tail,
  // and the IntersectionObserver needs a frame to fire, which would flash a
  // placeholder for the very thing the user opened the chat to read.
  const EAGER_TAIL = 20;
  let hydrated = $state(new Set<string>());
  let observer: IntersectionObserver | undefined;

  function observeRow(node: HTMLElement, id: string) {
    node.dataset.msgId = id;
    observer?.observe(node);
    return {
      destroy() {
        observer?.unobserve(node);
      },
    };
  }

  $effect(() => {
    if (!container) return;
    observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.msgId;
          if (id && !hydrated.has(id)) {
            hydrated.add(id);
            changed = true;
          }
        }
        // The .add() calls above happen outside a reactive context, so
        // reassign to make anything reading `hydrated` actually rerun.
        if (changed) hydrated = new Set(hydrated);
      },
      { root: container, rootMargin: "1000px 0px" },
    );
    return () => observer?.disconnect();
  });

  // Stick-to-bottom, driven by intent rather than by where the content happens to be: only
  // the user moving up unsticks, only reaching the tail again resticks, and a ResizeObserver
  // follows every growth (markdown renders, tool cards, images) while stuck. Nothing ever
  // scrolls in response to a delta, so a stream can't fight a scroll in progress.
  let stuck = true;
  let lastTop = 0;
  const RESTICK_PX = 48;
  const SCROLLED_UP_PX = 160;

  function toBottom() {
    container.scrollTop = container.scrollHeight;
    lastTop = container.scrollTop;
  }

  function measure() {
    scrolledUp = !stuck && container.scrollHeight - container.scrollTop - container.clientHeight > SCROLLED_UP_PX;
  }

  /** Back to the tail and following it again. */
  export function jumpToBottom() {
    stuck = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }

  function onScroll() {
    const top = container.scrollTop;
    const dist = container.scrollHeight - top - container.clientHeight;
    // At the very bottom sticks even when the move was upward: that's the browser clamping
    // scrollTop after content above shrank, not the user.
    if (dist < 1) stuck = true;
    else if (top < lastTop) stuck = false;
    else if (dist < RESTICK_PX) stuck = true;
    lastTop = top;
    measure();
  }

  // Unsticks on the wheel event itself, before Chromium's smooth scroll has moved anything:
  // waiting for the scroll event would let one more follow land and cancel that animation.
  function onWheel(e: WheelEvent) {
    if (e.deltaY >= 0) return;
    // An inner scroller (tool output, diff) that can still move up takes this wheel, not the list.
    for (let el = e.target as HTMLElement | null; el && el !== container; el = el.parentElement) {
      if (el.scrollTop > 0) return;
    }
    stuck = false;
  }

  $effect(() => {
    const ro = new ResizeObserver(() => {
      if (stuck) toBottom();
      measure();
    });
    ro.observe(rows, { box: "border-box" });
    ro.observe(container);
    return () => ro.disconnect();
  });

  // Opening a session or sending (a new turn, or a queued follow-up) always goes to the tail.
  // A queued prompt starting on its own isn't a send: its queue entry leaves as its turn begins.
  const turnId = $derived(app.active?.activeTurnBySession[sessionId]);
  let prev = { sid: "", turn: undefined as string | undefined, queued: 0 };
  $effect(() => {
    const cur = { sid: sessionId, turn: turnId, queued: queued.length };
    const sent = cur.queued > prev.queued || (!!cur.turn && cur.turn !== prev.turn && cur.queued >= prev.queued);
    if (cur.sid !== prev.sid || sent) {
      stuck = true;
      toBottom();
    }
    prev = cur;
  });

  // Starting an edit brings the message into view, since its composer is at the bottom.
  $effect(() => {
    if (editingIndex < 0) return;
    stuck = false;
    untrack(() => container.querySelector(`[data-msg-id="${CSS.escape(messages[editingIndex].id)}"]`))?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
</script>

<div class="list" bind:this={container} onscroll={onScroll} onwheel={onWheel}>
  <div class="rows" bind:this={rows} style:padding-top={paddingTop}>
    {#each messages as message, i (message.id)}
      {@const eager = i >= messages.length - EAGER_TAIL}
      <div
        class="msg-row"
        class:editing={i === editingIndex}
        class:replaced={editingIndex >= 0 && i > editingIndex}
        class:replaces={i === editingIndex && i < messages.length - 1}
        use:observeRow={message.id}
      >
        {#if message.streaming || eager || hydrated.has(message.id)}
          {#if message.role === "user"}
            <MessageBubble {message} {sessionId} />
          {:else if message.role === "compaction"}
            <CompactionDivider {message} />
          {:else}
            <AssistantMessage {message} {sessionId} />
          {/if}
        {:else}
          <div class="msg-placeholder"></div>
        {/if}
      </div>
    {/each}
    {#each steering as text, i (i + text)}
      <div class="msg-row">
        <MessageBubble
          {sessionId}
          steering
          message={{ id: `steering-${i}`, role: "user", text, toolCalls: [], streaming: false, createdAt: 0, author: app.settings.profileName || undefined, authorAvatar: app.settings.profileAvatar || undefined }}
        />
      </div>
    {/each}
    {#each queued as q (q.turnId)}
      <div class="msg-row">
        <MessageBubble
          {sessionId}
          queued
          withdrawing={q.withdrawing}
          message={{ id: q.turnId, turnId: q.turnId, role: "user", text: q.append ? `${q.text}\n\n${q.append.text}` : q.text, attachments: [...(q.attachments ?? []), ...(q.append?.attachments ?? [])], toolCalls: [], streaming: false, createdAt: 0, author: app.settings.profileName || undefined, authorAvatar: app.settings.profileAvatar || undefined }}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  /* The bottom padding lives here, not on .list, so the composer growing resizes this box and
     the ResizeObserver above keeps the tail in view. */
  .rows {
    padding: 20px 28px calc(var(--composer-height, 90px) + 56px);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msg-row {
    /* contain-intrinsic-size gives a placeholder size before a row's ever
       measured, so scrollHeight doesn't jump around as rows are skipped. */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Inset, since content-visibility's paint containment would clip an outline outside the row. */
  .msg-row.editing :global(.bubble) {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .msg-row.replaced {
    opacity: 0.4;
  }
  /* On the edited row, not the first dimmed one, so the note itself isn't dimmed. */
  .msg-row.replaces::after {
    content: "Everything below is replaced when you send the edit";
    display: block;
    margin-top: 0.86rem;
    padding-top: 0.43rem;
    border-top: 1px dashed var(--panel-border);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    text-align: center;
  }
  .msg-placeholder {
    min-height: 2.5rem;
  }
</style>

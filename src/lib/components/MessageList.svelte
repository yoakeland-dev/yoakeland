<script lang="ts">
  import { app } from "../state.svelte";
  import type { ChatMessage } from "../types";
  import MessageBubble from "./MessageBubble.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";

  let {
    sessionId,
    paddingTop,
  }: { sessionId: string; paddingTop?: string } = $props();

  let container: HTMLDivElement;
  let lastSessionId: string | undefined = undefined;
  const NEAR_BOTTOM_PX = 80;
  const messages = $derived(app.active?.messagesBySession[sessionId] ?? []);
  const lastMessage = $derived(messages[messages.length - 1] as ChatMessage | undefined);

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

  function isNearBottom(): boolean {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
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

  // Only auto-scroll on new content if already near the bottom, so reading
  // history doesn't get yanked away mid-stream; a session switch always
  // jumps to bottom since scrollTop is leftover from the previous session.
  // Only the last message can be streaming, so that's the only one watched
  // here instead of scanning every message's length on each delta.
  $effect(() => {
    void messages.length;
    void lastMessage?.text.length;
    void lastMessage?.toolCalls.length;
    if (!container) return;
    const sessionChanged = lastSessionId !== sessionId;
    lastSessionId = sessionId;
    if (sessionChanged || isNearBottom()) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  });
</script>

<div
  class="list"
  bind:this={container}
  style={paddingTop ? `padding-top: ${paddingTop}` : undefined}
>
  {#each messages as message, i (message.id)}
    {@const eager = i >= messages.length - EAGER_TAIL}
    <div class="msg-row" use:observeRow={message.id}>
      {#if message.streaming || eager || hydrated.has(message.id)}
        {#if message.role === "user"}
          <MessageBubble {message} {sessionId} />
        {:else}
          <AssistantMessage {message} {sessionId} />
        {/if}
      {:else}
        <div class="msg-placeholder"></div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 20px 28px calc(var(--composer-height, 90px) + 40px);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msg-row {
    /* contain-intrinsic-size gives a placeholder size before a row's ever
       measured, so scrollHeight doesn't jump around as rows are skipped. */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }
  .msg-placeholder {
    min-height: 2.5rem;
  }
</style>

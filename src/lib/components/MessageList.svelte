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

  // A message far above the fold doesn't need its markdown parsed or its
  // tool-call cards mounted yet — that's the bulk of the cost when a long
  // chat first opens (`content-visibility` below only skips paint, not this
  // JS work). Hydrated once, stays hydrated — content-visibility's own skip
  // takes over for scrolling back past it, so there's nothing to tear down.
  // The most recent messages are exempt outright: a session always opens
  // scrolled to their tail, and the IntersectionObserver's first callback
  // needs a frame to fire, which would otherwise flash a placeholder for the
  // very thing the user opened the chat to read.
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
        // Set mutations are reactive in Svelte 5, but only the .add() calls
        // above land inside this observer callback, not a reactive context —
        // reassign so anything reading `hydrated` (isHydrated, called from
        // the template) actually reruns.
        if (changed) hydrated = new Set(hydrated);
      },
      { root: container, rootMargin: "1000px 0px" },
    );
    return () => observer?.disconnect();
  });

  // Smart anchoring: only auto-scroll on new content if the user was already
  // near the bottom, so scrolling up to read history doesn't get yanked away
  // mid-stream. On a session switch, `container.scrollTop` is still wherever
  // the previously-displayed session left it, which has no bearing on the
  // newly-shown session's content — always jump to bottom in that case
  // instead of running it through the near-bottom check. Only the last
  // message can actually still be streaming (there's ever one active turn
  // per session, and its reply is always appended last), so that's the only
  // one worth watching here — scanning every message's length on each delta
  // was pure O(n) waste for chats with any real history.
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
    /* Skip layout/paint entirely for rows scrolled out of view — cheap,
       native, and purely additive: a browser too old to support it just
       ignores the declaration and renders as before. `contain-intrinsic-size`
       gives the browser a placeholder size before a row's ever been measured
       (the `auto` keyword then remembers its real size after that first
       paint) so scrollHeight doesn't jump around as rows are skipped. */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }
  .msg-placeholder {
    min-height: 2.5rem;
  }
</style>

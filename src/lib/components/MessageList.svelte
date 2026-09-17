<script lang="ts">
  import { app } from "../state.svelte";
  import MessageBubble from "./MessageBubble.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";

  let {
    sessionId,
    paddingTop,
  }: { sessionId: string; paddingTop?: string } = $props();

  let container: HTMLDivElement;
  let lastSessionId: string | undefined = undefined;
  const NEAR_BOTTOM_PX = 80;
  const messages = $derived(app.messagesBySession[sessionId] ?? []);

  function isNearBottom(): boolean {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
  }

  // Smart anchoring: only auto-scroll on new content if the user was already
  // near the bottom, so scrolling up to read history doesn't get yanked away
  // mid-stream. On a session switch, `container.scrollTop` is still wherever
  // the previously-displayed session left it, which has no bearing on the
  // newly-shown session's content — always jump to bottom in that case
  // instead of running it through the near-bottom check.
  $effect(() => {
    // touch fields that change during streaming so this effect re-runs per delta
    void messages.map((m) => m.text.length + m.toolCalls.length);
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
  {#each messages as message (message.id)}
    {#if message.role === "user"}
      <MessageBubble text={message.text} author={message.author} authorAvatar={message.authorAvatar} />
    {:else}
      <AssistantMessage {message} />
    {/if}
  {/each}
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 20px 28px calc(var(--composer-height, 90px) + 20px);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>

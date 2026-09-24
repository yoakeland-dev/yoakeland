<script lang="ts">
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import { navigateSessionHistory } from "../ipc";
  import Icon from "./Icon.svelte";

  // reserveToggle / ownsChrome: pad clear of the floating sidebar toggle /
  // right island. sidePanel: the right sidebar's chat (close button, no chat
  // island). overlay: float above the body so content scrolls under the fade.
  let {
    sessionId,
    reserveToggle = false,
    ownsChrome = true,
    sidePanel = false,
    overlay = false,
  }: {
    sessionId: string;
    reserveToggle?: boolean;
    ownsChrome?: boolean;
    sidePanel?: boolean;
    overlay?: boolean;
  } = $props();

  // Per-server fields live on the active connection's own ServerState now —
  // see the multi-server-connections plan. `cid` is needed by every ipc.ts
  // call now that they're threaded per connection.
  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  const messages = $derived(server?.messagesBySession[sessionId] ?? []);
  const lastFinish = $derived(
    [...messages].reverse().find((m) => m.role === "assistant" && m.finish)
      ?.finish,
  );
  const git = $derived.by(() => {
    const project = server?.projectBySession[sessionId];
    return project ? server?.gitStatusByProject[project] : undefined;
  });
  // -max-session-cost-usd (§3.1 ping status.budgets) applies per session, so
  // it's shown against this session's own running total.
  const sessionCap = $derived(
    server?.serverStatus?.budgets?.find((b) => b.scope === "session" && b.period === "total")?.limitUsd,
  );
  const contextPct = $derived(
    lastFinish?.context
      ? Math.min(
          100,
          Math.round(
            (lastFinish.context.estimatedTokens /
              lastFinish.context.maxTokens) *
              100,
          ),
        )
      : 0,
  );
  const takenOver = $derived(server?.takenOverSessions[sessionId]);
  const project = $derived(server?.projectBySession[sessionId]);
  const title = $derived(
    (project ? server?.sessionsByProject[project] : undefined)?.find(
      (s) => s.sessionId === sessionId,
    )?.title || "New chat",
  );

  // Titles change twice after a chat starts: once immediately (the
  // client-derived guess) and again once the server sends back a properly
  // generated name. Rather than snapping the label, fade the old one out
  // then type the new one in — same treatment either time.
  let displayTitle = $state(untrack(() => title));
  let titlePhase: "idle" | "out" | "in" = $state("idle");
  let syncedTitle = untrack(() => title);
  let typeTimer: ReturnType<typeof setInterval> | undefined;
  let outTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const next = title;
    if (next === syncedTitle) return;
    syncedTitle = next;
    clearInterval(typeTimer);
    clearTimeout(outTimer);
    titlePhase = "out";
    outTimer = setTimeout(() => {
      displayTitle = "";
      titlePhase = "in";
      let i = 0;
      typeTimer = setInterval(() => {
        i++;
        displayTitle = next.slice(0, i);
        if (i >= next.length) {
          clearInterval(typeTimer);
          titlePhase = "idle";
        }
      }, 16);
    }, 150);
  });

  $effect(() => () => {
    clearInterval(typeTimer);
    clearTimeout(outTimer);
  });
  const sandboxTier = $derived(
    project ? server?.sandboxTierByProject[project] : undefined,
  );
</script>

<header
  class="header reserve-chrome"
  class:reserve-toggle={reserveToggle}
  class:overlay
  style={`--header-chrome-reserve: var(${ownsChrome ? "--chrome-reserve" : "--local-island-reserve"})`}
>
  <div class="left">
    {#if !sidePanel}
      <!-- This chat's own island: the two history arrows and the title. It sits
           in the header's flow rather than floating over the panel, so it slides
           with the chat area (and with the header's own reserve-toggle padding
           when the sidebar collapses, instead of needing to be dodged
           separately). Arrows first, deliberately: the title types itself in a
           character at a time (the effect above), and anything to the left of it
           would shuffle sideways on every keystroke. -->
      <div class="chrome-surface chat-island">
        <button
          class="chrome-btn"
          title="Previous chat"
          aria-label="Previous chat"
          disabled={!server?.canGoBack}
          onclick={() => cid && navigateSessionHistory(cid, "back")}
        >
          <Icon name="chevron-left" size={13} />
        </button>
        <button
          class="chrome-btn"
          title="Next chat"
          aria-label="Next chat"
          disabled={!server?.canGoForward}
          onclick={() => cid && navigateSessionHistory(cid, "forward")}
        >
          <Icon name="chevron-right" size={13} />
        </button>
        <span
          class="session-id"
          class:fading={titlePhase === "out"}
          class:typing={titlePhase === "in"}>{displayTitle}</span
        >
      </div>
    {:else}
      <span
        class="session-id"
        class:fading={titlePhase === "out"}
        class:typing={titlePhase === "in"}>{displayTitle}</span
      >
    {/if}
    {#if sandboxTier === "local_restricted_fallback"}
      <span
        class="badge warn"
        title="bash tool calls in this project have no sandbox isolation"
      >
        <Icon name="warning" size={12} /> No sandbox
      </span>
    {/if}
    {#if takenOver}
      <span class="badge warn"
        ><Icon name="warning" size={12} /> Opened elsewhere</span
      >
    {/if}
  </div>
  <div class="right">
    {#if git}
      <span
        class="stat git"
        title={`${git.detached ? "Detached HEAD" : `On ${git.branch}`} · ${git.dirtyFiles} changed file${git.dirtyFiles === 1 ? "" : "s"}${git.hasUpstream ? ` · ${git.ahead} ahead, ${git.behind} behind upstream` : " · no upstream"}`}
      >
        <Icon name="git-branch" size={12} />
        {git.detached ? "detached" : git.branch}
        {#if git.dirtyFiles}<span class="dirty">±{git.dirtyFiles}</span>{/if}
        {#if git.hasUpstream && git.ahead}<span>↑{git.ahead}</span>{/if}
        {#if git.hasUpstream && git.behind}<span>↓{git.behind}</span>{/if}
      </span>
    {/if}
    {#if lastFinish?.context}
      <div
        class="meter"
        title="{lastFinish.context.estimatedTokens} / {lastFinish.context
          .maxTokens} tokens"
      >
        <div class="meter-fill" style="width: {contextPct}%"></div>
      </div>
      <span class="stat">{contextPct}% ctx</span>
    {/if}
    {#if lastFinish?.spend}
      {@const total = lastFinish.spend.sessionTotalUsd ?? 0}
      <span
        class="stat"
        class:over={sessionCap != null && total >= sessionCap * 0.8}
        title={sessionCap != null ? `The server stops a session at $${sessionCap.toFixed(2)}` : undefined}
        >${total.toFixed(2)}{#if sessionCap != null}&nbsp;/ ${sessionCap.toFixed(2)}{/if} session</span
      >
    {/if}
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: var(--header-pad-y) var(--header-pad-x);
    min-height: var(--header-height);
    flex-shrink: 0;
    position: relative;
    /* Translucent, not solid — wallpaper and scrolled-up text both need to
       stay visible through it, just dimmed. Fades out fully within the
       header's own box, which is fine for a header that isn't floating over
       scrollable content (e.g. a non-overlay header). */
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--panel-bg) 70%, transparent) 40%,
      transparent
    );
    /* The title slides rather than jumps when the sidebar collapses and the
       toggle button lands on top of this header. */
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Floats above the body (which fills the whole panel underneath it)
     instead of sharing its flex flow, so scrolled content passes under this
     header instead of stopping short of it. Its own fade only gets partway
     down before running out of room, so it hands off to ::after below at a
     matching tint (--header-fade-mid) rather than dropping to transparent
     and fading a second time — one continuous fade, not two stacked ones. */
  .header.overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    --header-fade-mid: color-mix(in srgb, var(--panel-bg) 38%, transparent);
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--panel-bg) 70%, transparent) 40%,
      var(--header-fade-mid)
    );
  }
  .header.overlay::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 1.5rem;
    background: linear-gradient(to bottom, var(--header-fade-mid), transparent);
    pointer-events: none;
  }
  /* Room for the floating chrome that overlaps this header — the sidebar toggle
     on the left, the right island on the right. Both are positioned off the same
     tokens they reserve against (app.css), so they can't drift apart. The reserve
     for the toggle is the in-panel variant because padding here is measured from
     inside this panel's own hairline, not from the window edge. The chat island
     is in this header's own flow, so it needs no reserve of its own: it simply
     moves right with the padding when the sidebar collapses. */
  .header.reserve-toggle {
    padding-left: var(--toggle-reserve-in-panel);
  }
  /* Always reserved now — this header pads clear of whichever island
     overlaps it, the real window-corner one when `ownsChrome`, or this
     chat's own local one (ChatPanel.svelte) when it doesn't. The template
     sets --header-chrome-reserve to pick which width applies. */
  .header.reserve-chrome {
    padding-right: var(--header-chrome-reserve);
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  /* The chat island: the full chrome height, on the header's own content line, so
     it lines up with the chrome pinned in the window's corners (+page.svelte).
     Its width is its content's, which is why nothing else reserves against it —
     the title ellipsizes instead of the island stretching. */
  .chat-island {
    display: flex;
    align-items: center;
    gap: var(--chrome-gap);
    height: var(--chrome-h);
    flex-shrink: 0;
    max-width: 100%;
    padding: 0 var(--chrome-pad);
    /* The card is taller than this header's own content line (--chrome-h vs
       --header-line), so on its own it would hang off that line rather than
       centre on it. Pulling it back up by half the overhang centres it, which is
       what puts it on the same baseline as the chrome pinned in the window's
       corners (+page.svelte) — the two are adjacent whenever the sidebar is
       collapsed. */
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
  }
  .chat-island .session-id {
    min-width: 0;
    /* Room between the title and the island's right edge — the buttons side is
       already covered by the island's own padding and gap. */
    padding-right: var(--space-1);
    /* Capped rather than free to grow: a long generated title shouldn't push the
       mode chip and the status badges off the row. */
    max-width: 26rem;
  }
  .session-id {
    font-size: var(--text-body-size);
    font-weight: 600;
    font-family: var(--code-font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 1;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .session-id.fading {
    opacity: 0;
  }
  .session-id.typing::after {
    content: "";
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-left: 1px;
    vertical-align: -0.15em;
    background: currentColor;
    opacity: 0.6;
    animation: caretBlink calc(0.8s * var(--anim-speed, 1)) steps(1) infinite;
  }
  @keyframes caretBlink {
    50% {
      opacity: 0;
    }
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-half);
    font-size: 0.68rem;
    padding: 0.14rem 0.57rem;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .badge.warn {
    background: var(--danger-dim);
    color: var(--danger);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }
  .meter {
    width: 4rem;
    height: 0.29rem;
    background: rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--accent);
  }
  .stat {
    font-size: var(--text-heading-size);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .stat.git {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dirty {
    color: var(--warning);
  }
  .stat.over {
    color: var(--warning);
  }
</style>

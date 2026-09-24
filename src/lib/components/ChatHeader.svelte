<script lang="ts">
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import { navigateSessionHistory } from "../ipc";
  import Icon from "./Icon.svelte";

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
  // §3.1 ping status.budgets: session-scope cap, shown against this session's total.
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

  // Titles change twice (client guess, then server-generated name); fade out
  // and retype rather than snap, same treatment either time.
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
      <!-- Arrows before the title: it types in a character at a time, so
           anything to its left would shuffle sideways each keystroke. -->
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
    /* Translucent, not solid: wallpaper and scrolled-up text stay visible through it. */
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--panel-bg) 70%, transparent) 40%,
      transparent
    );
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Floats above the body so scrolled content passes under it. Fade hands off
     to ::after below at a matching tint so it reads as one continuous fade. */
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
  /* In-panel variant: padding here is measured from this panel's own
     hairline, not the window edge. */
  .header.reserve-toggle {
    padding-left: var(--toggle-reserve-in-panel);
  }
  .header.reserve-chrome {
    padding-right: var(--header-chrome-reserve);
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  /* Height matches the chrome pinned in the window's corners (+page.svelte). */
  .chat-island {
    display: flex;
    align-items: center;
    gap: var(--chrome-gap);
    height: var(--chrome-h);
    flex-shrink: 0;
    max-width: 100%;
    padding: 0 var(--chrome-pad);
    /* Centres the card on the header's content line despite being taller than it. */
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
  }
  .chat-island .session-id {
    min-width: 0;
    padding-right: var(--space-1);
    /* A long generated title shouldn't push the mode chip and badges off the row. */
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

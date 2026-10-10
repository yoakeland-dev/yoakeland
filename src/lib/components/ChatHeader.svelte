<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { untrack } from "svelte";
  import { app } from "../state.svelte";
  import { navigateSessionHistory, focusChat } from "../ipc";
  import Icon from "./Icon.svelte";
  import ChatCard from "./ChatCard.svelte";
  import { liveTabsFor } from "../liveChats";
  import LiveTabs from "./LiveTabs.svelte";
  import { viewport } from "../viewport.svelte";

  let {
    sessionId,
    reserveToggle = false,
    reserveChrome = true,
    ownsChrome = true,
    sidePanel = false,
    overlay = false,
    snap = false,
    chatWidth,
    swapped = false,
    leftWidth = $bindable(0),
  }: {
    sessionId: string;
    reserveToggle?: boolean;
    /** Off while the tools column sits between this header and the window chrome. */
    reserveChrome?: boolean;
    ownsChrome?: boolean;
    sidePanel?: boolean;
    overlay?: boolean;
    /** Moving between chats: the fade lands without animating. */
    snap?: boolean;
    /** The chat column's width while the tools column shares the panel. */
    chatWidth?: string;
    /** Tools on the left: the header still spans the panel so its left end stays put. */
    swapped?: boolean;
    leftWidth?: number;
  } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  // Nothing scrolls under an empty chat's header, so its fade goes (the wallpaper shows clean);
  // a chat with messages gets a stronger one.
  const empty = $derived(!(server?.messagesBySession[sessionId]?.length) && !server?.syncingSessions[sessionId]);

  const paired = $derived(sidePanel || (!!server?.sidebarSessionId && !app.rightSidebarCollapsed));

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

  let titleSession = untrack(() => sessionId);
  $effect(() => {
    const next = title;
    const switched = sessionId !== titleSession;
    titleSession = sessionId;
    if (next === syncedTitle) return;
    syncedTitle = next;
    clearInterval(typeTimer);
    clearTimeout(outTimer);
    // Another chat's title just appears; only a rename within a chat fades and retypes.
    if (switched && snap) {
      displayTitle = next;
      titlePhase = "idle";
      return;
    }
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
  // Chats elsewhere that want you, across every server. Needs-you tabs stay ahead of the rest
  // (the sort is stable, so each server's own order survives). Not shown while the tools column
  // is swapped under this header: it would land on the tools' tab row.
  const liveTabs = $derived(
    sidePanel || swapped
      ? []
      : Object.entries(app.servers)
          .flatMap(([scid, srv]) =>
            liveTabsFor(scid, srv, scid === app.activeConnectionId ? [srv.currentSessionId, srv.sidebarSessionId] : []),
          )
          .sort((a, b) => +(a.status !== "action") - +(b.status !== "action")),
  );
  // The title's hover card: the same card the sidebar rows show, with git, sandbox and spend in it.
  const summary = $derived(server?.sessionById.get(sessionId));
</script>

{#snippet titleCard()}
  {#if cid && summary}<ChatCard connectionId={cid} session={summary} />{/if}
{/snippet}

<header
  class="header has-island"
  class:reserve-chrome={reserveChrome}
  class:reserve-toggle={reserveToggle}
  class:overlay
  class:empty
  class:snap
  class:has-live={liveTabs.length > 0}
  class:split={!!chatWidth && !swapped}
  class:swapped={!!chatWidth && swapped}
  style={`--header-chrome-reserve: var(${ownsChrome ? "--chrome-reserve" : "--local-island-reserve"})${chatWidth ? `; --chat-w: ${chatWidth}` : ""}`}
>
  <div class="left" bind:clientWidth={leftWidth}>
    <!-- Buttons before the title: it types in a character at a time, so
         anything to its left would shuffle sideways each keystroke. -->
    <div class="chrome-surface chat-island">
      {#if !sidePanel}
        <button
          class="chrome-btn desk-only"
          {@attach tip("Previous chat", "chat.back")}
          aria-label="Previous chat"
          disabled={!server?.canGoBack}
          onclick={() => cid && navigateSessionHistory(cid, "back")}
        >
          <Icon name="chevron-left" size={13} />
        </button>
        <button
          class="chrome-btn desk-only"
          {@attach tip("Next chat", "chat.forward")}
          aria-label="Next chat"
          disabled={!server?.canGoForward}
          onclick={() => cid && navigateSessionHistory(cid, "forward")}
        >
          <Icon name="chevron-right" size={13} />
        </button>
      {/if}
      <!-- Either half of a visible pairing can be pulled out on its own. -->
      {#if paired}
        <button
          class="chrome-btn"
          {@attach tip("Focus this chat")}
          aria-label="Focus this chat"
          onclick={() => cid && focusChat(cid, sessionId)}
        >
          <Icon name="maximize" size={13} />
        </button>
      {/if}
      {#if sidePanel}
        <button
          class="chrome-btn"
          {@attach tip("Close side chat")}
          aria-label="Close side chat"
          onclick={() => server?.closeSidePanel()}
        >
          <Icon name="xmark" size={13} />
        </button>
      {/if}
      <span
        class="session-id"
        class:fading={titlePhase === "out"}
        class:typing={titlePhase === "in"}
        {@attach tip(summary && cid ? titleCard : undefined, { side: "bottom" })}>{displayTitle}</span
      >
    </div>
  </div>
  {#if liveTabs.length && !viewport.narrow}<LiveTabs tabs={liveTabs} />{/if}
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
  /* Floats above the body so scrolled content passes under it. The fade is the ::before (and
     ::after below it, at a matching tint so it reads as one continuous fade): fading their
     opacity lets it ease in and out with the composer's slide, which a gradient can't do itself. */
  .header.overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    background: none;
    --header-fade-mid: color-mix(in srgb, var(--panel-bg) 58%, transparent);
  }
  .header.overlay::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--panel-bg) 88%, transparent) 40%,
      var(--header-fade-mid)
    );
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
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
    transition: opacity calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* Nothing scrolls under an empty chat's header, so its fade goes. */
  .header.overlay.empty::before,
  .header.overlay.empty::after {
    opacity: 0;
  }
  .header.snap::before,
  .header.snap::after {
    transition: none;
  }
  .header.split {
    right: var(--chat-w);
  }
  /* Spans the whole panel so the island stays where it was, but only the chat column (on the
     right) gets the fade, and only the header's own pieces take clicks. */
  .header.swapped {
    pointer-events: none;
    background: none;
  }
  .header.swapped > * {
    pointer-events: auto;
  }
  .header.swapped::before {
    inset: 0 0 0 auto;
    width: var(--chat-w);
  }
  .header.swapped::after {
    left: auto;
    width: var(--chat-w);
  }
  /* The island sits as far from the panel's left edge as from its top. */
  .header.has-island {
    padding-left: var(--chrome-inset-in-panel);
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
  /* The tabs sit right after the title island instead of space-between pushing them to the far
     end; the title clips (ellipsis) before the tabs do. */
  .header.has-live {
    justify-content: flex-start;
  }

  @media (max-width: 700px) {
    /* A docked bar, not a fade over the chat; an empty chat's wallpaper shows through instead. */
    .header.overlay {
      background: var(--panel-bg);
      border-bottom: 1px solid var(--panel-border);
    }
    .header.overlay::before,
    .header.overlay::after {
      display: none;
    }
    .header.overlay.empty {
      background: none;
      border-bottom-color: transparent;
    }
    .desk-only {
      display: none;
    }
    .chat-island .session-id {
      max-width: none;
    }
  }
</style>

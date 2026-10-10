<script lang="ts">
  // The empty chat's feed, laid out like a browser's new tab: the composer sits centred, the
  // cards follow right below it, and scrolling (the wheel works anywhere over the chat) carries
  // the hero and composer off the top along with them. Everything here is read from state the
  // client already has, so it costs no model call.
  import { onMount, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { app, CHAT_PROJECT } from "../state.svelte";
  import { briefOf, CHAT_STARTERS, clip, projectStarters } from "../chatBrief";
  import { getSessionHistory, openChatSession } from "../ipc";
  import { basename, relTime, sessionTitle } from "../format";
  import { STATUS_ICON } from "../liveChats";
  import type { SessionSummary } from "../types";
  import Icon from "./Icon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  const server = $derived(app.active);
  const cid = $derived(app.activeConnectionId);
  const project = $derived(server?.projectBySession[sessionId]);
  const isChat = $derived(project === CHAT_PROJECT);

  // This project's latest chats, newest first: what "pick up where you left off" offers. A
  // project-less chat has no recents: that's a project thing.
  const recent = $derived.by<SessionSummary[]>(() => {
    if (!server || !project || isChat) return [];
    const cutoff = app.now - app.settings.autoArchiveDays * 86400000;
    return (server.sessionsByProject[project] ?? [])
      .filter((s) => s.sessionId !== sessionId && s.messageCount > 0 && !s.archived && Date.parse(s.updatedAt) > cutoff)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 4);
  });
  // A chat this client never opened has no cached transcript; fetch the few that are shown, once.
  const asked = new Set<string>();
  $effect(() => {
    if (!cid || server?.connectionStatus !== "connected") return;
    for (const s of recent) {
      if (asked.has(s.sessionId) || server.messagesBySession[s.sessionId]?.length) continue;
      asked.add(s.sessionId);
      untrack(() => getSessionHistory(cid, s.sessionId));
    }
  });
  const cards = $derived(recent.map((s) => ({ s, brief: briefOf(server?.messagesBySession[s.sessionId] ?? []) })));

  const git = $derived(project && !isChat ? server?.gitStatusByProject[project] : undefined);
  const starters = $derived(
    isChat ? CHAT_STARTERS : projectStarters(project ? server?.filesByProject[project] : undefined, git?.dirtyFiles ?? 0),
  );

  const weekChats = $derived(
    (project ? (server?.sessionsByProject[project] ?? []) : []).filter((s) => s.messageCount > 0 && app.now - Date.parse(s.updatedAt) < 7 * 86400000).length,
  );
  const spend = $derived(server?.serverStatus?.spend);
  const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
  const stats = $derived([
    ...(weekChats ? [{ n: String(weekChats), label: weekChats === 1 ? "chat this week" : "chats this week" }] : []),
    ...(spend ? [{ n: usd(spend.todayUsd), label: "spent today" }, { n: usd(spend.monthUsd), label: "spent this month" }] : []),
  ]);

  let scroller = $state<HTMLDivElement>();
  const toTop = () => scroller?.scrollTo({ top: 0, behavior: "smooth" });
  function tryStarter(prompt: string) {
    if (server) server.restoredDraftBySession[sessionId] = prompt;
    toTop();
  }

  // Scroll linkage: the composer rides the scroll via `--feed-scroll`, set on the chat body
  // (PromptInput reads it). The composer and hero sit above this scroller, so a wheel over them
  // never reaches it and is forwarded here; over the cards the browser scrolls natively.
  onMount(() => {
    const body = scroller?.closest<HTMLElement>(".body");
    if (!body || !scroller) return;
    const el = scroller;
    body.style.setProperty("--feed-scroll", "0px");
    const onScroll = () => body.style.setProperty("--feed-scroll", `${el.scrollTop}px`);
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.contains(e.target as Node)) return;
      const ta = (e.target as HTMLElement).closest?.("textarea");
      if (ta && ta.scrollHeight > ta.clientHeight) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // A trackpad streams small pixel deltas and is already smooth, so it's applied as is; a wheel
      // notch (~100px) is animated, as the browser does over the cards.
      el.scrollBy({ top: dy, behavior: Math.abs(dy) >= 50 ? "smooth" : "auto" });
    };
    // Focusing a composer that has scrolled away (a shortcut) brings it back.
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest?.(".stack")) toTop();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    body.addEventListener("wheel", onWheel, { passive: false });
    body.addEventListener("focusin", onFocusIn);
    return () => {
      el.removeEventListener("scroll", onScroll);
      body.removeEventListener("wheel", onWheel);
      body.removeEventListener("focusin", onFocusIn);
      body.style.removeProperty("--feed-scroll");
    };
  });
  // Another chat's feed starts at the top, composer back at centre.
  $effect(() => {
    sessionId;
    untrack(() => scroller?.scrollTo({ top: 0 }));
  });
</script>

<!-- The feed itself (and its wash) fades only as it appears or goes; moving between two empty
     chats keeps it up and swaps just the content, out then in, so the wallpaper never lightens
     in between. -->
<div class="feed" bind:this={scroller} in:fade={{ duration: 180 }} out:fade={{ duration: 120 }}>
  <div class="lead"></div>
  <div class="sheet">
    <div class="swap">
      {#key sessionId}
      <div class="content" in:fade={{ duration: 160, delay: 120 }} out:fade={{ duration: 120 }}>
        {#if cards.length}
          <section>
            <h3>Pick up where you left off</h3>
            <div class="grid chats" style:--cols={Math.min(3, Math.max(1, cards.length - 1))}>
              {#each cards as { s, brief }, i (s.sessionId)}
                {@const st = server?.sessionStatus(s.sessionId) ?? "idle"}
                {@const max = i === 0 ? 4 : 2}
                <button class="card chat" class:feature={i === 0} onclick={() => cid && openChatSession(cid, s.sessionId)}>
                  <span class="head">
                    <span class="status {st}"><Icon name={STATUS_ICON[st]} size={13} /></span>
                    <span class="title">{sessionTitle(s)}</span>
                    <span class="time">{relTime(s.updatedAt, app.now)}</span>
                  </span>
                  {#if brief.lastReply || brief.firstAsk}
                    <span class="body-text">{brief.lastReply ? clip(brief.lastReply, i === 0 ? 220 : 150) : `You: ${clip(brief.firstAsk ?? "", 150)}`}</span>
                  {/if}
                  {#if brief.files.length}
                    <span class="chips">
                      {#each brief.files.slice(0, max) as f (f)}<span class="chip">{basename(f)}</span>{/each}
                      {#if brief.files.length > max}<span class="chip">+{brief.files.length - max}</span>{/if}
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          </section>
        {/if}

        {#if git && (git.dirtyFiles || git.ahead || git.behind)}
          <section>
            <h3>Working tree</h3>
            <button class="card strip" onclick={() => server?.openSidebarPanel(sessionId, "git")}>
              <Icon name="git-branch" size={13} />
              <span class="branch">{git.detached ? "detached" : git.branch}</span>
              {#if git.dirtyFiles}<span class="dirty">±{git.dirtyFiles}</span>{/if}
              {#if git.hasUpstream && git.ahead}<span class="sync">↑{git.ahead}</span>{/if}
              {#if git.hasUpstream && git.behind}<span class="sync">↓{git.behind}</span>{/if}
              {#if git.files?.length}
                <span class="chips">
                  {#each git.files.slice(0, 3) as f (f.path)}<span class="chip">{basename(f.path)}</span>{/each}
                  {#if git.dirtyFiles > 3}<span class="chip">+{git.dirtyFiles - 3}</span>{/if}
                </span>
              {/if}
            </button>
          </section>
        {/if}

        <section>
          <h3>{isChat ? "Try asking" : "Start with"}</h3>
          <div class="grid two">
            {#each starters as st (st.title)}
              <button class="card starter" onclick={() => tryStarter(st.prompt)}>
                <span class="head">
                  <span class="status"><Icon name={st.icon as any} size={14} /></span>
                  <span class="title">{st.title}</span>
                </span>
                <span class="body-text">{st.prompt}</span>
              </button>
            {/each}
          </div>
        </section>

        {#if stats.length}
          <section>
            <h3>Activity</h3>
            <div class="stats">
              {#each stats as st (st.label)}
                <div class="stat"><b>{st.n}</b><span>{st.label}</span></div>
              {/each}
            </div>
          </section>
        {/if}
      </div>
      {/key}
    </div>
  </div>
</div>

<style>
  .feed {
    /* What the wallpaper is washed with as the cards rise over it; see .lead and .sheet. */
    --wash-c: var(--panel-bg);
    --wash-a: 86%;
    --wash: color-mix(in srgb, var(--wash-c) var(--wash-a), transparent);
    position: absolute;
    inset: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    overflow-x: hidden;
    scrollbar-width: none;
    /* Below the composer's overlay (.wrap in PromptInput); the header sits above both. */
    z-index: 0;
  }
  /* Room for the hero and composer (they live in PromptInput's overlay, centred). With .sheet's
     11rem of wash above the cards, they start 12rem below centre, or peek 12rem up from the
     bottom edge in a tall window. The wash is part of the scrolling content, so the wallpaper
     stays clear up top and sinks behind the cards as they scroll up, with no scroll handler. */
  .lead {
    height: max(calc(50% + 1rem), calc(100% - 23rem));
  }
  /* The wash starts 11rem above the first card and is one element's background, so there's no seam
     between the band and the solid that could anti-alias into a line. Eased (smoothstep) rather
     than linear, so neither end of the band shows. */
  .sheet {
    box-sizing: border-box;
    padding: 11rem 0 var(--space-4);
    /* Enough scroll for the composer to clear the header even with only a card or two. */
    min-height: calc(100% - var(--header-height) + 11rem);
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.043), transparent) 1.375rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.156), transparent) 2.75rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.316), transparent) 4.125rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.5), transparent) 5.5rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.684), transparent) 6.875rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.844), transparent) 8.25rem,
      color-mix(in srgb, var(--wash-c) calc(var(--wash-a) * 0.957), transparent) 9.625rem,
      var(--wash) 11rem
    );
  }
  /* Both contents share the cell while they cross, so the sheet doesn't resize under the fade. */
  .swap {
    display: grid;
    /* Else a long unwrapped line inside widens the cell past a narrow panel. */
    grid-template-columns: minmax(0, 1fr);
  }
  .content {
    grid-area: 1 / 1;
    width: min(54rem, calc(100% - 3.43rem));
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  /* The composer's surface (--float-* tokens, app.css): translucent over a blur when Settings >
     Surfaces is frosted, the plain panel fill otherwise. */
  .card,
  .stat,
  h3 {
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
  }
  /* A label pill rather than a rule: a hairline gets lost over a wallpaper, a surface doesn't. */
  h3 {
    align-self: flex-start;
    margin: 0;
    padding: 0.18rem 0.65rem;
    border-radius: var(--radius-pill);
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight, 600);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
    gap: 0.6rem;
  }
  /* The short cards share the row under the featured one: as many columns as there are of them
     (up to three), fewer when the window can't fit that, so there's never an empty cell. */
  .grid.chats {
    grid-template-columns: repeat(
      auto-fit,
      minmax(max(min(15rem, 100%), calc((100% - (var(--cols) - 1) * 0.6rem) / var(--cols) - 0.1px)), 1fr)
    );
  }
  .grid.two {
    grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
    padding: 0.75rem 0.9rem;
    text-align: left;
    font: inherit;
    color: var(--text);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: border-color calc(0.15s * var(--anim-speed, 1)) ease;
  }
  /* The composer's own focus edge. */
  .card:hover,
  .card:focus-visible {
    border-color: color-mix(in srgb, var(--text) 24%, transparent);
  }
  .card:focus-visible {
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .time {
    flex-shrink: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .body-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-label-size);
    line-height: 1.5;
    color: var(--text-dim);
  }
  /* The sidebar rows' status icon: coloured only when the chat is doing something. */
  .status {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text-dim);
  }
  .status.action {
    color: var(--warning);
  }
  .status.finished {
    color: var(--success);
  }
  .status.working {
    color: var(--info);
  }
  .status.working :global(svg) {
    animation: spin-global calc(1s * var(--icon-slow, 1)) linear infinite;
  }

  /* The latest chat, wide: the one most likely to be what you came back for. */
  .feature {
    grid-column: 1 / -1;
    padding: 1rem 1.1rem;
    gap: 0.55rem;
  }
  .feature .title {
    font-size: 1rem;
  }
  .feature .body-text {
    font-size: var(--text-body-size);
  }
  .starter {
    padding: 0.9rem 1rem;
    gap: 0.5rem;
  }
  .starter .body-text {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  /* An odd one out takes the row rather than leaving a hole beside it. */
  .starter:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  /* Reads like the composer's git chip: plain text, coloured only where it carries meaning. */
  .strip {
    flex-direction: row;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.9rem;
    color: var(--text-dim);
  }
  .branch {
    font-family: var(--code-font-family);
    font-size: var(--text-label-size);
    font-weight: 600;
    color: var(--text);
  }
  .dirty {
    color: var(--warning);
  }
  .dirty,
  .sync {
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
  }
  /* One line: the file names give way (ellipsis) before anything wraps. */
  .strip .chips {
    flex: 1;
    flex-wrap: nowrap;
    justify-content: flex-end;
    overflow: hidden;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    min-width: 0;
  }
  .chip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.08rem 0.45rem;
    border-radius: var(--radius-xs);
    font-size: 0.7rem;
    font-family: var(--code-font-family);
    color: var(--text-dim);
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.65rem 0.9rem;
    border-radius: var(--radius-lg);
  }
  .stat b {
    font-size: 1.15rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .stat span {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>

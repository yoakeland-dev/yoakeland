<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { untrack } from "svelte";
  import { app, CHAT_SIDEBAR_MIN_WIDTH, chatSidebarMinCss } from "../state.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import MessageList from "./MessageList.svelte";
  import PromptInput from "./PromptInput.svelte";
  import PlanPanel from "./PlanPanel.svelte";
  import TerminalPanel from "./TerminalPanel.svelte";
  import ChatSidebar from "./ChatSidebar.svelte";
  import Icon from "./Icon.svelte";
  import FindBar from "./FindBar.svelte";
  import { matches } from "../keybinds.svelte";
  import { wallpaperGL } from "../wallpaperGL";

  // `panelEl` lets +page.svelte measure this panel: the corner handle where
  // the right sidebar meets the terminal needs it for its clamp math.
  let {
    sessionId,
    ownsChrome = true,
    sidePanel = false,
    panelEl = $bindable(null),
  }: {
    sessionId: string;
    ownsChrome?: boolean;
    sidePanel?: boolean;
    panelEl?: HTMLElement | null;
  } = $props();

  const server = $derived(app.active);
  const messages = $derived(server?.messagesBySession[sessionId] ?? []);
  const isEmpty = $derived(messages.length === 0);
  const isSyncing = $derived(server?.syncingSessions[sessionId] ?? false);

  // The tools column (ChatSidebar.svelte). The header covers only the chat's own column, so the
  // tools' tab row can share the header band. `sbW` is the right-hand column's width as a share of
  // .row. It goes straight onto the few boxes it sizes, never as a custom property on .panel:
  // custom properties inherit, so changing one there restyles every node in the chat on each
  // pointermove of a resize.
  const sbOpen = $derived(server?.chatSidebarOpenBySession[sessionId] ?? false);
  const swapped = $derived(sbOpen && !!server?.chatSidebarSwappedBySession[sessionId]);
  // Same minimum as ChatSidebar.svelte's slot: the tools' tab row when they're on the right.
  const sbMin = $derived(swapped ? `${CHAT_SIDEBAR_MIN_WIDTH}px` : chatSidebarMinCss(ownsChrome ? "--chrome-reserve" : "--local-island-reserve"));
  const sbW = $derived(`clamp(${sbMin}, ${app.chatSidebarWidthRatio * 100}%, 50%)`);

  // Swapping snaps rather than sliding: transitions are off for the frame the layout flips in.
  let instant = $state(false);
  let lastSwapped = untrack(() => swapped);
  $effect.pre(() => {
    if (swapped === lastSwapped) return;
    lastSwapped = swapped;
    instant = true;
    requestAnimationFrame(() => requestAnimationFrame(() => (instant = false)));
  });

  let list = $state<MessageList>();
  let scrolledUp = $state(false);

  // The header's left end (its padding plus the back/forward/title island), so the tools' tab
  // row can start after it once swapped under it.
  let headerLeftW = $state(0);

  // Different backend from TerminalView's xterm SearchAddon: matches each
  // message's plain-text field and navigates message-to-message, so "N
  // matches" is N messages containing the term, not N occurrences.
  let chatFindOpen = $state(false);
  let chatFindQuery = $state("");
  let chatFindInputEl = $state<HTMLInputElement | null>(null);
  let chatFindIndex = $state(-1);
  const chatFindMatchIds = $derived.by(() => {
    const q = chatFindQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => m.text.toLowerCase().includes(q)).map((m) => m.id);
  });
  $effect(() => {
    chatFindIndex = chatFindMatchIds.length ? 0 : -1;
  });

  function openChatFind() {
    chatFindOpen = true;
    requestAnimationFrame(() => chatFindInputEl?.focus());
  }
  function closeChatFind() {
    chatFindOpen = false;
  }
  function scrollToChatMatch() {
    const id = chatFindMatchIds[chatFindIndex];
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("chat-find-active");
    setTimeout(() => el.classList.remove("chat-find-active"), 1200);
  }
  function chatFindNext() {
    if (!chatFindMatchIds.length) return;
    chatFindIndex = (chatFindIndex + 1) % chatFindMatchIds.length;
    scrollToChatMatch();
  }
  function chatFindPrevious() {
    if (!chatFindMatchIds.length) return;
    chatFindIndex = (chatFindIndex - 1 + chatFindMatchIds.length) % chatFindMatchIds.length;
    scrollToChatMatch();
  }
  function onChatKeydown(e: KeyboardEvent) {
    if (matches(e, "chat.find")) {
      e.preventDefault();
      openChatFind();
    }
  }
</script>

<div class="chat-area">
  <section
    class="panel"
    data-session-id={sessionId}
    class:sidebar-collapsed={!sidePanel && app.sidebarCollapsed}
    class:sb-open={sbOpen}
    class:sb-swapped={swapped}
    class:sb-resizing={app.chatSidebarResizing}
    class:instant
    bind:this={panelEl}
  >
    {#if app.settings.wallpaper}
      <canvas
        class="wallpaper"
        class:visible={isEmpty}
        use:wallpaperGL={{ src: app.settings.wallpaper, style: app.settings.wallpaperStyle, visible: isEmpty }}
      ></canvas>
    {/if}
    <ChatHeader
      {sessionId}
      reserveToggle={!sidePanel && app.sidebarCollapsed}
      reserveChrome={!sbOpen || swapped}
      chatWidth={sbOpen ? sbW : undefined}
      {swapped}
      {ownsChrome}
      {sidePanel}
      overlay
      bind:leftWidth={headerLeftW}
    />
    {#if !ownsChrome}
      <!-- Same chrome-surface look as the real window-corner island (app.css),
           anchored to this panel's own corner instead. -->
      <div class="chrome-surface local-island">
        <button
          class="chrome-btn"
          class:active={server?.terminalOpenBySession[sessionId]}
          {@attach tip(server?.terminalOpenBySession[sessionId] ? "Hide terminal" : "Show terminal", "terminal.toggle")}
          onclick={() => server?.toggleTerminal(sessionId)}
        >
          <Icon name="terminal-2" size={14} />
        </button>
        <button
          class="chrome-btn"
          class:active={server?.chatSidebarOpenBySession[sessionId]}
          {@attach tip(server?.chatSidebarOpenBySession[sessionId] ? "Hide side panel" : "Show side panel", "panel.toggle")}
          onclick={() => server?.toggleChatSidebar(sessionId)}
        >
          <Icon
            name={server?.chatSidebarOpenBySession[sessionId] ? "sidebar-right-collapse" : "sidebar-right-expand"}
            size={14}
          />
        </button>
      </div>
    {/if}
    <div class="row" class:swapped>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="body"
        class:syncing={isSyncing}
        inert={isSyncing}
        onkeydown={onChatKeydown}
        style:flex-basis={swapped ? sbW : null}
      >
        <MessageList bind:this={list} bind:scrolledUp {sessionId} paddingTop="calc(var(--header-height) + 20px)" />
        <PromptInput {sessionId} floating={isEmpty} {scrolledUp} onJump={() => list?.jumpToBottom()} />
        {#if app.active?.openPlanSessionId === sessionId}
          <PlanPanel {sessionId} />
        {/if}
        {#if chatFindOpen}
          <FindBar
            bind:query={chatFindQuery}
            bind:inputEl={chatFindInputEl}
            matchIndex={chatFindIndex}
            matchCount={chatFindMatchIds.length}
            class="chat-find-bar"
            onNext={chatFindNext}
            onPrevious={chatFindPrevious}
            onClose={closeChatFind}
          />
        {/if}
      </div>
      <ChatSidebar {sessionId} {ownsChrome} {sidePanel} reserveLeft={headerLeftW} />
    </div>
    <!-- Below the row, not inside it: opening it shrinks .row as a whole
         rather than carving into just .body or ChatSidebar. -->
    <TerminalPanel {sessionId} />
    {#if isSyncing}
      <div class="syncing-badge"><span class="spinner"></span> Syncing…</div>
    {/if}
  </section>
</div>

<style>
  .chat-area {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .panel {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-xl);
    margin: var(--chat-margin) var(--chat-margin) var(--chat-margin) 0;
    overflow: hidden;
    /* Matches Sidebar.svelte's .sidebar-slot flex-basis transition, else the
       panel jumps ahead of the sidebar's own animating margin. */
    transition: margin-left calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .panel.sidebar-collapsed {
    margin-left: var(--chat-margin);
  }
  :global(:root[data-main="flat"]) .panel {
    border-radius: 0;
    border-width: 0 0 0 1px;
  }
  .row {
    flex: 1;
    display: flex;
    min-height: 0;
    /* ChatSidebar.svelte sizes its sliding body in cqw against this. */
    container-type: inline-size;
  }
  .body {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    /* PromptInput's floating hero sizes off this panel's width (cqi), not
       the viewport, since a sidebar can narrow it. */
    container-type: inline-size;
  }
  /* Swapped: the chat is the narrow right column (its width inline), the tools take the rest. */
  .row.swapped .body {
    flex-grow: 0;
    flex-shrink: 0;
  }
  /* The header spans only the chat column (ChatHeader.svelte sizes that). */
  .panel > :global(.header) {
    transition:
      padding calc(0.2s * var(--anim-speed, 1)) ease,
      right calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .panel.sb-resizing > :global(.header),
  .panel.instant > :global(.header),
  .panel.instant :global(.chat-sidebar-slot),
  .panel.instant :global(.chat-sidebar-body),
  .panel.instant :global(.chat-sidebar-body > .tabs) {
    transition: none;
  }
  .body :global(.rows > *) {
    width: 100%;
    max-width: 56rem;
    align-self: center;
  }
  .wallpaper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    opacity: 0;
    transition: opacity calc(0.4s * var(--anim-speed, 1)) ease;
    pointer-events: none;
  }
  .wallpaper.visible {
    opacity: 1;
  }
  :global(.panel > :not(.wallpaper)) {
    position: relative;
    z-index: 1;
  }
  /* Must beat the rule above on z-index, not just source order, since
     stylesheet injection order across files isn't reliable. */
  :global(.panel > .header) {
    z-index: 2;
  }
  /* Above the header (3 vs 2): reads as chrome sitting on top of the chat. */
  .local-island {
    position: absolute;
    top: var(--chrome-inset-in-panel);
    right: var(--chrome-inset-in-panel);
    height: var(--chrome-h);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--chrome-gap);
    padding: 0 var(--chrome-pad);
  }
  .body.syncing {
    opacity: 0.45;
    filter: grayscale(0.6);
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease, filter calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .syncing-badge {
    position: absolute;
    top: calc(var(--header-height) + 10px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-pill);
    padding: 0.36rem 0.86rem;
    font-size: 0.78rem;
    color: var(--text-dim);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  }
  .spinner {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2px solid var(--sidebar-fg-dim);
    border-top-color: var(--accent);
    animation: spin calc(0.7s * var(--icon-slow, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Pushes FindBar below the floating header; !important beats its own
     scoped rule, which otherwise wins on specificity. */
  :global(.chat-find-bar) {
    top: calc(var(--header-height) + 10px) !important;
  }
  /* :global since the element lives in MessageList's DOM, not this template. */
  :global(.chat-find-active) {
    animation: chatFindPulse calc(1.2s * var(--anim-speed, 1)) ease-out;
  }
  @keyframes chatFindPulse {
    0% {
      box-shadow: 0 0 0 2px var(--accent);
      border-radius: var(--radius-sm);
    }
    100% {
      box-shadow: 0 0 0 2px transparent;
      border-radius: var(--radius-sm);
    }
  }
</style>

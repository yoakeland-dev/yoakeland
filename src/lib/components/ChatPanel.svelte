<script lang="ts">
  import { app } from "../state.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import MessageList from "./MessageList.svelte";
  import PromptInput from "./PromptInput.svelte";
  import PlanPanel from "./PlanPanel.svelte";
  import TerminalPanel from "./TerminalPanel.svelte";
  import ChatSidebar from "./ChatSidebar.svelte";
  import Icon from "./Icon.svelte";
  import FindBar from "./FindBar.svelte";
  import { wallpaperGL } from "../wallpaperGL";

  // `ownsChrome` / `sidePanel` — see ChatHeader.svelte's own doc comment for
  // what each means; both just pass straight through. `sidePanel` also gates
  // the `.sidebar-collapsed` left-margin swap below, since that's only ever
  // about the *left* app sidebar this chat may be docked against — never true
  // for the linked/side chat, which isn't adjacent to it.
  // `panelEl` is bindable so +page.svelte can measure this chat's own panel
  // box — the corner handle where the right sidebar meets the terminal needs
  // it to compute the terminal's live height without duplicating its clamp
  // math (see +page.svelte).
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

  // Find-in-chat (FindBar.svelte, shared with TerminalView.svelte's own
  // Ctrl+F — see that component's doc comment). A different backend from the
  // terminal's xterm SearchAddon: there's no in-buffer text layer to search
  // here, messages are rendered as markdown/tool-call cards, so this matches
  // against each message's own plain-text field and navigates message-to-
  // message rather than character-to-character — "N matches" means N
  // messages containing the term, not N occurrences within them.
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openChatFind();
    }
  }
</script>

<div class="chat-area">
  <section
    class="panel"
    class:sidebar-collapsed={!sidePanel && app.sidebarCollapsed}
    bind:this={panelEl}
  >
    {#if app.settings.wallpaper}
      <canvas
        class="wallpaper"
        class:visible={isEmpty}
        use:wallpaperGL={{ src: app.settings.wallpaper, style: app.settings.wallpaperStyle }}
      ></canvas>
    {/if}
    <!-- The window's own right island (+page.svelte) only lands on this
         header while it owns the chrome (`ownsChrome`). The sidebar toggle
         only lands here once the left sidebar is collapsed away, and only
         for the main chat. -->
    <ChatHeader
      {sessionId}
      reserveToggle={!sidePanel && app.sidebarCollapsed}
      {ownsChrome}
      {sidePanel}
      overlay
    />
    {#if !ownsChrome}
      <!-- This chat's own local island — same chrome-surface look as the
           real window-corner one (app.css), just anchored to this panel's
           own corner instead, for whichever chat doesn't currently own that
           one (+page.svelte decides which). -->
      <div class="chrome-surface local-island">
        <button
          class="chrome-btn"
          class:active={server?.terminalOpenBySession[sessionId]}
          title={server?.terminalOpenBySession[sessionId] ? "Hide terminal" : "Show terminal"}
          onclick={() => server?.toggleTerminal(sessionId)}
        >
          <Icon name="terminal-2" size={14} />
        </button>
        <button
          class="chrome-btn"
          class:active={server?.chatSidebarOpenBySession[sessionId]}
          title={server?.chatSidebarOpenBySession[sessionId] ? "Hide sidebar" : "Show sidebar"}
          onclick={() => server?.toggleChatSidebar(sessionId)}
        >
          <Icon
            name={server?.chatSidebarOpenBySession[sessionId] ? "sidebar-right-collapse" : "sidebar-right-expand"}
            size={14}
          />
        </button>
      </div>
    {/if}
    <div class="row">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="body" class:syncing={isSyncing} inert={isSyncing} onkeydown={onChatKeydown}>
        <MessageList {sessionId} paddingTop="calc(var(--header-height) + 20px)" />
        <PromptInput {sessionId} floating={isEmpty} />
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
      <ChatSidebar {sessionId} />
    </div>
    <!-- Full-width, below the row above — opening it shrinks that whole row,
         pushing both the chat body and ChatSidebar up together, rather than
         carving its own corner out of just one of them. -->
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
    /* Kept in step with .sidebar-slot's own flex-basis transition
       (Sidebar.svelte) — without this, toggling .sidebar-collapsed below
       snaps this margin instantly while the sidebar's reserved space next to
       it animates, so the panel visibly jumps before catching up. */
    transition: margin-left calc(0.2s * var(--anim-speed, 1)) ease;
  }
  /* No sidebar to its left when collapsed — without this the panel touches
     the window edge instead of matching its margin on every other side. */
  .panel.sidebar-collapsed {
    margin-left: var(--chat-margin);
  }
  /* Flat main area (see app.css): square, edge to edge, with only a hairline
     where it meets the sidebar or a neighbouring chat. */
  :global(:root[data-main="flat"]) .panel {
    border-radius: 0;
    border-width: 0 0 0 1px;
  }
  /* Holds .body and ChatSidebar side by side, with TerminalPanel a sibling
     below both (not inside this row) — see the template comment. */
  .row {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .body {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    /* Lets PromptInput's floating hero shrink its font off this panel's
       actual width (cqi) rather than the viewport — the panel is narrower
       than the window whenever a sidebar is open. */
    container-type: inline-size;
  }
  .body :global(.list > *) {
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
  /* The header floats above .body here (ChatHeader's `overlay` prop), so it
     needs to actually stack above it — same specificity as the rule above
     otherwise, and which one wins would come down to stylesheet injection
     order across files rather than anything declared here. */
  :global(.panel > .header) {
    z-index: 2;
  }
  /* Same corner as the real window island (+page.svelte), just measured
     against this panel's own box instead of the window's — see
     --chrome-inset-in-panel in app.css. Above the header (z-index: 3 vs. 2)
     since it's meant to read as chrome sitting on top of the chat, the same
     relationship the real island has with whatever header it lands on. */
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
  /* Floats over the transcript, so it's a floating surface like the popups —
     see the --float-* tokens in app.css. */
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
    animation: spin calc(0.7s * var(--anim-speed, 1)) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* FindBar's own default position (top: 0.4rem) sits under the floating
     header (ChatHeader's `overlay` prop) here — push it below instead, same
     offset .syncing-badge already uses for the same reason. `!important`
     because FindBar's own scoped rule otherwise wins on specificity (its
     class selector carries a Svelte scoping attribute ours doesn't). */
  :global(.chat-find-bar) {
    top: calc(var(--header-height) + 10px) !important;
  }
  /* Find-in-chat's "jumped here" cue (ChatPanel's scrollToChatMatch) — the
     element itself lives inside MessageList's DOM, not this component's own
     template, hence :global. */
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

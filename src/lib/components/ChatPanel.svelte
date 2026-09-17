<script lang="ts">
  import { app } from "../state.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import MessageList from "./MessageList.svelte";
  import PromptInput from "./PromptInput.svelte";
  import { wallpaperGL } from "../wallpaperGL";

  let { sessionId }: { sessionId: string } = $props();

  const isEmpty = $derived(
    (app.messagesBySession[sessionId] ?? []).length === 0,
  );
  const isSyncing = $derived(app.syncingSessions[sessionId] ?? false);
</script>

<div class="chat-area">
  <section class="panel" class:sidebar-collapsed={app.sidebarCollapsed}>
    {#if app.settings.wallpaper}
      <canvas
        class="wallpaper"
        class:visible={isEmpty}
        use:wallpaperGL={{ src: app.settings.wallpaper, style: app.settings.wallpaperStyle }}
      ></canvas>
    {/if}
    <!-- The right island (+page.svelte) only lands on this header when there's
         no right sidebar open to its right to catch it instead; the sidebar
         toggle only lands here once the sidebar is collapsed away. -->
    <ChatHeader
      {sessionId}
      reserveToggle={app.sidebarCollapsed}
      reserveChrome={app.rightSidebarCollapsed}
      overlay
    />
    <div class="body" class:syncing={isSyncing} inert={isSyncing}>
      <MessageList {sessionId} paddingTop="calc(var(--header-height) + 20px)" />
      <PromptInput {sessionId} floating={isEmpty} />
    </div>
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
  .body {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
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
    -webkit-backdrop-filter: var(--float-blur);
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
</style>

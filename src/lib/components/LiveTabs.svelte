<script lang="ts">
  import { Tabs, DropdownMenu } from "bits-ui";
  import { fade } from "svelte/transition";
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import { openChatSession } from "../ipc";
  import { sessionTitle } from "../format";
  import { STATUS_ICON, type LiveTab } from "../liveChats";
  import Icon from "./Icon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";
  import ChatCard from "./ChatCard.svelte";

  let { tabs }: { tabs: LiveTab[] } = $props();

  // One island per chat, the whole card being the tab: a status icon and a clipped title, with the
  // detail in the hover card.
  // As many as fit in half the header (the tabs island's max width, see .live), at most MAX; the
  // rest go behind a "+N" menu. Needs-you chats sort first, so they're the last to be hidden.
  const MAX = 5;
  const SLOT_REM = 7.5;
  const GAP_REM = 0.21;
  const LABEL = { action: "Needs you", working: "Running", finished: "Finished" } as const;

  const multiServer = $derived(Object.keys(app.servers).length > 1);

  let root = $state<HTMLElement | null>(null);
  let avail = $state(0);
  $effect(() => {
    const header = root?.parentElement;
    if (!header) return;
    const measure = () => {
      const cs = getComputedStyle(header);
      avail = (header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 2;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  });
  // The "+N" chip is narrower than a slot, so it's budgeted on its own rather than as one.
  const MENU_REM = 2.6;
  const fits = (px: number) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
    return Math.max(0, Math.min(MAX, Math.floor((px + GAP_REM * rem) / ((SLOT_REM + GAP_REM) * rem))));
  };
  const shown = $derived.by(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
    if (tabs.length <= fits(avail)) return tabs;
    return tabs.slice(0, fits(avail - (MENU_REM + GAP_REM) * rem));
  });
  const hidden = $derived(tabs.slice(shown.length));

  // Nothing is ever the selected tab: picking one opens that chat, which drops it from the list.
  let value = $state("");
  function open(key: string) {
    value = "";
    const t = tabs.find((t) => t.key === key);
    if (t) openChatSession(t.cid, t.sessionId);
  }
</script>

<div bind:this={root} class="live" transition:fade={{ duration: Math.round(150 * app.settings.animationSpeed) }}>
  <Tabs.Root bind:value activationMode="manual" onValueChange={open} class="live-row">
    <Tabs.List class="live-row" aria-label="Chats that need attention">
      {#each shown as t (t.key)}
        {#snippet card()}<ChatCard connectionId={t.cid} session={t.session} />{/snippet}
        <Tabs.Trigger value={t.key} class="chrome-surface live-tab {t.status}" {@attach tip(card, { side: "bottom" })}>
          <span class="status"><Icon name={STATUS_ICON[t.status]} size={13} /></span>
          <span class="name">{sessionTitle(t.session)}</span>
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    {#if hidden.length}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="chrome-surface live-tab more{hidden.some((t) => t.status === 'action') ? ' action' : ''}"
          aria-label="{hidden.length} more chats"
          {@attach tip(`${hidden.length} more`, { side: "bottom" })}
        >
          <span class="name">+{hidden.length}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="context-menu live-menu" align="center" sideOffset={6}>
            {#each hidden as t (t.key)}
              {@const srv = app.servers[t.cid]}
              <DropdownMenu.Item class="context-menu-item live-item {t.status}" onSelect={() => open(t.key)}>
                <span class="status"><Icon name={STATUS_ICON[t.status]} size={13} /></span>
                <span class="grow">{sessionTitle(t.session)}</span>
                {#if multiServer && srv}<ServerAvatar name={srv.label} seed={srv.serverId} size={12} />{/if}
                <span class="label">{LABEL[t.status]}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {/if}
  </Tabs.Root>
</div>

<style>
  .live {
    flex: 0 1 auto;
    /* Up to half the header, right after the title island, which clips first. */
    max-width: 50%;
    min-width: 0;
    display: flex;
  }
  .live :global(.live-row) {
    display: flex;
    align-items: center;
    gap: var(--chrome-gap);
    min-width: 0;
  }
  /* Same card as the chat island (.chrome-surface), the whole of it the button. */
  .live :global(.live-tab) {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    height: var(--chrome-h);
    max-width: 7.5rem;
    padding: 0 var(--space-1) 0 0.64rem;
    /* Centres the card on the header's content line, like the chat island. */
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
    transition:
      background-color calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease,
      transform calc(0.08s * var(--anim-speed, 1)) ease;
  }
  .live :global(.live-tab:hover) {
    background: color-mix(in srgb, var(--text) 10%, var(--float-bg));
    color: var(--text);
  }
  .live :global(.live-tab:active) {
    transform: scale(0.96);
  }
  .live :global(.live-tab:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* A chat that's waiting on you gets a warm edge, the cue the sidebar's card used to give. */
  .live :global(.live-tab.action) {
    border-color: color-mix(in srgb, var(--warning) 45%, transparent);
    color: var(--text);
  }
  .live :global(.live-tab .name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live :global(.live-tab .status),
  :global(.live-item .status) {
    display: inline-flex;
    flex-shrink: 0;
  }
  .live :global(.live-tab.action .status),
  :global(.live-item.action .status) {
    color: var(--warning);
  }
  .live :global(.live-tab.working .status),
  :global(.live-item.working .status) {
    color: var(--info);
  }
  .live :global(.live-tab.working .status svg),
  :global(.live-item.working .status svg) {
    animation: spin-global calc(1s * var(--icon-slow, 1)) linear infinite;
  }
  .live :global(.live-tab.finished .status),
  :global(.live-item.finished .status) {
    color: var(--success);
  }
  :global(.live-menu) {
    min-width: 14rem;
    max-width: 22rem;
  }
  :global(.live-item .label) {
    font-size: 0.68rem;
    color: var(--text-dim);
  }
</style>

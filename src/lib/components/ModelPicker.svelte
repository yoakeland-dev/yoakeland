<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { app, modelKey } from "../state.svelte";
  import { setProvider, ensureModels, setFavoriteModels } from "../ipc";
  import { viewport } from "../viewport.svelte";
  import {
    type Entry,
    type Vendor,
    VENDOR_META,
    VENDOR_ORDER,
    directVendorOf,
    isOpenRouter,
    isCli,
    cliMeta,
    titleFor,
    providerLabel,
    vendorMetaFor,
  } from "../modelVendor";
  import SlideText from "./SlideText.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  type TabKey =
    | "favorites"
    | "openrouter"
    | `cli:${string}`
    | `vendor:${Vendor}`;

  let open = $state(false);
  let handledPickerRequest = 0;
  $effect(() => {
    const req = app.modelPickerRequest;
    if (req && req.at !== handledPickerRequest && req.sessionId === sessionId) {
      handledPickerRequest = req.at;
      // After the palette's own close settles, else its focus-return
      // would immediately dismiss this popover again.
      setTimeout(() => (open = true), 0);
    }
  });
  let activeTab = $state<TabKey>("favorites");
  let search = $state("");
  let searchInput: HTMLInputElement | undefined = $state();

  const currentProvider = $derived(
    server?.providers.find((p) => p.name === server?.providerBySession[sessionId]),
  );
  const currentModel = $derived(server?.modelBySession[sessionId]);

  const allEntries = $derived.by(() => {
    const entries: Entry[] = [];
    for (const provider of server?.providers ?? []) {
      for (const model of server?.modelsByProvider[provider.name] ?? []) {
        entries.push({ provider, model });
      }
    }
    return entries;
  });

  const currentEntry = $derived(
    currentProvider && currentModel
      ? allEntries.find(
          (e) =>
            e.provider.name === currentProvider.name &&
            e.model.id === currentModel,
        )
      : undefined,
  );

  // Which way the trigger label rolls: down when the model sits earlier in the picker's list than
  // the last one did, up otherwise (the mode and effort pickers do the same along their scales).
  let dir = $state(1);
  let lastAt = -1;
  $effect.pre(() => {
    const at = currentEntry ? allEntries.indexOf(currentEntry) : -1;
    if (at < 0) return;
    dir = at >= lastAt ? 1 : -1;
    lastAt = at;
  });

  // A CLI agent gets a tab even before its models arrive: an ACP agent's
  // list_models opens a throwaway session and takes seconds.
  const cliProvidersPresent = $derived((server?.providers ?? []).filter(isCli));
  const vendorsPresent = $derived(
    VENDOR_ORDER.filter((v) =>
      allEntries.some(
        (e) =>
          !isCli(e.provider) &&
          !isOpenRouter(e.provider) &&
          directVendorOf(e.provider, e.model.id) === v,
      ),
    ),
  );
  const openrouterPresent = $derived(
    allEntries.some((e) => isOpenRouter(e.provider)),
  );

  function firstAvailableTab(): TabKey {
    if (currentProvider && isCli(currentProvider)) return `cli:${currentProvider.name}`;
    if (cliProvidersPresent.length) return `cli:${cliProvidersPresent[0].name}`;
    if (vendorsPresent.length) return `vendor:${vendorsPresent[0]}`;
    if (openrouterPresent) return "openrouter";
    return "favorites";
  }

  const tabModels = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let list: Entry[];
    if (q) {
      list = allEntries.filter((e) => {
        const vendor = vendorMetaFor(e).label;
        return `${titleFor(e)} ${e.provider.name} ${vendor}`
          .toLowerCase()
          .includes(q);
      });
    } else if (activeTab === "favorites") {
      list = allEntries.filter((e) => e.model.isFavorite);
    } else if (activeTab === "openrouter") {
      list = allEntries.filter((e) => isOpenRouter(e.provider));
    } else if (activeTab.startsWith("cli:")) {
      const name = activeTab.slice(4);
      list = allEntries.filter((e) => e.provider.name === name);
    } else {
      const vendor = activeTab.slice(7) as Vendor;
      list = allEntries.filter(
        (e) =>
          !isCli(e.provider) &&
          !isOpenRouter(e.provider) &&
          directVendorOf(e.provider, e.model.id) === vendor,
      );
    }
    // SPEC.md §3.2 isLegacy: sort below current models rather than
    // disappearing, so a session pinned to one can still re-select it.
    // A CLI's own "default" model is the "Agent default" row above the list.
    return list
      .filter((e) => !(isCli(e.provider) && e.model.id === "default"))
      .sort((a, b) => Number(!!a.model.isLegacy) - Number(!!b.model.isLegacy));
  });

  // New sessions start unbound; pick up whatever was last confirmed active
  // anywhere, once, rather than landing on the "Provider…" placeholder.
  $effect(() => {
    if (
      cid &&
      server &&
      !server.providerBySession[sessionId] &&
      !server.providerBlockedBySession[sessionId] &&
      server.lastUsedProvider &&
      server.providers.some((p) => p.name === server!.lastUsedProvider)
    ) {
      setProvider(
        cid,
        sessionId,
        server.lastUsedProvider,
        server.lastUsedModel ?? undefined,
      );
    }
  });

  // Fetches each provider's model list once, lazily; refetch by reopening.
  $effect(() => {
    if (!cid || !server) return;
    for (const p of server.providers) {
      if (!server.modelsByProvider[p.name]) ensureModels(cid, p.name);
    }
  });

  function tabForEntry(entry: Entry): TabKey {
    if (isCli(entry.provider)) return `cli:${entry.provider.name}`;
    if (isOpenRouter(entry.provider)) return "openrouter";
    return `vendor:${directVendorOf(entry.provider, entry.model.id)}`;
  }

  function entryDomId(entry: Entry): string {
    return `model-entry-${modelKey(entry.provider.name, entry.model.id)}`;
  }

  // Runs "just opened" side effects (reset tab/search, focus + scroll to
  // current entry) whenever `open` flips false to true.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      activeTab = currentEntry
        ? tabForEntry(currentEntry)
        : firstAvailableTab();
      search = "";
      requestAnimationFrame(() => {
        // On a phone focusing opens the keyboard over the list you came to look at.
        if (!viewport.narrow) searchInput?.focus();
        if (currentEntry) {
          document
            .getElementById(entryDomId(currentEntry))
            ?.scrollIntoView({ block: "center" });
        }
      });
    }
    wasOpen = open;
  });

  function pick(entry: Entry) {
    if (cid) setProvider(cid, sessionId, entry.provider.name, entry.model.id);
    open = false;
  }

  // A CLI agent with no model uses its own default (§6b set_provider).
  function pickAgentDefault(providerName: string) {
    if (cid) setProvider(cid, sessionId, providerName);
    open = false;
  }
  const activeCliName = $derived(activeTab.startsWith("cli:") && !search.trim() ? activeTab.slice(4) : null);

  /** Arrow-key roving focus across `.entry` rows, matching the keyboard
   * support PromptInput's own @mention listbox already has. */
  function handleListKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const container = e.currentTarget as HTMLElement;
    const items = Array.from(container.querySelectorAll<HTMLElement>(".entry"));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? delta === 1
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function manageProviders() {
    open = false;
    app.openProviderSettings();
  }

  /** Favorites are server-persisted per provider (§3.1 `set_favorite_models`)
   * so they follow the user across clients/devices. This sends the whole
   * replacement set, optimistically flipping the local copy first so the
   * star responds instantly. */
  function toggleFavorite(entry: Entry) {
    if (!cid || !server) return;
    const models = server.modelsByProvider[entry.provider.name] ?? [];
    const nowFavorite = !entry.model.isFavorite;
    server.setModelFavorite(entry.provider.name, entry.model.id, nowFavorite);
    const favoriteIds = models
      .map((m) =>
        m.id === entry.model.id ? { ...m, isFavorite: nowFavorite } : m,
      )
      .filter((m) => m.isFavorite)
      .map((m) => m.id);
    setFavoriteModels(cid, entry.provider.name, favoriteIds);
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={`picker-trigger${open ? " open" : ""}`}
    {@attach tip("Model / provider", "chat.model")}
  >
    <span class="trigger-icon">
      <span class="crossfade a">
        {#if currentEntry}
          <LobeIcon
            name={vendorMetaFor(currentEntry).icon}
            fallback="openrouter"
            size={13}
          />
        {:else if currentProvider && isCli(currentProvider)}
          <LobeIcon name={cliMeta(currentProvider).icon} fallback="openrouter" size={13} />
        {:else}
          <Icon name="server" size={13} />
        {/if}
      </span>
      <span class="crossfade b"><Icon name="chevron-down" size={13} /></span>
    </span>
    <span class="trigger-label"
      ><SlideText
        text={currentEntry
          ? titleFor(currentEntry)
          : currentProvider
            ? currentModel || (isCli(currentProvider) ? `${cliMeta(currentProvider).title} · default` : currentProvider.name)
            : "Provider…"}
        {dir}
      /></span
    >
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      class="picker-panel"
      side="bottom"
      align="start"
      sideOffset={8}
      collisionPadding={8}
    >
      {#if (server?.providers.length ?? 0) === 0}
        <div class="empty">
          <p>No providers configured yet.</p>
          <button type="button" class="add-provider" onclick={manageProviders}>
            <Icon name="plus" size={13} /> Add a provider
          </button>
        </div>
      {:else if allEntries.length === 0 && cliProvidersPresent.length === 0}
        <div class="empty">
          <p>Loading models…</p>
        </div>
      {:else}
        <div class="picker-body">
          <!-- Hidden while searching: search spans every provider. -->
          {#if !search.trim()}
          <div class="tabs">
            <button
              type="button"
              class="tab"
              class:active={activeTab === "favorites"}
              {@attach tip("Favorites")}
              onclick={() => (activeTab = "favorites")}
            >
              <Icon name="star" size={15} />
            </button>

            {#if cliProvidersPresent.length > 0}
              {#each cliProvidersPresent as p (p.name)}
                {@const meta = cliMeta(p)}
                <button
                  type="button"
                  class="tab"
                  class:active={activeTab === `cli:${p.name}`}
                  {@attach tip(`${meta.title} (${p.name})`)}
                  onclick={() => (activeTab = `cli:${p.name}`)}
                >
                  <LobeIcon name={meta.icon} fallback="openrouter" size={16} />
                </button>
              {/each}
              <div class="tab-divider"></div>
            {/if}

            {#each vendorsPresent as v (v)}
              <button
                type="button"
                class="tab"
                class:active={activeTab === `vendor:${v}`}
                {@attach tip(VENDOR_META[v].label)}
                onclick={() => (activeTab = `vendor:${v}`)}
              >
                <LobeIcon
                  name={VENDOR_META[v].icon}
                  fallback="openrouter"
                  size={16}
                />
              </button>
            {/each}

            {#if openrouterPresent}
              <button
                type="button"
                class="tab"
                class:active={activeTab === "openrouter"}
                {@attach tip("OpenRouter")}
                onclick={() => (activeTab = "openrouter")}
              >
                <LobeIcon name="openrouter" size={16} />
              </button>
            {/if}

            <button
              type="button"
              class="tab settings"
              {@attach tip("Manage providers")}
              onclick={manageProviders}
            >
              <Icon name="settings" size={15} />
            </button>
          </div>
          {/if}

          <div class="models">
            <div class="search">
              <Icon name="search" size={13} />
              <input
                bind:this={searchInput}
                bind:value={search}
                type="text"
                placeholder="Search models…"
                aria-label="Search models"
              />
              {#if search}
                <button
                  type="button"
                  class="search-clear"
                  onclick={() => (search = "")}
                  {@attach tip("Clear search")}
                  aria-label="Clear search"
                >
                  <Icon name="xmark" size={11} />
                </button>
              {/if}
            </div>

            <div
              class="model-list"
              role="listbox"
              aria-label="Models"
              tabindex="-1"
              onkeydown={handleListKeydown}
            >
              {#if activeCliName}
                {@const selected = currentProvider?.name === activeCliName && !currentModel}
                <div
                  class="entry"
                  class:selected
                  role="option"
                  aria-selected={selected}
                  tabindex="0"
                  onclick={() => pickAgentDefault(activeCliName)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pickAgentDefault(activeCliName);
                    }
                  }}
                >
                  <div class="entry-main">
                    <span class="entry-name">Agent default</span>
                    <span class="entry-vendor">Whatever model the agent is configured to use</span>
                  </div>
                </div>
                {#if !server?.modelsByProvider[activeCliName]}
                  <p class="hint loading"><span class="spin"><Icon name="loader-2" size={12} /></span> Asking the agent for its models…</p>
                {/if}
              {/if}
              {#if tabModels.length === 0}
                {#if !activeCliName}
                <p class="hint">
                  {search.trim()
                    ? "No models match."
                    : activeTab === "favorites"
                      ? "Star a model to pin it here."
                      : "No models registered for this provider."}
                </p>
                {/if}
              {:else}
                {#each tabModels as entry, i (modelKey(entry.provider.name, entry.model.id))}
                  {@const vendor = vendorMetaFor(entry)}
                  {@const favorite = !!entry.model.isFavorite}
                  {@const selected =
                    entry.provider.name === currentProvider?.name &&
                    entry.model.id === currentModel}
                  {#if entry.model.isLegacy && !tabModels[i - 1]?.model.isLegacy}
                    <div class="legacy-divider"></div>
                  {/if}
                  <div
                    id={entryDomId(entry)}
                    class="entry"
                    class:selected
                    role="option"
                    aria-selected={selected}
                    tabindex="0"
                    onclick={() => pick(entry)}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pick(entry);
                      }
                    }}
                  >
                    <div class="entry-main">
                      <span class="entry-name">{titleFor(entry)}</span>
                      <span class="entry-vendor">
                        <LobeIcon
                          name={vendor.icon}
                          fallback="openrouter"
                          size={12}
                        />
                        {vendor.label} · {providerLabel(entry.provider)}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="star-btn"
                      class:active={favorite}
                      {@attach tip(favorite
                        ? "Remove from favorites"
                        : "Add to favorites")}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(entry);
                      }}
                    >
                      <Icon
                        name={favorite ? "star-filled" : "star"}
                        size={14}
                      />
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.picker-panel) {
    width: 22rem;
    max-width: calc(100vw - 2rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    /* Outer = inner control radius + padding (0.57rem) + border. */
    border-radius: calc(var(--radius-sm) + 0.57rem + 1px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    padding: 0.57rem;
    z-index: var(--z-popover);
    animation: floatIn var(--float-enter-duration) ease-out;
  }
  :global(.picker-panel[data-state="closed"]) {
    animation: floatOut var(--float-exit-duration) ease-in;
  }
  .picker-body {
    display: flex;
    gap: 0.57rem;
    height: 18rem;
  }
  .tabs {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: 0.29rem;
    width: 2.86rem;
    padding-right: 0.57rem;
    border-right: 1px solid var(--panel-border);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .tab {
    width: 2.14rem;
    height: 2.14rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .tab:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .tab.active {
    background: var(--accent-dim);
    color: var(--accent);
  }
  .tab.settings {
    margin-top: auto;
    color: var(--text-dim);
  }
  .tab-divider {
    width: 1.71rem;
    height: 1px;
    flex-shrink: 0;
    background: var(--panel-border);
    margin: 0.14rem 0;
  }
  .models {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
  }
  .search {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.43rem;
    padding: 0 var(--space-1);
    height: var(--ctrl-h, 2rem);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg-dim);
  }
  .search:focus-within {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-label-size);
    font-family: inherit;
  }
  .search-clear {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.29rem;
    height: 1.29rem;
    background: none;
    border: none;
    color: var(--sidebar-fg-dim);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .search-clear:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .model-list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
    padding: 0.29rem 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .hint {
    margin: 0.86rem 0.43rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  .hint.loading {
    display: flex;
    align-items: center;
    gap: 0.43rem;
  }
  .legacy-divider {
    height: 1px;
    flex-shrink: 0;
    background: var(--panel-border);
    margin: 0.14rem 0;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    padding: 0.5rem 0.57rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .entry:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .entry.selected {
    background: var(--sidebar-active);
  }
  .entry-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .entry-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry-vendor {
    display: flex;
    align-items: center;
    gap: 0.29rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .star-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.29rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .star-btn:hover {
    color: var(--text);
  }
  .star-btn.active {
    color: var(--warning);
  }
  .empty {
    padding: 0.86rem;
    text-align: center;
  }
  .empty p {
    margin: 0 0 0.71rem;
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .add-provider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.36rem;
    width: 100%;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .add-provider:hover {
    color: var(--text);
  }

  @media (max-width: 700px) {
    .picker-body {
      height: min(26rem, 58dvh);
    }
    .tabs {
      width: 3.4rem;
    }
    .tab {
      width: 2.6rem;
      height: 2.6rem;
    }
  }
</style>

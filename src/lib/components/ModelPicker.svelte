<script lang="ts">
  import { Popover } from "bits-ui";
  import { app, modelKey } from "../state.svelte";
  import { setProvider, listModels, setFavoriteModels } from "../ipc";
  import {
    type Entry,
    type Vendor,
    VENDOR_META,
    VENDOR_ORDER,
    directVendorOf,
    isOpenRouter,
    isCli,
    titleFor,
    vendorMetaFor,
  } from "../modelVendor";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  // Model/provider state lives on the active connection's own ServerState
  // now — see the multi-server-connections plan. `cid` is needed by every
  // ipc.ts call now that they're threaded per connection.
  let server = $derived(app.active);
  let cid = $derived(app.activeConnectionId);

  // Model options (§3.1 set_model_options) — mirror whichever upstream's own
  // capability shape close to verbatim (SPEC.md §3.2 model_list), so there's
  // no common schema to branch on. reasoningEffort/thinkingBudget are both
  // unconditionally ignored by cli_claude/cli_codex server-side ("the CLI
  // subprocess owns its own request shape") even though a cli_claude model
  // can still *advertise* reasoningEfforts/fastMode capabilities (cross-
  // walked from T3 Code's manifest, §6b) — that's informational metadata
  // about what the underlying CLI/model can in principle do, not a signal
  // that set_model_options can currently act on for that provider kind. So
  // reasoningEffort/thinkingBudget stay gated to api_key providers only,
  // regardless of what capabilities a cli_* entry reports; contextWindow is
  // local bookkeeping and always applies, to any provider.
  // Left-rail tab identity, encoded as a plain string so it's trivial to
  // compare/store in $state: "favorites", "openrouter", "cli:<providerName>",
  // or "vendor:<Vendor>".
  type TabKey =
    | "favorites"
    | "openrouter"
    | `cli:${string}`
    | `vendor:${Vendor}`;

  let open = $state(false);
  let activeTab = $state<TabKey>("favorites");
  let search = $state("");
  let searchInput: HTMLInputElement | undefined = $state();

  const currentProvider = $derived(
    server?.providers.find((p) => p.name === server?.providerBySession[sessionId]),
  );
  const currentModel = $derived(server?.modelBySession[sessionId]);

  // Every (provider, model) pair we currently know about — models arrive
  // lazily per provider via list_models (see the $effect below), so a
  // provider with nothing cached yet just contributes no rows.
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

  const cliProvidersPresent = $derived(
    (server?.providers ?? []).filter(
      (p) => isCli(p) && allEntries.some((e) => e.provider.name === p.name),
    ),
  );
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
    // Legacy cli_claude models (SPEC.md §3.2 isLegacy) sort below current
    // ones rather than disappearing — a session already pinned to one must
    // still be able to re-select it (see the divider in the template).
    return list
      .slice()
      .sort((a, b) => Number(!!a.model.isLegacy) - Number(!!b.model.isLegacy));
  });

  // New sessions start with no provider bound at all (§ providerBySession) —
  // rather than always landing on the "Provider…" placeholder, pick up
  // whatever was last confirmed active anywhere, once, the first time this
  // session actually has that choice available.
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

  // Fetch each registered provider's model list once, lazily, rather than
  // hardcoding a model set — never assumed stale, refetch by reopening.
  $effect(() => {
    if (!cid || !server) return;
    for (const p of server.providers) {
      if (!server.modelsByProvider[p.name]) listModels(cid, p.name);
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

  // bind:open (below) is the two-way binding; this effect just runs the
  // "just opened" side effects (reset tab/search, focus + scroll to the
  // current entry) whenever `open` flips false → true, replacing what used
  // to be a manual onOpenChange callback that also reassigned `open` itself.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      activeTab = currentEntry
        ? tabForEntry(currentEntry)
        : firstAvailableTab();
      search = "";
      requestAnimationFrame(() => {
        searchInput?.focus();
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
   * so they follow the user across clients/devices — this sends the whole
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
    title="Model / provider"
  >
    <span class="trigger-icon">
      <span class="crossfade a">
        {#if currentEntry}
          <LobeIcon
            name={vendorMetaFor(currentEntry).icon}
            fallback="openrouter"
            size={13}
          />
        {:else}
          <Icon name="server" size={13} />
        {/if}
      </span>
      <span class="crossfade b"><Icon name="chevron-down" size={13} /></span>
    </span>
    <span class="trigger-label"
      >{currentEntry
        ? titleFor(currentEntry)
        : currentProvider
          ? currentModel || currentProvider.name
          : "Provider…"}</span
    >
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      class="picker-panel"
      side="top"
      align="start"
      sideOffset={8}
    >
      {#if (server?.providers.length ?? 0) === 0}
        <div class="empty">
          <p>No providers configured yet.</p>
          <button type="button" class="add-provider" onclick={manageProviders}>
            <Icon name="plus" size={13} /> Add a provider
          </button>
        </div>
      {:else if allEntries.length === 0}
        <div class="empty">
          <p>Loading models…</p>
        </div>
      {:else}
        <div class="picker-body">
          <div class="tabs">
            <button
              type="button"
              class="tab"
              class:active={activeTab === "favorites"}
              title="Favorites"
              onclick={() => (activeTab = "favorites")}
            >
              <Icon name="star" size={15} />
            </button>

            {#if cliProvidersPresent.length > 0}
              {#each cliProvidersPresent as p (p.name)}
                {@const icon = p.kind === "cli_claude" ? "claude" : "openai"}
                <button
                  type="button"
                  class="tab"
                  class:active={activeTab === `cli:${p.name}`}
                  title={p.kind === "cli_claude"
                    ? "Claude subscription"
                    : "Codex subscription"}
                  onclick={() => (activeTab = `cli:${p.name}`)}
                >
                  <LobeIcon name={icon} fallback="openrouter" size={16} />
                </button>
              {/each}
              <div class="tab-divider"></div>
            {/if}

            {#each vendorsPresent as v (v)}
              <button
                type="button"
                class="tab"
                class:active={activeTab === `vendor:${v}`}
                title={VENDOR_META[v].label}
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
                title="OpenRouter"
                onclick={() => (activeTab = "openrouter")}
              >
                <LobeIcon name="openrouter" size={16} />
              </button>
            {/if}

            <button
              type="button"
              class="tab settings"
              title="Manage providers"
              onclick={manageProviders}
            >
              <Icon name="settings" size={15} />
            </button>
          </div>

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
                  title="Clear search"
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
              {#if tabModels.length === 0}
                <p class="hint">
                  {search.trim()
                    ? "No models match."
                    : activeTab === "favorites"
                      ? "Star a model to pin it here."
                      : "No models registered for this provider."}
                </p>
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
                        {vendor.label} · {entry.provider.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="star-btn"
                      class:active={favorite}
                      title={favorite
                        ? "Remove from favorites"
                        : "Add to favorites"}
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
  :global(.picker-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    /* Transparent at rest like the rest of the composer's toolbar controls —
       the fill only appears on hover/open (below). The border stays a real
       1px box rather than being dropped, so hovering can't shift the label. */
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    border-radius: var(--radius-pill);
    padding: 0.36rem 0.71rem;
    font-size: 0.75rem;
    cursor: pointer;
    max-width: 12.86rem;
    transition:
      background calc(0.12s * var(--anim-speed, 1)) ease,
      color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  :global(.picker-trigger:hover),
  :global(.picker-trigger.open) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .trigger-icon {
    position: relative;
    width: 0.93rem;
    height: 0.93rem;
    flex-shrink: 0;
  }
  .crossfade {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .crossfade.b {
    opacity: 0;
  }
  :global(.picker-trigger:hover) .crossfade.a,
  :global(.picker-trigger.open) .crossfade.a {
    opacity: 0;
  }
  :global(.picker-trigger:hover) .crossfade.b,
  :global(.picker-trigger.open) .crossfade.b {
    opacity: 1;
  }
  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.picker-panel) {
    width: 22rem;
    max-width: calc(100vw - 2rem);
    /* A floating surface — see the --float-* tokens in app.css: the plain panel
       fill by default, translucent over a backdrop blur when Settings >
       Appearance > Surfaces is set to Frosted. */
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    -webkit-backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    border-radius: var(--radius-lg);
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
    border-radius: var(--radius-md);
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
    border-radius: var(--radius-sm);
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
  }
  .hint {
    margin: 0.86rem 0.43rem;
    font-size: 0.78rem;
    color: var(--text-dim);
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
    border-radius: var(--radius-md);
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
</style>

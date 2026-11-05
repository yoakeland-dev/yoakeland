<script lang="ts">
  import PopoverContent from "./PopoverContent.svelte";
  import { tip } from "../tooltip.svelte";
  import { Popover } from "bits-ui";
  import { app, modelKey } from "../state.svelte";
  import { setProvider, setModelOptions, ensureModels, refreshModels, setFavoriteModels } from "../ipc";
  import { effortLevels } from "./EffortPicker.svelte";
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
    agentGroups,
    type AgentGroup,
    titleFor,
    providerLabel,
    vendorMetaFor,
  } from "../modelVendor";
  import type { ProviderInfo } from "../types";
  import SlideText from "./SlideText.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let { sessionId }: { sessionId: string } = $props();

  let server = $derived(app.active);
  // A CLI agent this person isn't allowed to use isn't offered; the server would refuse it.
  const usable = $derived((server?.providers ?? []).filter((p) => server?.canUseProvider(p)));
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
    for (const provider of usable) {
      const hidden = app.settings.hiddenModels?.[provider.name] ?? [];
      for (const model of server?.modelsByProvider[provider.name] ?? []) {
        // A hidden model stays listed while it is the chat's own, so the picker never shows a blank.
        if (hidden.includes(model.id) && !(provider.name === currentProvider?.name && model.id === currentModel)) continue;
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
  const groups = $derived(agentGroups(usable));
  const groupOf = (name: string) => groups.find((g) => g.accounts.some((a) => a.name === name));

  // Chosen account per multi-account agent (group key -> provider name); falls back to the
  // chat's own account, then the last one used, then the first.
  let acctPick = $state<Record<string, string>>({});
  function selAcct(g: AgentGroup) {
    const has = (n?: string | null) => g.accounts.find((a) => a.name === n);
    return has(acctPick[g.key]) ?? has(currentProvider?.name) ?? has(server?.lastUsedProvider) ?? g.accounts[0];
  }
  const pctOf = (name: string) => {
    const w = server?.serverStatus?.rateLimits?.[name]?.fiveHour;
    return w ? Math.round(w.usedPct) : null;
  };
  const chipText = (a: ProviderInfo) => {
    const pct = pctOf(a.name);
    return pct === null ? providerLabel(a) : `${providerLabel(a)} · ${pct}%`;
  };
  const diffDirs = (g: AgentGroup) => new Set(g.accounts.map((a) => a.configDir ?? "")).size > 1;
  let acctOpen = $state(false);
  function pickAccount(g: AgentGroup, name: string) {
    acctPick[g.key] = name;
    acctOpen = false;
  }
  const activeGroup = $derived(
    activeTab.startsWith("cli:") ? groups.find((g) => g.key === activeTab.slice(4)) : undefined,
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
    const cg = currentProvider && groupOf(currentProvider.name);
    if (cg) return `cli:${cg.key}`;
    if (groups.length) return `cli:${groups[0].key}`;
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
      const name = activeGroup ? selAcct(activeGroup).name : "";
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
    // A CLI's own "default" model is the agent picking for itself; not offered.
    return list
      .filter((e) => !(isCli(e.provider) && e.model.id === "default"))
      .sort((a, b) => Number(!!a.model.isLegacy) - Number(!!b.model.isLegacy));
  });

  // New sessions start unbound; pick up whatever was last confirmed active
  // anywhere, once, rather than landing on the "Provider…" placeholder. Its effort and speed
  // come too where the model has that level: a new chat starts as the last one was left.
  // A blank chat carried here from another server asks for it again (reseedBySession).
  $effect(() => {
    if (!cid || !server || server.providerBlockedBySession[sessionId]) return;
    const again = server.reseedBySession[sessionId];
    if (server.providerBySession[sessionId] && !again) return;
    const { lastUsedProvider: name, lastUsedModel: model, lastUsedEffort: effort, lastUsedFast: fast } = server;
    const provider = server.providers.find((p) => p.name === name);
    if (!name || !provider) return;
    const sig = [name, model, effort, fast].join("\n");
    if (server.seededBySession.get(sessionId) === sig) return;
    server.seededBySession.set(sessionId, sig);
    if (again) delete server.reseedBySession[sessionId];
    setProvider(cid, sessionId, name, model ?? undefined);
    const modelInfo = server.modelsByProvider[name]?.find((m) => m.id === model);
    const levels = effortLevels(provider, modelInfo, model ?? undefined);
    const level = effort && levels?.includes(effort) ? effort : undefined;
    if (level || fast) setModelOptions(cid, sessionId, { reasoningEffort: level, fastMode: fast || undefined });
  });

  // Fetches each provider's model list once, lazily; refetch by reopening.
  $effect(() => {
    if (!cid || !server) return;
    for (const p of server.providers) {
      if (!server.modelsByProvider[p.name]) ensureModels(cid, p.name);
    }
  });
  // Opening the picker retries a CLI agent whose list was missing or the fallback (it was signed out).
  $effect(() => {
    if (!open || !cid || !server) return;
    // Only the account on screen: each ACP refresh spawns a process.
    const name = activeGroup ? selAcct(activeGroup).name : currentProvider && isCli(currentProvider) ? currentProvider.name : "";
    if (name) refreshModels(cid, name);
  });

  function tabForEntry(entry: Entry): TabKey {
    const g = groupOf(entry.provider.name);
    if (g) return `cli:${g.key}`;
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
      acctOpen = false;
      if (currentProvider && groupOf(currentProvider.name)) acctPick[groupOf(currentProvider.name)!.key] = currentProvider.name;
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

  const activeCliName = $derived(activeGroup && !search.trim() ? selAcct(activeGroup).name : null);

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
    class={`model-trigger${open ? " open" : ""}`}
    {@attach tip("Model / provider", "chat.model")}
  >
    <span class="trigger-icon">
      <span class="crossfade a">
        {#if currentEntry}
          <LobeIcon name={vendorMetaFor(currentEntry).icon} fallback="openrouter" size={13} />
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
    <PopoverContent
      class="picker-panel"
      side="bottom"
      align="start"
      sideOffset={8}
      collisionPadding={8}
    >
      {#if (server?.providers.length ?? 0) === 0}
        <div class="empty">
          <p>No providers yet.</p>
          <button type="button" class="add-provider" onclick={manageProviders}>
            <Icon name="plus" size={13} /> Add a provider
          </button>
        </div>
      {:else if allEntries.length === 0 && groups.length === 0}
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
              {@attach tip("Favorites", { side: "left" })}
              onclick={() => (activeTab = "favorites")}
            >
              <Icon name="star" size={15} />
            </button>

            {#if groups.length > 0}
              {#each groups as g (g.key)}
                <button
                  type="button"
                  class="tab"
                  class:active={activeTab === `cli:${g.key}`}
                  {@attach tip(g.title, { side: "left" })}
                  onclick={() => ((activeTab = `cli:${g.key}`), (acctOpen = false))}
                >
                  <LobeIcon name={g.icon} fallback="openrouter" size={16} />
                </button>
              {/each}
              <div class="tab-divider"></div>
            {/if}

            {#each vendorsPresent as v (v)}
              <button
                type="button"
                class="tab"
                class:active={activeTab === `vendor:${v}`}
                {@attach tip(VENDOR_META[v].label, { side: "left" })}
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
                {@attach tip("OpenRouter", { side: "left" })}
                onclick={() => (activeTab = "openrouter")}
              >
                <LobeIcon name="openrouter" size={16} />
              </button>
            {/if}

            <button
              type="button"
              class="tab settings"
              {@attach tip("Manage providers", { side: "left" })}
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

            {#if activeGroup && activeGroup.accounts.length > 1 && !search.trim()}
              {@const g = activeGroup}
              {@const cur = selAcct(g)}
              {#if viewport.narrow}
                <div class="acct-strip" role="tablist" aria-label="{g.title} accounts">
                  {#each g.accounts as a (a.name)}
                    <button type="button" role="tab" class="acct-chip" class:active={a.name === cur.name} aria-selected={a.name === cur.name} onclick={() => pickAccount(g, a.name)}>
                      {chipText(a)}
                    </button>
                  {/each}
                </div>
                {#if diffDirs(g)}<p class="acct-note">Switching starts a fresh agent session from the transcript</p>{/if}
              {:else}
                <div class="agent-head">
                  <span class="agent-title"><LobeIcon name={g.icon} fallback="openrouter" size={13} /> {g.title}</span>
                  <button type="button" class="acct-chip" class:open={acctOpen} aria-haspopup="listbox" aria-expanded={acctOpen} onclick={() => (acctOpen = !acctOpen)}>
                    {chipText(cur)}
                    <Icon name="chevron-down" size={11} />
                  </button>
                  {#if acctOpen}
                    <div class="acct-pop" role="listbox" aria-label="{g.title} accounts">
                      {#each g.accounts as a (a.name)}
                        {@const pct = pctOf(a.name)}
                        <button type="button" role="option" class="acct-row" aria-selected={a.name === cur.name} onclick={() => pickAccount(g, a.name)}>
                          <span class="acct-check">{#if a.name === cur.name}<Icon name="check" size={12} />{/if}</span>
                          <span class="acct-name">{providerLabel(a)}</span>
                          {#if pct !== null}<span class="acct-pct">{pct}%</span>{/if}
                        </button>
                      {/each}
                      {#if diffDirs(g)}<p class="acct-note">Switching starts a fresh agent session from the transcript</p>{/if}
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}

            <div
              class="model-list"
              role="listbox"
              aria-label="Models"
              tabindex="-1"
              onkeydown={handleListKeydown}
            >
              {#if activeCliName && !server?.modelsByProvider[activeCliName]}
                <p class="hint loading"><span class="spin"><Icon name="loader-2" size={12} /></span> Asking the agent for its models…</p>
              {:else if tabModels.length === 0}
                <p class="hint">
                  {search.trim()
                    ? "No models match."
                    : activeTab === "favorites"
                      ? "Star a model to pin it here."
                      : "No models for this provider."}
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
    </PopoverContent>
  </Popover.Portal>
</Popover.Root>

<style>
  /* Inline text, no container: a touch brighter than the effort beside it, white on hover. */
  :global(.model-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    height: 1.86rem;
    max-width: 12.86rem;
    padding: 0 0.14rem 0 0.5rem;
    background: none;
    border: none;
    color: color-mix(in srgb, var(--text) 78%, transparent);
    font-size: var(--text-label-size);
    white-space: nowrap;
    cursor: pointer;
    transition: color calc(0.12s * var(--anim-speed, 1)) ease;
  }
  /* The provider icon gives way to a chevron on hover and while open. */
  :global(.model-trigger .trigger-icon) {
    position: relative;
    width: 0.93rem;
    height: 0.93rem;
    flex-shrink: 0;
  }
  :global(.model-trigger .crossfade) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  :global(.model-trigger .crossfade.b),
  :global(.model-trigger:hover .crossfade.a),
  :global(.model-trigger.open .crossfade.a) {
    opacity: 0;
  }
  :global(.model-trigger:hover .crossfade.b),
  :global(.model-trigger.open .crossfade.b) {
    opacity: 1;
  }
  :global(.model-trigger .trigger-label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.model-trigger:hover),
  :global(.model-trigger.open) {
    color: #fff;
  }
  :global(.picker-panel) {
    width: 22rem;
    max-width: calc(100vw - 2rem);
    background: var(--float-bg);
    backdrop-filter: var(--float-blur);
    border: 1px solid var(--float-border);
    border-block-color: var(--float-border-top) var(--float-border-bottom);
    /* Outer = inner control radius + padding (0.57rem) + border. */
    border-radius: calc(var(--radius-sm) + 0.57rem + 1px);
    box-shadow: var(--shadow-dialog);
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
    background: var(--wash-2);
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
  .agent-head {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.43rem;
    padding: 0 var(--space-1);
  }
  .agent-title {
    display: flex;
    align-items: center;
    gap: 0.36rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
  }
  .acct-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.29rem;
    flex-shrink: 0;
    max-width: 11rem;
    padding: 0.2rem 0.5rem;
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 0.72rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .acct-chip:hover,
  .acct-chip.open {
    color: var(--text);
  }
  .acct-chip.active {
    background: var(--accent-dim);
    border-color: transparent;
    color: var(--accent);
  }
  .acct-pop {
    position: absolute;
    top: calc(100% + 0.29rem);
    right: 0;
    z-index: 2;
    min-width: 11rem;
    padding: 0.29rem;
    background: var(--float-bg);
    border: 1px solid var(--float-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  }
  .acct-row {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    width: 100%;
    min-height: 2.14rem;
    padding: 0 0.43rem;
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--text);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .acct-row:hover {
    background: var(--wash-2);
  }
  .acct-check {
    width: 0.86rem;
    flex-shrink: 0;
    color: var(--accent);
  }
  .acct-name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acct-pct {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .acct-note {
    margin: 0.29rem 0.43rem 0.14rem;
    font-size: 0.68rem;
    color: var(--text-dim);
  }
  .acct-strip {
    flex-shrink: 0;
    display: flex;
    gap: 0.43rem;
    overflow-x: auto;
    scrollbar-width: none;
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
    background: var(--wash-1);
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
    scrollbar-width: thin;
    scrollbar-color: var(--panel-border) transparent;
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
    background: var(--wash-2);
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
    background: var(--wash-2);
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
    .acct-strip .acct-chip {
      min-height: 2.6rem;
      padding: 0 0.86rem;
      font-size: 0.8rem;
    }
    .acct-note {
      margin: 0 0.14rem;
    }
  }
</style>

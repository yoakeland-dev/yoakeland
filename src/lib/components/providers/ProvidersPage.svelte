<script lang="ts">
  // Settings > Providers: every coding-agent account and API key is one row on the left of a card, the
  // selected one opens on the right of it. Adding is the command palette's "Add provider" page.
  // Registering a name that exists replaces it, which is how an account is edited. Enabled means
  // registered, so a switched-off account is remembered here (this visit only) to be switched back on.
  import { untrack } from "svelte";
  import { askConfirm } from "../../confirm.svelte";
  import { detectCli, registerProvider, removeProvider } from "../../ipc";
  import { app } from "../../state.svelte";
  import { agentGroups, directVendorOf, isOpenRouter, MULTI_ACCOUNT, providerLabel, VENDOR_META, type AgentGroup } from "../../modelVendor";
  import { windows } from "../../rateLimits";
  import { tip } from "../../tooltip.svelte";
  import type { ServerState } from "../../state.svelte";
  import type { ProviderInfo } from "../../types";
  import AddAgentSheet from "../AddAgentSheet.svelte";
  import Button from "../ui/Button.svelte";
  import Icon from "../Icon.svelte";
  import LobeIcon from "../LobeIcon.svelte";
      import ProviderDetail from "./ProviderDetail.svelte";
  import SubPage from "../SubPage.svelte";
  import { useNav } from "../../settingsNav.svelte";
  import { viewport } from "../../viewport.svelte";

  let { cid, server, connected }: { cid: string | null; server: ServerState | null; connected: boolean } = $props();

  interface Item {
    p: ProviderInfo;
    title: string;
    /** What the row says: the logo already names the agent, so only what tells accounts apart. */
    short: string;
    icon: string;
    /** Coding agents only: the agent this account belongs to. */
    group?: AgentGroup;
  }

  let offAccts = $state<Record<string, ProviderInfo>>({});
  const live = $derived(server?.providers ?? []);
  const offList = $derived(Object.values(offAccts).filter((o) => !live.some((p) => p.name === o.name)));
  const all = $derived([...live, ...offList]);
  const groups = $derived(agentGroups(all));
  const taken = $derived(new Set([...live.map((p) => p.name), ...Object.keys(offAccts)]));
  const isOff = (p: ProviderInfo) => !live.some((l) => l.name === p.name);

  const keyIcon = (p: ProviderInfo) => (isOpenRouter(p) ? "openrouter" : VENDOR_META[directVendorOf(p)].icon);
  const agentItems = $derived(
    groups.flatMap((g) =>
      g.accounts.map((p): Item => ({
        p,
        group: g,
        icon: g.icon,
        title: g.accounts.length > 1 ? `${g.title} · ${providerLabel(p)}` : g.title,
        short: g.accounts.length > 1 ? providerLabel(p) : g.title,
      })),
    ),
  );
  const keyItems = $derived(
    all.filter((p) => p.kind === "api_key").map((p): Item => {
      const title = p.authMethod === "oauth" ? "OpenRouter" : p.name;
      return { p, icon: keyIcon(p), title, short: title };
    }),
  );
  const items = $derived([...agentItems, ...keyItems]);

  let sel = $state("");
  const active = $derived(items.some((i) => i.p.name === sel) ? sel : (items[0]?.p.name ?? ""));
  const current = $derived(items.find((i) => i.p.name === active));
  // Phone: the list and the page are two screens.
  let showDetail = $state(false);
  const nav = useNav();
  function pick(name: string) {
    sel = name;
    // Phone settings: the account opens as a page in the settings stack.
    if (viewport.narrow && nav) void nav.push("provider");
    else showDetail = true;
  }

  // An account added from the palette shows up a moment later: select it once it does.
  let known: Set<string> | null = null;
  $effect(() => {
    const names = items.map((i) => i.p.name);
    untrack(() => {
      const fresh = known ? names.find((n) => !known!.has(n)) : undefined;
      if (fresh) sel = fresh;
      known = new Set(names);
    });
  });

  const plan = (p: ProviderInfo) => server?.serverStatus?.rateLimits?.[p.name]?.plan;
  const peak = (p: ProviderInfo) => {
    const rl = server?.serverStatus?.rateLimits?.[p.name];
    return rl ? Math.max(0, ...windows(rl).map((w) => w.pct)) : 0;
  };

  function payload(p: ProviderInfo, patch: { label?: string; configDir?: string } = {}) {
    const d: Record<string, unknown> = { name: p.name, kind: p.kind, authMethod: "manual", label: patch.label ?? p.label };
    const dir = patch.configDir ?? p.configDir;
    if (MULTI_ACCOUNT.has(p.kind) && dir) d.configDir = dir;
    if (p.kind === "cli_acp") {
      d.command = p.command;
      d.args = p.args ?? [];
    }
    return d;
  }
  function setEnabled(p: ProviderInfo, on: boolean) {
    if (!cid) return;
    if (on) {
      registerProvider(cid, payload(p));
      delete offAccts[p.name];
    } else {
      offAccts[p.name] = p;
      removeProvider(cid, p.name);
    }
  }
  async function remove(p: ProviderInfo) {
    if (!cid) return;
    const what = p.kind === "api_key" ? (p.authMethod === "oauth" ? "Sign out of OpenRouter?" : `Remove the key "${p.name}"?`) : `Remove "${providerLabel(p)}"? Chats keep their history but lose this account.`;
    if (!(await askConfirm(what))) return;
    removeProvider(cid, p.name);
    delete offAccts[p.name];
  }
  function save(p: ProviderInfo, patch: { label: string; configDir: string }) {
    if (!cid) return;
    if (isOff(p)) offAccts[p.name] = { ...p, ...patch };
    else registerProvider(cid, payload(p, patch));
  }

  let addOpen = $state(false);
  let addInitial = $state<string | undefined>();
  function addAccount(kind?: string) {
    addInitial = kind;
    addOpen = true;
  }
  let refreshing = $state(false);
  function refresh() {
    if (!cid) return;
    refreshing = true;
    detectCli(cid);
    setTimeout(() => (refreshing = false), 1200);
  }

</script>

{#snippet row(i: Item)}
  {@const off = isOff(i.p)}
  {@const hot = !off && peak(i.p) >= 80}
  {@const isKey = i.p.kind === "api_key"}
  <button type="button" class="lr" class:on={active === i.p.name} class:off onclick={() => pick(i.p.name)} {@attach tip(isKey ? `${i.title} · API key` : `${i.title}${plan(i.p) ? ` · ${plan(i.p)}` : ""}${off ? " · off" : ""}`)}>
    <span class="ico"><LobeIcon name={i.icon} size={16} /></span>
    <span class="nm">{i.short}</span>
    {#if isKey}
      <span class="chip kc"><Icon name="key" size={12} /></span>
    {:else}
      {#if plan(i.p)}<span class="chip">{plan(i.p)}</span>{/if}
      <i class="dot" class:success={!off && !hot} class:warning={hot}></i>
    {/if}
  </button>
{/snippet}

<div class="prov" class:detail={showDetail}>
  <div class="tools">
    <Button size="sm" variant="ghost" disabled={!connected || refreshing} onclick={refresh}><Icon name="refresh" size={13} /> {refreshing ? "Checking…" : "Refresh"}</Button>
    <Button size="sm" disabled={!connected} onclick={() => app.openPalette("add-provider")}><Icon name="plus" size={13} /> Add provider</Button>
  </div>
  <div class="pcardx">
    <aside class="lst">
      {#if agentItems.length}
        <div class="gh">Coding agents</div>
        {#each agentItems as i (i.p.name)}{@render row(i)}{/each}
      {/if}
      {#if keyItems.length}
        <div class="gh">API keys</div>
        {#each keyItems as i (i.p.name)}{@render row(i)}{/each}
      {/if}
      {#if !items.length}<p class="none">Nothing added yet. Use Add provider.</p>{/if}
    </aside>

    <div class="det">
      <button type="button" class="back" onclick={() => (showDetail = false)}><Icon name="chevron-left" size={14} /> Providers</button>
      <SubPage id="provider" title={current?.title ?? "Provider"} link={false}>
      {#if current}
        {#key current.p.name}
          <ProviderDetail
            {cid}
            {server}
            {connected}
            p={current.p}
            title={current.title}
            icon={current.icon}
            group={current.group}
            off={isOff(current.p)}
            others={live}
            onToggle={(on) => setEnabled(current.p, on)}
            onRemove={() => remove(current.p)}
            onSave={(patch) => save(current.p, patch)}
            onAddAccount={addAccount}
          />
        {/key}
      {/if}
      </SubPage>
    </div>
  </div>
</div>

<AddAgentSheet bind:open={addOpen} {cid} {server} initial={addInitial} offNames={Object.keys(offAccts)} />

<style>
  .prov {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }
  .tools {
    display: flex;
    justify-content: flex-end;
    gap: 0.3rem;
  }
  .pcardx {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    height: 33rem;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    overflow: clip;
  }
  .lst {
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem;
    border-right: 1px solid var(--panel-border);
    scrollbar-width: thin;
  }
  .gh {
    padding: 0.7rem 0.5rem 0.25rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .gh:first-child {
    padding-top: 0.2rem;
  }
  /* The same row as a chat in the sidebar: inset, rounded, no dividers. */
  .lr {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.1rem;
    margin-bottom: 1px;
    padding: 0.3rem 0.5rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--sidebar-fg);
    font: inherit;
    font-size: 0.86rem;
    text-align: left;
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .lr:hover {
    background: var(--sidebar-hover);
  }
  .lr.on {
    background: var(--sidebar-active);
    color: var(--text);
  }
  .lr.off .ico,
  .lr.off .nm {
    opacity: 0.5;
  }
  .ico {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The plan is text and a key is an icon, the way the status bar's usage widget shows them. */
  .chip {
    flex-shrink: 0;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .chip.kc {
    display: inline-flex;
  }
  .dot {
    flex-shrink: 0;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.45;
  }
  .dot.success {
    background: var(--success);
    opacity: 1;
  }
  .dot.warning {
    background: var(--warning);
    opacity: 1;
  }
  .none {
    margin: 0;
    padding: 0.9rem 0.6rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .det {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding-bottom: 1.4rem;
  }
  .back {
    display: none;
  }

  /* The detail's sections sit flat inside the card: a heading, then rows between hairlines. */
  .det :global(.stack) {
    display: flex;
    flex-direction: column;
  }
  .det :global(.dhd) {
    padding: 1.1rem 1.14rem 0.5rem;
  }
  .det :global(.sec) {
    display: flex;
    flex-direction: column;
  }
  .det :global(.pcard + .sec > h4) {
    padding-top: 0;
  }
  .det :global(.dhd + .sec > h4) {
    padding-top: 0.5rem;
  }
  .det :global(.sec > h4) {
    margin: 0;
    padding: 1rem 1.14rem 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .det :global(.pcard) {
    display: flex;
    flex-direction: column;
  }
  .det :global(.pcard > *) {
    border-top: 1px solid var(--panel-border);
  }
  .det :global(.prow) {
    display: flex;
    align-items: center;
    gap: 1.14rem;
    padding: 0.8rem 1.14rem;
  }
  .det :global(.prow .l) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .det :global(.prow .l b) {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .det :global(.prow .l span) {
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .det :global(.prow .c) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .det :global(.pfld) {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.8rem 1.14rem;
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .det :global(.pfld .h) {
    margin-top: -0.2rem;
    font-size: var(--text-label-size);
    font-weight: 400;
    line-height: 1.45;
    color: var(--text-dim);
  }
  .det :global(.mono) {
    font-family: var(--code-font-family, ui-monospace, monospace);
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }

  @media (max-width: 700px) {
    .pcardx {
      display: block;
      height: auto;
      border: 0;
      background: none;
    }
    .prov.detail .lst,
    .prov:not(.detail) .det,
    .prov.detail .tools {
      display: none;
    }
    .lst {
      border-right: 0;
      padding: 0;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin: 0.4rem 0 0 0.5rem;
      padding: 0.3rem 0.5rem;
      background: none;
      border: 0;
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font: inherit;
      font-size: var(--text-label-size);
    }
    .lr {
      min-height: 3rem;
    }
  }
</style>

<script lang="ts">
  // People & devices: everyone this reader may manage, each with their devices, whether or not they
  // are online. Permissions belong to the person; a device can only have less. A Full reader changes
  // them; a Trusted reader sees the people they added and can revoke them.
  // Laid out like Settings > Providers: the list on the left, the selected person on the right. On a
  // phone the list and the page are two screens, the page opened in the settings stack.
  import { tick } from "svelte";
  import { app, type ConnectionId } from "../state.svelte";
  import { askConfirm } from "../confirm.svelte";
  import { isPhotoAvatar } from "../avatar";
  import { avatarSrc } from "../avatarCache.svelte";
  import { deviceTypeLabel, relTime } from "../format";
  import { mergeUsers, moveDevice, removeToken, removeUser, setDeviceRestrictions, setLimitedDefaults, setUserPermissions } from "../ipc";
  import { useNav } from "../settingsNav.svelte";
  import { viewport } from "../viewport.svelte";
  import type { Caps, Person, PersonDevice, Tier } from "../types";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Segmented from "./ui/Segmented.svelte";
  import Switch from "./ui/Switch.svelte";
  import Icon from "./Icon.svelte";
  import SubPage from "./SubPage.svelte";

  let { cid }: { cid: ConnectionId } = $props();

  const server = $derived(app.servers[cid]);
  const people = $derived(server?.people);
  const canEdit = $derived(!!server?.isFull);

  type BoolCap = "files_edit" | "commands_sandboxed" | "autonomous" | "processes" | "others_chats" | "terminals_watch" | "mcp_tools" | "commands_unsandboxed";
  type Group = "Projects" | "Visibility" | "Server";
  const GROUPS: Group[] = ["Projects", "Visibility", "Server"];
  const TOGGLES: { key: BoolCap; group: Group; label: string; hint: string; warn?: string }[] = [
    { key: "files_edit", group: "Projects", label: "Edit project files", hint: "Directly and through the agent. Off: read-only and plan modes only." },
    { key: "commands_sandboxed", group: "Projects", label: "Run commands in a sandbox", hint: "On projects with a real sandbox" },
    { key: "autonomous", group: "Projects", label: "Run without asking", hint: "Only when commands run in a sandbox" },
    { key: "others_chats", group: "Visibility", label: "Use other people's chats", hint: "Read and work in chats they don't own" },
    { key: "processes", group: "Visibility", label: "See the process list", hint: "Names, memory and CPU, without command lines" },
    { key: "terminals_watch", group: "Visibility", label: "Watch terminals", hint: "Terminal output can show secrets" },
    { key: "mcp_tools", group: "Server", label: "Use MCP tools", hint: "These act with the accounts connected on this server" },
    {
      key: "commands_unsandboxed",
      group: "Server",
      label: "Run commands without a sandbox",
      hint: "Commands can reach everything your account can",
      warn: "Commands without a sandbox can read your files and logins. Allow this?",
    },
  ];
  const BROWSER = [
    { value: "off", label: "Off" },
    { value: "watch", label: "Watch" },
    { value: "use", label: "Use" },
  ];
  const TIER_LABEL: Record<Tier, string> = { limited: "Limited", trusted: "Trusted", full: "Full" };
  const TIER_TONE = { limited: "neutral", trusted: "accent", full: "warning" } as const;
  const TIER_TEXT: Record<Tier, string> = {
    limited: "Works in projects already on this server",
    trusted: "Works in projects and helps run the server, without access to the machine",
    full: "Can do anything you can on this computer",
  };
  const TIERS = (["limited", "trusted", "full"] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }));
  const RANK: Record<Tier, number> = { limited: 0, trusted: 1, full: 2 };
  const FULL_WARNING = "Full access can do anything you can on this computer. Give it?";
  const DEFAULTS = "defaults";

  // The person (or DEFAULTS) on the right. Nothing picked yet, or the picked one is gone: the first person.
  let sel = $state<string | null>(null);
  let openDevice = $state<string | null>(null);
  // "revoke" or "remove": the inline confirm that swaps the button for Revoke or Remove and Keep.
  let confirming = $state<"revoke" | "remove" | null>(null);
  let showDetail = $state(false);
  const nav = useNav();
  let det = $state<HTMLElement>();
  let topMark = $state<HTMLElement>();
  // A control the person backed out of is drawn again from the server's value.
  let rev = $state(0);

  const onDefaults = $derived(sel === DEFAULTS);
  const current = $derived(people?.users.find((u) => u.id === sel) ?? people?.users[0]);
  const openDev = $derived(current?.devices.find((d) => d.credential === openDevice));
  const editable = (p: Person) => canEdit && p.id !== "owner";
  const online = (p: Person) => p.devices.some((d) => d.online);

  /** What a person gets with no overlay of their own. */
  function baseCaps(tier: Tier): Caps {
    const base = people?.tierDefaults[tier] ?? {};
    return tier === "limited" ? { ...base, ...people?.limitedDefaults } : base;
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  function withCap(overlay: Partial<Caps> | undefined, base: Caps, key: keyof Caps, value: unknown): Partial<Caps> {
    const next = { ...overlay } as Record<string, unknown>;
    if (same(base[key], value)) delete next[key];
    else next[key] = value;
    return next as Partial<Caps>;
  }

  async function allowed(warn: string | undefined, turningOn: boolean): Promise<boolean> {
    if (!warn || !turningOn || (await askConfirm(warn))) return true;
    rev++;
    return false;
  }

  const CLI_WARNING = "CLI agents run under your login, outside yoakeland's sandbox and rules. Allow this one?";
  const BROWSER_WARNING = "The agent would drive the server's browser, which may hold your logins. Allow this?";

  async function setPersonCap(p: Person, key: keyof Caps, value: unknown, warn?: string) {
    if (!(await allowed(warn, !!value))) return;
    setUserPermissions(cid, p.id, { caps: withCap(p.caps, baseCaps(p.tier), key, value) });
  }
  async function setDefaultCap(key: keyof Caps, value: unknown, warn?: string) {
    if (!(await allowed(warn, !!value))) return;
    setLimitedDefaults(cid, withCap(people?.limitedDefaults, people?.tierDefaults.limited ?? {}, key, value));
  }
  async function setTier(p: Person, tier: string) {
    if (tier === p.tier) return;
    if (!(await allowed(tier === "full" ? FULL_WARNING : undefined, true))) return;
    setUserPermissions(cid, p.id, { tier: tier as Tier });
  }
  function toggleCli(list: string[] | undefined, name: string, on: boolean): string[] {
    const rest = (list ?? []).filter((n) => n !== name);
    return on ? [...rest, name] : rest;
  }

  function setDeviceTier(d: PersonDevice, value: string) {
    setDeviceRestrictions(cid, d.credential, { maxTier: value as Tier | "", deny: d.deny });
  }
  function setDeny(d: PersonDevice, key: string, denied: boolean) {
    const rest = d.deny.filter((k) => k !== key);
    setDeviceRestrictions(cid, d.credential, { maxTier: d.maxTier ?? "", deny: denied ? [...rest, key] : rest });
  }
  function deviceTiers(p: Person) {
    return [
      { value: "", label: "Same" },
      ...TIERS.filter((t) => RANK[t.value] < RANK[p.tier]),
    ];
  }

  // Keeps MCP and CLI capitals: "Use MCP tools" reads "use MCP tools".
  const lower = (label: string) => label[0].toLowerCase() + label.slice(1);
  const others = (p: Person) => (people?.users ?? []).filter((u) => u.id !== p.id);
  const nameOf = (id?: string) => (id ? (people?.users.find((u) => u.id === id)?.name ?? "") : "");
  const deviceName = (d: PersonDevice) => d.deviceName || d.credential;
  const deviceIcon = (d: PersonDevice): "device-mobile" | "device-desktop" => (["web", "mobile"].includes(d.deviceType ?? "") ? "device-mobile" : "device-desktop");

  /** A device row only mentions permissions when they differ from its person's. */
  function deviceNotes(d: PersonDevice, p: Person): string[] {
    const notes: string[] = [];
    if (d.maxTier && RANK[d.maxTier] < RANK[p.tier]) notes.push(`${TIER_LABEL[d.maxTier]} on this device`);
    if (RANK[d.maxTier || p.tier] < RANK.full) {
      for (const key of d.deny) {
        const t = TOGGLES.find((x) => x.key === key);
        notes.push(`Can't ${t ? lower(t.label) : key === "browser" ? "use the server's browser" : key === "cli" ? "use CLI agents" : key}`);
      }
    }
    return notes;
  }
  function deviceMeta(d: PersonDevice): string {
    const seen = d.online ? "Online" : d.lastSeen ? `Last seen ${relTime(d.lastSeen * 1000)}` : "Not used yet";
    const by = nameOf(d.pairedBy);
    return [seen, d.deviceType && deviceTypeLabel(d.deviceType), by ? `Added by ${by}` : ""].filter(Boolean).join(" · ");
  }

  // Moving the page: each new screen starts at its top.
  function toTop() {
    void tick().then(() => {
      if (det) det.scrollTop = 0;
      const scroll = topMark?.closest<HTMLElement>(".sp-scroll");
      if (scroll) scroll.scrollTop = 0;
    });
  }
  function pick(id: string) {
    sel = id;
    openDevice = null;
    confirming = null;
    toTop();
    // Phone settings: the person opens as a page in the settings stack.
    if (viewport.narrow && nav) void nav.push("person");
    else showDetail = true;
  }
  function openDeviceOf(d: PersonDevice) {
    openDevice = d.credential;
    confirming = null;
    toTop();
  }
  function closeDevice() {
    openDevice = null;
    confirming = null;
    toTop();
  }
  function revokeNow(d: PersonDevice) {
    removeToken(cid, d.credential);
    closeDevice();
  }
  function removeNow(p: Person) {
    removeUser(cid, p.id);
    sel = null;
    openDevice = null;
    confirming = null;
    toTop();
  }
  async function merge(p: Person, into: string) {
    const target = nameOf(into);
    if (into && (await askConfirm(`Merge ${p.name} into ${target}? Their devices and messages become ${target}'s.`))) mergeUsers(cid, p.id, into);
    rev++;
  }
  async function move(d: PersonDevice, to: string) {
    const target = nameOf(to);
    if (to && (await askConfirm(`Move "${deviceName(d)}" to ${target}? It gets ${target}'s chats and access.`))) moveDevice(cid, d.credential, to);
    rev++;
  }
</script>

{#snippet avatar(p: Person, size: "s" | "l")}
  <span class="av {size}">
    {#if isPhotoAvatar(p.avatar ?? "")}<img src={avatarSrc(p.avatar)} alt="" />{:else if p.avatar}{p.avatar}{:else}<Icon name="user" size={size === "l" ? 16 : 13} />{/if}
  </span>
{/snippet}

{#snippet permissions(caps: Caps, set: (key: keyof Caps, value: unknown, warn?: string) => void)}
  {#each GROUPS as g (g)}
    <section class="sec">
      <h4>{g}</h4>
      {#key rev}
        <div class="pcard">
          {#each TOGGLES.filter((t) => t.group === g) as t (t.key)}
            <div class="prow">
              <div class="l"><b>{t.label}</b><span>{t.hint}</span></div>
              <div class="c">
                <Switch checked={!!caps[t.key]} label={t.label} onchange={(v) => set(t.key, v, t.warn)} />
              </div>
            </div>
          {/each}
          {#if g === "Server"}
            <div class="prow">
              <div class="l">
                <b>Server's browser</b>
                <span>Watch it, or let the agent use it too. It may be signed in to your accounts.</span>
              </div>
              <div class="c">
                <Segmented options={BROWSER} value={caps.browser ?? "off"} label="Server's browser" onchange={(v) => set("browser", v, v === "use" ? BROWSER_WARNING : undefined)} />
              </div>
            </div>
            {#each people?.cliProviders ?? [] as name (name)}
              <div class="prow">
                <div class="l"><b>{name}</b><span>Runs under your login, not the sandbox</span></div>
                <div class="c">
                  <Switch checked={!!caps.cli?.includes(name)} label={name} onchange={(v) => set("cli", toggleCli(caps.cli, name, v), v ? CLI_WARNING : undefined)} />
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/key}
    </section>
  {/each}
{/snippet}

<div class="pp" class:detail={showDetail}>
  <div class="pcardx">
    <aside class="lst">
      <div class="gh">People</div>
      {#each people?.users ?? [] as p (p.id)}
        <button type="button" class="lr" class:on={!onDefaults && current?.id === p.id} onclick={() => pick(p.id)}>
          {@render avatar(p, "s")}
          <span class="nm">{p.name || "Unnamed"}</span>
          <span class="chip">{TIER_LABEL[p.tier]}</span>
          <i class="dot" class:on={online(p)}></i>
        </button>
      {:else}
        <p class="none">No one yet.</p>
      {/each}
      {#if canEdit && people}
        <div class="gh">New people</div>
        <button type="button" class="lr" class:on={onDefaults} onclick={() => pick(DEFAULTS)}>
          <span class="av s"><Icon name="adjustments-horizontal" size={12} /></span>
          <span class="nm">Defaults</span>
        </button>
      {/if}
    </aside>

    <div class="det" bind:this={det}>
      {#if !openDev}
        <button type="button" class="back up" onclick={() => (showDetail = false)}><Icon name="chevron-left" size={14} /> People</button>
      {/if}
      <SubPage id="person" title={onDefaults ? "Defaults for new people" : (current?.name || "Unnamed")} link={false}>
        <div class="stack">
          <span class="top-mark" bind:this={topMark}></span>
          {#if onDefaults}
            <header class="dhd">
              <span class="av l"><Icon name="adjustments-horizontal" size={15} /></span>
              <div class="tt">
                <h3>Defaults for new people</h3>
                <div class="sb">What Limited people get unless you change it for them</div>
              </div>
            </header>
            {@render permissions(baseCaps("limited"), setDefaultCap)}
          {:else if current && openDev}
            <button type="button" class="back" onclick={closeDevice}><Icon name="chevron-left" size={14} /> {current.name || "Unnamed"}</button>
            <header class="dhd">
              <span class="ico"><Icon name={deviceIcon(openDev)} size={16} /></span>
              <div class="tt">
                <h3>{deviceName(openDev)}</h3>
                <div class="sb meta">{#if openDev.online}<i class="dot on"></i>{/if}<span>{deviceMeta(openDev)}</span></div>
              </div>
            </header>

            {#if editable(current) && current.tier !== "limited"}
              <section class="sec">
                <h4>Access</h4>
                {#key rev}
                  <div class="pcard">
                    <div class="prow">
                      <div class="l"><b>Access on this device</b><span>Can only be less than {current.name} has</span></div>
                      <div class="c">
                        <Segmented options={deviceTiers(current)} value={openDev.maxTier ?? ""} label="Access on this device" onchange={(v) => setDeviceTier(openDev, v)} />
                      </div>
                    </div>
                  </div>
                {/key}
              </section>
            {/if}

            {#if editable(current) && RANK[openDev.maxTier || current.tier] < RANK.full}
              <section class="sec">
                <h4>Allowed on this device</h4>
                {#key rev}
                  <div class="pcard">
                    {#each TOGGLES.filter((t) => current.effectiveCaps[t.key]) as t (t.key)}
                      <div class="prow">
                        <div class="l"><b>{t.label}</b></div>
                        <div class="c">
                          <Switch checked={!openDev.deny.includes(t.key)} label={t.label} onchange={(v) => setDeny(openDev, t.key, !v)} />
                        </div>
                      </div>
                    {/each}
                    {#if current.effectiveCaps.browser && current.effectiveCaps.browser !== "off"}
                      <div class="prow">
                        <div class="l"><b>Use the server's browser</b></div>
                        <div class="c">
                          <Switch checked={!openDev.deny.includes("browser")} label="Use the server's browser" onchange={(v) => setDeny(openDev, "browser", !v)} />
                        </div>
                      </div>
                    {/if}
                    {#if current.effectiveCaps.cli?.length}
                      <div class="prow">
                        <div class="l"><b>Use CLI agents</b></div>
                        <div class="c">
                          <Switch checked={!openDev.deny.includes("cli")} label="Use CLI agents" onchange={(v) => setDeny(openDev, "cli", !v)} />
                        </div>
                      </div>
                    {/if}
                  </div>
                {/key}
              </section>
            {/if}

            <section class="sec">
              <h4>Manage</h4>
              <div class="pcard">
                {#if editable(current) && others(current).length}
                  {#key rev}
                    <div class="prow">
                      <div class="l"><b>Move to another person</b><span>It gets their chats and access</span></div>
                      <div class="c">
                        <select class="field" onchange={(e) => move(openDev, e.currentTarget.value)}>
                          <option value="">Choose a person</option>
                          {#each others(current) as o (o.id)}<option value={o.id}>{o.name || "Unnamed"}</option>{/each}
                        </select>
                      </div>
                    </div>
                  {/key}
                {/if}
                <div class="prow">
                  <div class="l"><b>Revoke this device</b><span>It disconnects right away</span></div>
                  <div class="c">
                    {#if confirming === "revoke"}
                      <Button size="sm" variant="danger" onclick={() => revokeNow(openDev)}>Revoke</Button>
                      <Button size="sm" variant="ghost" onclick={() => (confirming = null)}>Keep</Button>
                    {:else}
                      <Button size="sm" variant="danger" onclick={() => (confirming = "revoke")}>Revoke</Button>
                    {/if}
                  </div>
                </div>
              </div>
            </section>
          {:else if current}
            <header class="dhd">
              {@render avatar(current, "l")}
              <div class="tt">
                <h3>{current.name || "Unnamed"}{#if current.id === server?.user?.id}<span class="you">&nbsp;(you)</span>{/if}</h3>
                <div class="sb">
                  <i class="dot" class:on={online(current)}></i>
                  <span>{online(current) ? "Online" : "Offline"}</span>
                  <span>·</span>
                  <span>{current.devices.length === 1 ? "1 device" : `${current.devices.length} devices`}</span>
                </div>
              </div>
              {#if !editable(current)}<Badge tone={TIER_TONE[current.tier]}>{TIER_LABEL[current.tier]}</Badge>{/if}
            </header>

            {#if editable(current)}
              <section class="sec">
                <h4>Access</h4>
                {#key rev}
                  <div class="pcard">
                    <div class="prow">
                      <div class="l"><b>What they can do</b><span>{TIER_TEXT[current.tier]}</span></div>
                      <div class="c">
                        <Segmented options={TIERS} value={current.tier} label="Access" onchange={(v) => setTier(current, v)} />
                      </div>
                    </div>
                  </div>
                {/key}
              </section>
            {/if}

            {#if current.tier === "full"}
              <section class="sec">
                <h4>Permissions</h4>
                <div class="pcard">
                  <div class="prow">
                    <div class="l">
                      <b>Everything</b>
                      <span>
                        {#if editable(current)}Full access skips the individual permissions. Lower it to choose.
                        {:else if current.id === "owner"}You own this server, so nothing is restricted
                        {:else}Full access skips the individual permissions.{/if}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            {:else if canEdit}
              {@render permissions(current.effectiveCaps, (key, value, warn) => setPersonCap(current, key, value, warn))}
            {/if}

            <section class="sec">
              <h4>Devices</h4>
              <div class="pcard">
                {#each current.devices as d (d.credential)}
                  <button type="button" class="prow drow" onclick={() => openDeviceOf(d)}>
                    <span class="ico"><Icon name={deviceIcon(d)} size={15} /></span>
                    <div class="l">
                      <b>{deviceName(d)}</b>
                      <span class="meta">{#if d.online}<i class="dot on"></i>{/if}{deviceMeta(d)}</span>
                      {#each deviceNotes(d, current) as note (note)}<span class="note">{note}</span>{/each}
                    </div>
                    <span class="chev"><Icon name="chevron-right" size={13} /></span>
                  </button>
                {:else}
                  <p class="none">No devices yet</p>
                {/each}
              </div>
            </section>

            {#if editable(current)}
              <section class="sec">
                <h4>Manage</h4>
                <div class="pcard">
                  {#if others(current).length}
                    {#key rev}
                      <div class="prow">
                        <div class="l"><b>Merge into another person</b><span>Their devices and messages become that person's</span></div>
                        <div class="c">
                          <select class="field" onchange={(e) => merge(current, e.currentTarget.value)}>
                            <option value="">Choose a person</option>
                            {#each others(current) as o (o.id)}<option value={o.id}>{o.name || "Unnamed"}</option>{/each}
                          </select>
                        </div>
                      </div>
                    {/key}
                  {/if}
                  <div class="prow">
                    <div class="l">
                      <b>Remove {current.name || "Unnamed"}</b>
                      <span>Their devices disconnect. Their chats and messages stay.</span>
                    </div>
                    <div class="c">
                      {#if confirming === "remove"}
                        <Button size="sm" variant="danger" onclick={() => removeNow(current)}>Remove</Button>
                        <Button size="sm" variant="ghost" onclick={() => (confirming = null)}>Keep</Button>
                      {:else}
                        <Button size="sm" variant="danger" onclick={() => (confirming = "remove")}>Remove</Button>
                      {/if}
                    </div>
                  </div>
                </div>
              </section>
            {/if}
          {/if}
        </div>
      </SubPage>
    </div>
  </div>
</div>

<style>
  .pp {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .pcardx {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr);
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
    scrollbar-color: var(--wash-4) transparent;
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
  .lr .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lr .chip {
    flex-shrink: 0;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
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
    scrollbar-color: var(--wash-4) transparent;
    scrollbar-gutter: stable;
    padding-bottom: 1.4rem;
  }
  .stack {
    display: flex;
    flex-direction: column;
  }
  .top-mark {
    display: block;
    height: 0;
  }
  .av {
    flex: none;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 28%;
    background: var(--wash-3);
    color: var(--text-dim);
    font-weight: 600;
  }
  .av.s {
    width: 1.43rem;
    height: 1.43rem;
    font-size: 0.72rem;
  }
  .av.l {
    width: 2.14rem;
    height: 2.14rem;
    font-size: 0.95rem;
  }
  .av img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .dot {
    flex: none;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.45;
  }
  .dot.on {
    background: var(--success);
    opacity: 1;
  }
  .dhd {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1.1rem 1.14rem 0.5rem;
  }
  .dhd .tt {
    flex: 1;
    min-width: 0;
  }
  .dhd h3 {
    margin: 0;
    overflow: hidden;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dhd .ico {
    width: 2.14rem;
    height: 2.14rem;
  }
  .you {
    color: var(--text-dim);
    font-weight: 400;
  }
  .sb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.2rem 0.45rem;
    margin-top: 0.15rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .meta .dot {
    display: inline-block;
    margin-right: 0.35rem;
    vertical-align: 0.1em;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    align-self: flex-start;
    margin: 0.75rem 0 0 0.64rem;
    padding: 0.25rem 0.5rem;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .back:hover {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .back + .dhd {
    padding-top: 0.5rem;
  }
  .sec {
    display: flex;
    flex-direction: column;
  }
  .sec > h4 {
    margin: 0;
    padding: 1rem 1.14rem 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .dhd + .sec > h4 {
    padding-top: 0.5rem;
  }
  .pcard {
    display: flex;
    flex-direction: column;
  }
  .pcard > * {
    border-top: 1px solid var(--panel-border);
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 1.14rem;
    padding: 0.8rem 1.14rem;
  }
  .prow .l {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .prow .l b {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .prow .l span {
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .prow .l span.note {
    color: var(--text);
  }
  .prow .c {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .ico {
    flex: none;
    width: 1.86rem;
    height: 1.86rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--wash-2);
    color: var(--text-dim);
  }
  .prow .chev {
    flex: none;
    display: inline-flex;
    color: var(--text-dim);
  }
  .drow {
    width: 100%;
    background: none;
    border: 0;
    border-top: 1px solid var(--panel-border);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .drow:hover {
    background: var(--sidebar-hover);
  }
  .sec .none {
    padding: 0.8rem 1.14rem;
  }
  select.field {
    appearance: none;
    width: auto;
    max-width: 13rem;
    height: 1.71rem;
    padding: 0 1.5rem 0 0.5rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background-color: var(--wash-2);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239498a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.4rem center;
    background-size: 0.8rem;
    color: var(--text);
    font: inherit;
    font-size: var(--text-label-size);
  }
  .up {
    display: none;
  }

  @media (max-width: 700px) {
    .pcardx {
      display: block;
      height: auto;
      border: 0;
      background: none;
    }
    .pp.detail .lst,
    .pp:not(.detail) .det {
      display: none;
    }
    .lst {
      border-right: 0;
      padding: 0;
    }
    .up {
      display: inline-flex;
    }
    .lr {
      min-height: 3rem;
    }
    /* A wide control drops under its text instead of squeezing it. */
    .prow {
      flex-wrap: wrap;
    }
    .prow .l {
      min-width: min(12rem, 60%);
    }
  }
</style>

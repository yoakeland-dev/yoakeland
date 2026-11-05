<script lang="ts">
  // People & devices: everyone this reader may manage, each with their devices, whether or not they
  // are online. Permissions belong to the person; a device can only have less. A Full reader changes
  // them; a Trusted reader sees the people they added and can revoke them.
  import { app, type ConnectionId } from "../state.svelte";
  import { askConfirm } from "../confirm.svelte";
  import { isPhotoAvatar } from "../avatar";
  import { relTime } from "../format";
  import { mergeUsers, moveDevice, removeToken, removeUser, setDeviceRestrictions, setLimitedDefaults, setUserPermissions } from "../ipc";
  import type { Caps, Person, PersonDevice, Tier } from "../types";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import Segmented from "./ui/Segmented.svelte";
  import Switch from "./ui/Switch.svelte";
  import Icon from "./Icon.svelte";
  import { tip } from "../tooltip.svelte";

  let { cid }: { cid: ConnectionId } = $props();

  const server = $derived(app.servers[cid]);
  const people = $derived(server?.people);
  const canEdit = $derived(!!server?.isFull);

  type BoolCap = "files_edit" | "commands_sandboxed" | "autonomous" | "processes" | "others_chats" | "terminals_watch" | "mcp_tools" | "commands_unsandboxed";
  const TOGGLES: { key: BoolCap; label: string; hint: string; warn?: string }[] = [
    { key: "files_edit", label: "Edit project files", hint: "Directly and through the agent. Off: read-only and plan modes only." },
    { key: "commands_sandboxed", label: "Run commands in a sandbox", hint: "On projects with a real sandbox." },
    { key: "autonomous", label: "Run without asking", hint: "Only when commands run in a sandbox." },
    { key: "processes", label: "See the process list", hint: "Names, memory and CPU, without command lines." },
    { key: "others_chats", label: "Use other people's chats", hint: "Read and work in chats they don't own." },
    { key: "terminals_watch", label: "Watch terminals", hint: "Terminal output can show secrets." },
    { key: "mcp_tools", label: "Use MCP tools", hint: "These act with the accounts connected on this server." },
    {
      key: "commands_unsandboxed",
      label: "Run commands without a sandbox",
      hint: "On projects with no real sandbox, commands can reach everything your account can.",
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
  const TIERS = (["limited", "trusted", "full"] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }));
  const RANK: Record<Tier, number> = { limited: 0, trusted: 1, full: 2 };
  const FULL_WARNING = "Full access can do anything you can on this computer. Give it?";

  let openId = $state<string | null>(null);
  let openDevice = $state<string | null>(null);
  let defaultsOpen = $state(false);
  // A control the person backed out of is drawn again from the server's value.
  let rev = $state(0);

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
      { value: "", label: "Same as person" },
      ...TIERS.filter((t) => RANK[t.value] < RANK[p.tier]),
    ];
  }

  const others = (p: Person) => (people?.users ?? []).filter((u) => u.id !== p.id);
  const nameOf = (id?: string) => (id ? (people?.users.find((u) => u.id === id)?.name ?? "") : "");
  const deviceName = (d: PersonDevice) => d.deviceName || d.credential;

  /** A device row only mentions permissions when they differ from its person's. */
  function deviceNotes(d: PersonDevice, p: Person): string[] {
    const notes: string[] = [];
    if (d.maxTier && RANK[d.maxTier] < RANK[p.tier]) notes.push(`${TIER_LABEL[d.maxTier]} here`);
    if (RANK[d.maxTier || p.tier] < RANK.full) {
      for (const key of d.deny) {
        const t = TOGGLES.find((x) => x.key === key);
        notes.push(`No ${(t?.label ?? key).toLowerCase()} here`);
      }
    }
    return notes;
  }
  function deviceMeta(d: PersonDevice): string {
    const seen = d.online ? "Online" : d.lastSeen ? `Last seen ${relTime(d.lastSeen * 1000)}` : "Not used yet";
    const by = nameOf(d.pairedBy);
    return [d.deviceType, seen, by ? `Added by ${by}` : ""].filter(Boolean).join(" · ");
  }

  async function revoke(d: PersonDevice) {
    if (await askConfirm(`Revoke "${deviceName(d)}"? It's disconnected right away.`)) removeToken(cid, d.credential);
  }
  async function remove(p: Person) {
    if (await askConfirm(`Remove ${p.name}? All their devices are disconnected. Their chats and messages stay.`)) removeUser(cid, p.id);
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

{#snippet avatar(p: Person)}
  <span class="avatar">
    {#if isPhotoAvatar(p.avatar ?? "")}<img src={p.avatar} alt="" />{:else if p.avatar}{p.avatar}{:else}<Icon name="user" size={13} />{/if}
  </span>
{/snippet}

{#snippet capEditor(caps: Caps, set: (key: keyof Caps, value: unknown, warn?: string) => void)}
  {#key rev}
    {#each TOGGLES as t (t.key)}
      <div class="cap">
        <div class="cap-text">
          <span class="cap-label">{t.label}</span>
          <span class="cap-hint">{t.hint}</span>
        </div>
        <Switch checked={!!caps[t.key]} label={t.label} onchange={(v) => set(t.key, v, t.warn)} />
      </div>
    {/each}
    <div class="cap">
      <div class="cap-text">
        <span class="cap-label">Server's browser</span>
        <span class="cap-hint">Watch it, or let the agent use it too. It may be signed in to your accounts.</span>
      </div>
      <Segmented
        options={BROWSER}
        value={caps.browser ?? "off"}
        label="Server's browser"
        onchange={(v) => set("browser", v, v === "use" ? BROWSER_WARNING : undefined)}
      />
    </div>
    {#if people?.cliProviders.length}
      <div class="cap cli">
        <div class="cap-text">
          <span class="cap-label">CLI agents</span>
          <span class="cap-hint">These run under your login, not the sandbox.</span>
        </div>
        <div class="cli-list">
          {#each people.cliProviders as name (name)}
            <label class="cli-item">
              <Checkbox
                checked={!!caps.cli?.includes(name)}
                onchange={(v) => set("cli", toggleCli(caps.cli, name, v), v ? CLI_WARNING : undefined)}
              />
              {name}
            </label>
          {/each}
        </div>
      </div>
    {/if}
  {/key}
{/snippet}

<ul class="people">
  {#each people?.users ?? [] as p (p.id)}
    {@const isOpen = openId === p.id}
    <li class="person">
      <button type="button" class="person-row" aria-expanded={isOpen} onclick={() => (openId = isOpen ? null : p.id)}>
        {@render avatar(p)}
        <span class="person-text">
          <span class="person-name">{p.name || "Unnamed"}{p.id === server?.user?.id ? " (you)" : ""}</span>
          <span class="person-meta">{p.devices.length === 1 ? "1 device" : `${p.devices.length} devices`}{p.devices.some((d) => d.online) ? " · online" : ""}</span>
        </span>
        <Badge tone={TIER_TONE[p.tier]}>{TIER_LABEL[p.tier]}</Badge>
        <span class="chev" class:open={isOpen}><Icon name="chevron-right" size={13} /></span>
      </button>

      {#if isOpen}
        <div class="person-body">
          {#if canEdit && p.id !== "owner"}
            {#key rev}
              <div class="cap">
                <div class="cap-text">
                  <span class="cap-label">Access</span>
                  <span class="cap-hint">
                    {#if p.tier === "full"}Can do anything you can on this computer.
                    {:else if p.tier === "trusted"}Works in projects and helps run the server, without access to the machine.
                    {:else}Works in projects already on this server.{/if}
                  </span>
                </div>
                <Segmented options={TIERS} value={p.tier} label="Access" onchange={(v) => setTier(p, v)} />
              </div>
            {/key}
          {/if}

          {#if canEdit && p.tier !== "full"}
            {@render capEditor(p.effectiveCaps, (key, value, warn) => setPersonCap(p, key, value, warn))}
          {/if}

          <h4 class="sub">Devices</h4>
          <ul class="devices">
            {#each p.devices as d (d.credential)}
              {@const editing = openDevice === d.credential}
              <li class="device">
                <div class="device-row">
                  <span class="dot" class:on={d.online}></span>
                  <div class="device-text">
                    <span class="device-name">{deviceName(d)}</span>
                    <span class="device-meta">{deviceMeta(d)}</span>
                    {#each deviceNotes(d, p) as note (note)}<span class="device-note">{note}</span>{/each}
                  </div>
                  {#if canEdit && p.id !== "owner"}
                    <Button type="button" icon variant="ghost" {@attach tip("Limit this device")} aria-label="Limit this device" onclick={() => (openDevice = editing ? null : d.credential)}>
                      <Icon name="shield-check" size={13} />
                    </Button>
                  {/if}
                  <Button type="button" icon variant="ghost" destructive {@attach tip("Revoke this device")} aria-label="Revoke this device" onclick={() => revoke(d)}>
                    <Icon name="user-x" size={13} />
                  </Button>
                </div>
                {#if editing}
                  <div class="device-edit">
                    {#if p.tier !== "limited"}
                      <div class="cap">
                        <div class="cap-text"><span class="cap-label">Access on this device</span></div>
                        <Segmented options={deviceTiers(p)} value={d.maxTier ?? ""} label="Access on this device" onchange={(v) => setDeviceTier(d, v)} />
                      </div>
                    {/if}
                    {#if RANK[d.maxTier || p.tier] < RANK.full}
                      <p class="cap-hint">Turn off here anything this device shouldn't have.</p>
                      <div class="deny-list">
                        {#each TOGGLES.filter((t) => p.effectiveCaps[t.key]) as t (t.key)}
                          <label class="cli-item">
                            <Checkbox checked={d.deny.includes(t.key)} onchange={(v) => setDeny(d, t.key, v)} />
                            No {t.label.toLowerCase()}
                          </label>
                        {/each}
                        {#if p.effectiveCaps.browser && p.effectiveCaps.browser !== "off"}
                          <label class="cli-item">
                            <Checkbox checked={d.deny.includes("browser")} onchange={(v) => setDeny(d, "browser", v)} />
                            No server browser
                          </label>
                        {/if}
                        {#if p.effectiveCaps.cli?.length}
                          <label class="cli-item">
                            <Checkbox checked={d.deny.includes("cli")} onchange={(v) => setDeny(d, "cli", v)} />
                            No CLI agents
                          </label>
                        {/if}
                      </div>
                    {/if}
                    {#if others(p).length}
                      {#key rev}
                        <label class="pick">
                          Move to
                          <select onchange={(e) => move(d, e.currentTarget.value)}>
                            <option value="">Choose a person</option>
                            {#each others(p) as o (o.id)}<option value={o.id}>{o.name || "Unnamed"}</option>{/each}
                          </select>
                        </label>
                      {/key}
                    {/if}
                  </div>
                {/if}
              </li>
            {:else}
              <li class="device-empty">No devices.</li>
            {/each}
          </ul>

          {#if canEdit && p.id !== "owner"}
            <div class="person-actions">
              {#if others(p).length}
                {#key rev}
                  <label class="pick">
                    Merge into
                    <select onchange={(e) => merge(p, e.currentTarget.value)}>
                      <option value="">Choose a person</option>
                      {#each others(p) as o (o.id)}<option value={o.id}>{o.name || "Unnamed"}</option>{/each}
                    </select>
                  </label>
                {/key}
              {/if}
              <Button type="button" variant="ghost" destructive onclick={() => remove(p)}>Remove person</Button>
            </div>
          {/if}
        </div>
      {/if}
    </li>
  {:else}
    <li class="device-empty">No one yet.</li>
  {/each}
</ul>

{#if canEdit && people}
  <div class="defaults">
    <button type="button" class="person-row" aria-expanded={defaultsOpen} onclick={() => (defaultsOpen = !defaultsOpen)}>
      <span class="person-text">
        <span class="person-name">Defaults for new people</span>
        <span class="person-meta">What Limited people get unless you change it for them</span>
      </span>
      <span class="chev" class:open={defaultsOpen}><Icon name="chevron-right" size={13} /></span>
    </button>
    {#if defaultsOpen}
      <div class="person-body">
        {@render capEditor(baseCaps("limited"), setDefaultCap)}
      </div>
    {/if}
  </div>
{/if}

<style>
  .people,
  .devices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .person + .person,
  .defaults {
    border-top: 1px solid color-mix(in srgb, var(--panel-border) 60%, transparent);
  }
  .person-row {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    width: 100%;
    min-height: 2.86rem;
    padding: 0.43rem 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.86rem;
    height: 1.86rem;
    overflow: hidden;
    border-radius: 50%;
    background: var(--panel-raised, color-mix(in srgb, var(--panel-border) 40%, transparent));
    color: var(--text-dim);
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .person-text,
  .device-text,
  .cap-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.07rem;
  }
  .person-name,
  .device-name {
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-body-size);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .person-meta,
  .device-meta,
  .cap-hint {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .device-note {
    color: var(--warning, var(--accent));
    font-size: var(--text-label-size);
  }
  .chev {
    display: inline-flex;
    color: var(--text-dim);
    transition: transform calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .person-body {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
    padding: 0.14rem 0 0.86rem;
  }
  .cap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.43rem 0.86rem;
  }
  .cap-text {
    min-width: min(14rem, 100%);
  }
  .cap-label {
    color: var(--text);
    font-size: var(--text-body-size);
  }
  .cli-list,
  .deny-list {
    display: flex;
    flex-direction: column;
    gap: 0.29rem;
  }
  .cli-item,
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 0.43rem;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .pick select {
    max-width: 12rem;
    padding: 0.21rem 0.36rem;
    border: 1px solid var(--panel-border);
    border-radius: 0.36rem;
    background: transparent;
    color: var(--text);
    font: inherit;
  }
  .sub {
    margin: 0.29rem 0 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
    font-weight: 500;
  }
  .device + .device {
    border-top: 1px solid color-mix(in srgb, var(--panel-border) 40%, transparent);
  }
  .device-row {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    padding: 0.36rem 0;
  }
  .dot {
    flex: none;
    width: 0.43rem;
    height: 0.43rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text-dim) 45%, transparent);
  }
  .dot.on {
    background: var(--success, var(--accent));
  }
  .device-edit {
    display: flex;
    flex-direction: column;
    gap: 0.43rem;
    padding: 0.14rem 0 0.71rem 1rem;
  }
  .device-empty {
    padding: 0.57rem 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .person-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.57rem;
    padding-top: 0.29rem;
  }
</style>

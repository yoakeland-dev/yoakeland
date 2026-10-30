<script lang="ts">
  // The "Add provider" page of Settings > Providers: CLIs found on the server, then the ACP
  // registry or a custom command. API keys live on their own tab; the last row here jumps there.
  import { untrack } from "svelte";
  import { app, type ServerState } from "../state.svelte";
  import { isDesktop } from "../platform";
  import { acpRegistry, registerProvider, type AcpRegistryAgent } from "../ipc";
  import { CLI_AGENTS, MULTI_ACCOUNT, type AgentGroup } from "../modelVendor";
  import type { CliKind } from "../types";
  import Button from "./ui/Button.svelte";
  import TextField from "./ui/TextField.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let {
    cid,
    server,
    connected,
    groups,
    taken,
    onAddAccount,
    onAddKey,
    onAdded,
  }: {
    cid: string | null;
    server: ServerState | null;
    connected: boolean;
    groups: AgentGroup[];
    /** Account names already in use, switched off ones included. */
    taken: Set<string>;
    /** Claude and Codex need a folder and a sign-in, which the account sheet walks through. */
    onAddAccount: (kind: string) => void;
    onAddKey: () => void;
    /** The group key the new agent will appear under. */
    onAdded: (key: string) => void;
  } = $props();

  const found = $derived((Object.keys(CLI_AGENTS) as CliKind[]).filter((k) => server?.cliAvailability[k] && !groups.some((g) => g.kind === k)));

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function uniq(base: string) {
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  const groupKey = (command: string, args: string[]) => `cli_acp:${[command, ...args].join(" ")}`;

  function addFound(k: CliKind) {
    if (!cid) return;
    if (MULTI_ACCOUNT.has(k)) return onAddAccount(k);
    const m = CLI_AGENTS[k];
    registerProvider(cid, { name: uniq(m.defaultName), kind: k, label: m.title, authMethod: "manual" });
    onAdded(k);
  }

  let tab = $state<"registry" | "custom">("registry");
  let q = $state("");
  let registry = $state<AcpRegistryAgent[] | null>(null);
  let loading = $state(false);
  let regError = $state("");

  async function load() {
    if (registry || loading || !isDesktop) return;
    loading = true;
    regError = "";
    try {
      registry = await acpRegistry();
    } catch (e) {
      regError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    if (tab === "registry") untrack(load);
  });

  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return (registry ?? []).filter((a) => !needle || `${a.name} ${a.description}`.toLowerCase().includes(needle));
  });
  function recipe(a: AcpRegistryAgent) {
    if (a.npx) return { command: "npx", args: ["-y", a.npx.package, ...(a.npx.args ?? [])] };
    if (a.uvx) return { command: "uvx", args: [a.uvx.package, ...(a.uvx.args ?? [])] };
    return null;
  }
  const isAdded = (a: AcpRegistryAgent) => {
    const r = recipe(a);
    return !!r && groups.some((g) => g.key === groupKey(r.command, r.args));
  };
  function addRegistry(a: AcpRegistryAgent) {
    const r = recipe(a);
    if (!cid || !r) return;
    registerProvider(cid, { name: uniq(slug(a.id)), kind: "cli_acp", label: a.name, authMethod: "manual", command: r.command, args: r.args });
    onAdded(groupKey(r.command, r.args));
  }

  let cName = $state("");
  let cCommand = $state("");
  let cEnv = $state("");
  const env = $derived(
    cEnv
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1)] as const)
      .filter(([k]) => k),
  );
  function addCustom(e: Event) {
    e.preventDefault();
    if (!cid || !cName.trim() || !cCommand.trim()) return;
    // "cmd arg1 arg2": the first word is the binary, the rest its args (no quoting; use a wrapper script for odd ones).
    const [command, ...args] = cCommand.trim().split(/\s+/);
    const data: Record<string, unknown> = { name: uniq(slug(cName) || "agent"), kind: "cli_acp", label: cName.trim(), authMethod: "manual", command, args };
    if (env.length) data.env = Object.fromEntries(env);
    registerProvider(cid, data);
    onAdded(groupKey(command, args));
    cName = cCommand = cEnv = "";
  }
</script>

<section class="block">
  <h3>Ready to add</h3>
  {#if found.length}<p class="hint">CLIs found on this server are already signed in.</p>{/if}
  <div class="card">
    <div class="trow th"><span>Name</span><span>Command</span><span></span></div>
    {#each found as k (k)}
      <div class="trow">
        <span class="nm"><LobeIcon name={CLI_AGENTS[k].icon} size={20} /><b>{CLI_AGENTS[k].title}</b></span>
        <span class="mono">{CLI_AGENTS[k].cli}</span>
        <span class="ra"><Button size="sm" variant="primary" disabled={!connected} onclick={() => addFound(k)}>Add</Button></span>
      </div>
    {/each}
    <div class="trow">
      <span class="nm"><span class="key-tile"><Icon name="key" size={13} /></span><b>API key</b></span>
      <span class="mono">Anthropic, OpenAI-compatible, OpenRouter</span>
      <span class="ra"><Button size="sm" disabled={!connected} onclick={onAddKey}>Add key</Button></span>
    </div>
  </div>
</section>

<section class="block">
  <div class="card">
    <div class="ctitle">
      <div class="tabs2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "registry"} onclick={() => (tab = "registry")}>ACP registry</button>
        <button type="button" role="tab" aria-selected={tab === "custom"} onclick={() => (tab = "custom")}>Custom command</button>
      </div>
      {#if tab === "registry" && isDesktop}
        <TextField type="search" class="reg-search" placeholder="Search agents…" aria-label="Search the ACP registry" bind:value={q} />
      {/if}
    </div>
    {#if tab === "registry"}
      {#if !isDesktop}
        <p class="empty">The registry is only reachable from the desktop app. Use a custom command here.</p>
      {:else if regError}
        <p class="empty warn">{regError}</p>
      {:else if !registry}
        <p class="empty">Loading the registry…</p>
      {:else}
        {#each shown as a (a.id)}
          {@const r = recipe(a)}
          <div class="reg">
            {#if a.icon}<img class="reg-icon" src={a.icon} alt="" width="24" height="24" loading="lazy" style:filter={app.resolvedTheme === "dark" ? "invert(1)" : undefined} />{:else}<span class="reg-icon"></span>{/if}
            <div class="reg-text">
              <b>{a.name} <span class="mono">v{a.version}</span></b>
              <span>{a.description}</span>
            </div>
            {#if isAdded(a)}
              <span class="pill">Added</span>
            {:else if r}
              <Button size="sm" variant="primary" disabled={!connected} onclick={() => addRegistry(a)}>Add</Button>
            {:else}
              <span class="pill">Manual install</span>
            {/if}
          </div>
        {:else}
          <p class="empty">No agents match.</p>
        {/each}
      {/if}
    {:else}
      <form class="custom" onsubmit={addCustom}>
        <label>Name <TextField type="text" placeholder="My agent" bind:value={cName} /></label>
        <label>Command <TextField type="text" placeholder="my-agent --acp" bind:value={cCommand} /></label>
        <label class="wide">Environment <span class="optional">(optional, one NAME=value per line)</span><TextArea rows={2} bind:value={cEnv} placeholder="API_TOKEN=…" spellcheck="false" /></label>
        <div class="act"><Button type="submit" variant="primary" disabled={!connected || !cName.trim() || !cCommand.trim()}>Add provider</Button></div>
      </form>
    {/if}
  </div>
  <p class="hint">
    {tab === "registry"
      ? "Agents from the public ACP registry that run with npx or uvx. They start on the server, which needs Node or uv installed."
      : "Runs on the server, so the command is the server's. Environment values never leave it."}
  </p>
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.71rem;
  }
  h3 {
    margin: 0 0 0 1.14rem;
    font-size: 1.07rem;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    margin: 0 1.14rem;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  h3 + .hint {
    margin-top: -0.43rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-lg);
    overflow: clip;
  }
  .card > :global(* + *) {
    border-top: 1px solid var(--panel-border);
  }
  .trow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 4.6rem;
    align-items: center;
    gap: 0.86rem;
    padding: 0.64rem 1.14rem;
    font-size: var(--text-body-size);
  }
  .trow.th {
    padding-block: 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
  }
  .nm b {
    font-weight: 500;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--code-font-family, ui-monospace, monospace);
    font-size: var(--text-label-size);
    font-weight: 400;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Registry icons are single-colour SVGs drawn in currentColor, which an <img> renders black. */
  .reg-icon {
    padding: 0.2rem;
  }
  .key-tile {
    width: 1.43rem;
    height: 1.43rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius-xs);
    background: var(--wash-3);
    color: var(--text-dim);
  }
  .ra {
    text-align: right;
  }
  .ctitle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.86rem;
    min-height: 3.1rem;
    padding: 0 0.86rem 0 0.29rem;
  }
  .tabs2 {
    display: flex;
    align-self: stretch;
    gap: 0.14rem;
  }
  .tabs2 button {
    padding: 0 0.86rem;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    color: var(--text-dim);
    font-size: var(--text-body-size);
  }
  .tabs2 button:hover {
    color: var(--text);
  }
  .tabs2 button[aria-selected="true"] {
    color: var(--text);
    font-weight: 500;
    border-bottom-color: var(--accent);
  }
  .ctitle :global(.reg-search) {
    width: 14rem;
  }
  .empty {
    margin: 0;
    padding: 1.14rem;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .empty.warn {
    color: var(--warning);
  }
  .reg {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.86rem;
    padding: 0.64rem 1.14rem;
  }
  .reg-icon {
    width: 1.71rem;
    height: 1.71rem;
    border-radius: var(--radius-sm);
    background: var(--wash-2);
    object-fit: contain;
  }
  .reg-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .reg-text b {
    font-weight: 500;
    font-size: var(--text-body-size);
  }
  .reg-text span:not(.mono) {
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    padding: 0.14rem 0.57rem;
    border-radius: var(--radius-pill);
    background: var(--wash-2);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    white-space: nowrap;
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.86rem;
    padding: 1.14rem;
  }
  .custom label {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    font-size: var(--text-label-size);
    font-weight: var(--text-label-weight);
    color: var(--text-dim);
  }
  .custom .wide,
  .custom .act {
    grid-column: 1 / -1;
  }
  .custom .act {
    display: flex;
    justify-content: flex-end;
  }
  .optional {
    font-weight: 400;
    opacity: 0.7;
  }
  @media (max-width: 700px) {
    .trow {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .trow > :nth-child(2) {
      display: none;
    }
    .custom {
      grid-template-columns: 1fr;
    }
    .ctitle {
      flex-wrap: wrap;
      padding-block: 0.4rem;
    }
  }
</style>

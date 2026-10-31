<script lang="ts">
  // The command palette's "Add provider" page: CLIs found on the server, the ACP registry, and the
  // two things that need a form (an API key, a custom command). Picking an agent registers it; the
  // Providers page selects it once it shows up. Claude and Codex are added with their default folder:
  // another account of one that exists is added from that account's own page.
  import { Command } from "bits-ui";
  import { untrack } from "svelte";
  import { acpRegistry, detectCli, registerProvider, type AcpRegistryAgent } from "../ipc";
  import { agentGroups, CLI_AGENTS } from "../modelVendor";
  import { isDesktop } from "../platform";
  import type { ServerState } from "../state.svelte";
  import type { CliKind } from "../types";
  import Button from "./ui/Button.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import TextField from "./ui/TextField.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let {
    cid,
    server,
    form,
    onForm,
    close,
  }: {
    cid: string | null;
    server: ServerState | null;
    /** null: the list; otherwise the form being filled in. */
    form: "key" | "custom" | null;
    onForm: (f: "key" | "custom" | null) => void;
    close: () => void;
  } = $props();

  const providers = $derived(server?.providers ?? []);
  const groups = $derived(agentGroups(providers));
  const taken = $derived(new Set(providers.map((p) => p.name)));
  const found = $derived((Object.keys(CLI_AGENTS) as CliKind[]).filter((k) => server?.cliAvailability[k] && !groups.some((g) => g.kind === k)));

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function uniq(base: string) {
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  const groupKey = (command: string, args: string[]) => `cli_acp:${[command, ...args].join(" ")}`;

  function addFound(k: CliKind) {
    if (!cid) return;
    const m = CLI_AGENTS[k];
    registerProvider(cid, { name: uniq(m.defaultName), kind: k, label: m.title, authMethod: "manual" });
    close();
  }

  // ---- ACP registry ----
  let registry = $state<AcpRegistryAgent[] | null>(null);
  let regError = $state("");
  $effect(() => {
    if (!(isDesktop || cid) || registry) return;
    untrack(() => {
      acpRegistry(cid ?? undefined).then(
        (r) => (registry = r),
        (e) => (regError = e instanceof Error ? e.message : String(e)),
      );
    });
  });
  function recipe(a: AcpRegistryAgent) {
    if (a.npx) return { command: "npx", args: ["-y", a.npx.package, ...(a.npx.args ?? [])] };
    if (a.uvx) return { command: "uvx", args: [a.uvx.package, ...(a.uvx.args ?? [])] };
    return null;
  }
  const addable = $derived(
    (registry ?? []).filter((a) => {
      const r = recipe(a);
      return !!r && !groups.some((g) => g.key === groupKey(r.command, r.args));
    }),
  );
  function addRegistry(a: AcpRegistryAgent) {
    const r = recipe(a);
    if (!cid || !r) return;
    registerProvider(cid, { name: uniq(slug(a.id)), kind: "cli_acp", label: a.name, authMethod: "manual", command: r.command, args: r.args });
    close();
  }

  // ---- Forms ----
  let keyName = $state("");
  let httpProvider = $state<"anthropic" | "openai" | "openrouter">("anthropic");
  let apiKey = $state("");
  let baseUrl = $state("");
  function submitKey(e: Event) {
    e.preventDefault();
    const name = keyName.trim();
    if (!cid || !name || !apiKey.trim()) return;
    registerProvider(cid, { name, kind: "api_key", httpProvider, apiKey, baseUrl: baseUrl || undefined, authMethod: "manual" });
    close();
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
  function submitCustom(e: Event) {
    e.preventDefault();
    if (!cid || !cName.trim() || !cCommand.trim()) return;
    // "cmd arg1 arg2": the first word is the binary, the rest its args (no quoting; use a wrapper script for odd ones).
    const [command, ...args] = cCommand.trim().split(/\s+/);
    const data: Record<string, unknown> = { name: uniq(slug(cName) || "agent"), kind: "cli_acp", label: cName.trim(), authMethod: "manual", command, args };
    if (env.length) data.env = Object.fromEntries(env);
    registerProvider(cid, data);
    close();
  }

  const PROVIDERS = [
    ["anthropic", "Anthropic"],
    ["openai", "OpenAI-compatible"],
    ["openrouter", "OpenRouter"],
  ] as const;
</script>

{#if form === "key"}
  <form class="pform" onsubmit={submitKey}>
    <label>Name <TextField type="text" bind:value={keyName} placeholder="my-anthropic" autofocus /></label>
    <label>
      Provider
      <select class="sel" bind:value={httpProvider}>
        {#each PROVIDERS as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
    <label>API key <TextField type="password" bind:value={apiKey} placeholder="sk-…" /></label>
    <label>Base URL <span class="opt">(optional)</span><TextField type="text" bind:value={baseUrl} placeholder="http://localhost:11434/v1" /></label>
    <div class="act"><span>Stored on the server.</span><Button variant="primary" type="submit" disabled={!keyName.trim() || !apiKey.trim()}>Add key</Button></div>
  </form>
{:else if form === "custom"}
  <form class="pform" onsubmit={submitCustom}>
    <label>Name <TextField type="text" bind:value={cName} placeholder="My agent" autofocus /></label>
    <label>Command <TextField type="text" bind:value={cCommand} placeholder="my-agent --acp" /></label>
    <label class="wide">Environment <span class="opt">(optional, one NAME=value per line)</span><TextArea rows={2} bind:value={cEnv} placeholder="API_TOKEN=…" spellcheck="false" /></label>
    <div class="act"><span>Runs on the server. Values never leave it.</span><Button variant="primary" type="submit" disabled={!cName.trim() || !cCommand.trim()}>Add provider</Button></div>
  </form>
{:else}
  {#if found.length}
    <Command.Group>
      <Command.GroupHeading class="palette-heading">On this server</Command.GroupHeading>
      <Command.GroupItems>
        {#each found as k (k)}
          <Command.Item value={`found:${k}`} keywords={[CLI_AGENTS[k].title, CLI_AGENTS[k].cli]} onSelect={() => addFound(k)} class="palette-item">
            <LobeIcon name={CLI_AGENTS[k].icon} size={16} />
            <span class="label">{CLI_AGENTS[k].title}</span>
            <span class="detail">{CLI_AGENTS[k].cli}</span>
          </Command.Item>
        {/each}
      </Command.GroupItems>
    </Command.Group>
  {/if}
  <Command.Group>
    <Command.GroupHeading class="palette-heading">Connect</Command.GroupHeading>
    <Command.GroupItems>
      <Command.Item value="add:key" keywords={["API key", "Anthropic", "OpenAI", "OpenRouter"]} onSelect={() => onForm("key")} class="palette-item">
        <Icon name="key" size={14} />
        <span class="label">API key…</span>
        <span class="detail">Anthropic, OpenAI-compatible, OpenRouter</span>
      </Command.Item>
      <Command.Item value="add:custom" keywords={["Custom command", "ACP"]} onSelect={() => onForm("custom")} class="palette-item">
        <Icon name="terminal-2" size={14} />
        <span class="label">Custom command…</span>
        <span class="detail">Any ACP agent, by command</span>
      </Command.Item>
      <Command.Item value="add:refresh" keywords={["Refresh", "rescan", "detect", "installed"]} onSelect={() => (cid && detectCli(cid), close())} class="palette-item">
        <Icon name="refresh" size={14} />
        <span class="label">Refresh providers</span>
        <span class="detail">Look for CLIs installed since the server started</span>
      </Command.Item>
    </Command.GroupItems>
  </Command.Group>
  {#if addable.length}
    <Command.Group>
      <Command.GroupHeading class="palette-heading">ACP registry</Command.GroupHeading>
      <Command.GroupItems>
        {#each addable as a (a.id)}
          <Command.Item value={`acp:${a.id}`} keywords={[a.name, a.description]} onSelect={() => addRegistry(a)} class="palette-item">
            <Icon name="plus" size={14} />
            <span class="label">{a.name}</span>
            <span class="detail">{a.description}</span>
          </Command.Item>
        {/each}
      </Command.GroupItems>
    </Command.Group>
  {:else if regError}
    <p class="note">{regError}</p>
  {:else if !isDesktop && !cid}
    <p class="note">Connect to a server to browse the registry, or use a custom command.</p>
  {:else if !registry}
    <p class="note">Loading the registry…</p>
  {/if}
{/if}

<style>
  .pform {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.86rem 1rem;
    padding: 1rem 1.14rem 1.14rem;
  }
  .pform label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .wide,
  .act {
    grid-column: 1 / -1;
  }
  .act {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .opt {
    font-weight: 400;
    opacity: 0.8;
  }
  .sel {
    height: var(--ctrl-h, 2rem);
    padding: 0 0.6rem;
    background: var(--field-bg, var(--wash-1));
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
  }
  .note {
    margin: 0;
    padding: 0.8rem 1rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
</style>

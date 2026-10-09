<script lang="ts">
  // Adds a server of yours, or edits one (SPEC.md §3.1 save_mcp_server). Fields, or pasted README JSON.
  // The daemon validates again; this only keeps a typo next to the field instead of as a refusal.
  import { untrack } from "svelte";
  import { saveMcpServer } from "../../ipc";
  import { app, type ConnectionId } from "../../state.svelte";
  import { joinCommand, formatEnvLines, formatHeaderLines, parseEnvLines, parseHeaderLines, parseServersJson, serverNameError, splitCommand, transportOf } from "../../extensions";
  import type { McpServerConfig, McpServerStatus } from "../../types";
  import Button from "../ui/Button.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Switch from "../ui/Switch.svelte";
  import TextArea from "../ui/TextArea.svelte";
  import TextField from "../ui/TextField.svelte";
  import Icon from "../Icon.svelte";

  let {
    cid,
    projectPath,
    connected,
    initial = null,
    onclose,
  }: { cid: ConnectionId; projectPath: string | undefined; connected: boolean; initial?: McpServerStatus | null; onclose: (saved?: string[]) => void } = $props();

  const data = $derived(projectPath ? app.servers[cid]?.mcpByProject[projectPath] : undefined);

  type Form = {
    replacing: string;
    name: string;
    transport: "stdio" | "http" | "sse";
    command: string;
    cwd: string;
    env: string;
    url: string;
    headers: string;
    clientId: string;
    clientSecret: string;
    agents: boolean;
    timeout: string;
    base: McpServerConfig;
  };
  function fromServer(s: McpServerStatus | null): Form {
    if (!s) {
      return { replacing: "", name: "", transport: "stdio", command: "", cwd: "", env: "", url: "", headers: "", clientId: "", clientSecret: "", agents: false, timeout: "", base: {} };
    }
    const c = s.config;
    return {
      replacing: s.name, name: s.name, transport: transportOf(c), command: joinCommand(c.command, c.args), cwd: c.cwd ?? "",
      env: formatEnvLines(c.env), url: c.url ?? "", headers: formatHeaderLines(c.headers), clientId: c.oauth?.clientId ?? "",
      clientSecret: c.oauth?.clientSecret ?? "", agents: !!c.agents, timeout: c.timeoutMs ? String(c.timeoutMs / 1000) : "", base: c,
    };
  }

  let form = $state<Form>(untrack(() => fromServer(initial)));
  let mode = $state<"form" | "json">("form");
  let jsonText = $state("");
  let formError = $state("");
  let awaiting = $state<string[] | null>(null);
  // The list as it stood at submit: a reply is the next one, so an edit isn't "saved" by the old entry.
  let sentAt: unknown = null;

  function build(f: Form): McpServerConfig {
    const cfg: McpServerConfig = { ...f.base, type: f.transport, agents: f.agents || undefined };
    delete cfg.command; delete cfg.args; delete cfg.env; delete cfg.cwd; delete cfg.url; delete cfg.headers; delete cfg.oauth;
    if (f.transport === "stdio") {
      const words = splitCommand(f.command);
      if (!words.length) throw new Error("Give the command that starts the server");
      cfg.command = words[0];
      if (words.length > 1) cfg.args = words.slice(1);
      const env = parseEnvLines(f.env);
      if (Object.keys(env).length) cfg.env = env;
      if (f.cwd.trim()) cfg.cwd = f.cwd.trim();
    } else {
      const url = f.url.trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("The address starts with http:// or https://");
      cfg.url = url;
      const headers = parseHeaderLines(f.headers);
      if (Object.keys(headers).length) cfg.headers = headers;
      if (f.clientId.trim()) cfg.oauth = { clientId: f.clientId.trim(), ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}) };
    }
    const secs = Number(f.timeout);
    if (f.timeout.trim()) {
      if (!Number.isFinite(secs) || secs <= 0) throw new Error("The timeout is a number of seconds");
      cfg.timeoutMs = Math.round(secs * 1000);
    } else delete cfg.timeoutMs;
    return cfg;
  }

  function submit(e: Event) {
    e.preventDefault();
    formError = "";
    try {
      if (mode === "json") {
        const items = parseServersJson(jsonText);
        for (const it of items) saveMcpServer(cid, projectPath, it.name, it.config);
        sentAt = data;
        awaiting = items.map((i) => i.name);
        return;
      }
      const name = form.name.trim();
      const bad = serverNameError(name);
      if (bad) throw new Error(`Name: ${bad}`);
      saveMcpServer(cid, projectPath, name, build(form), form.replacing);
      sentAt = data;
      awaiting = [name];
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    }
  }

  // Done when the daemon's reply lists what was saved; a refusal keeps the form open with why.
  $effect(() => {
    const d = data;
    untrack(() => {
      if (!awaiting || !d || d === sentAt) return;
      if (d.error) {
        formError = d.error;
        awaiting = null;
      } else if (awaiting.every((n) => d.servers.some((s) => s.name === n))) {
        const saved = awaiting;
        awaiting = null;
        onclose(saved);
      }
    });
  });
</script>

{#snippet field(label: string, hint?: string)}
  <span class="row-label">{label}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
{/snippet}

<form class="add" onsubmit={submit}>
        <div class="add-head">
          <h4>{form.replacing ? `Edit ${form.replacing}` : "Add a server"}</h4>
          {#if !form.replacing}
            <Segmented options={[{ value: "form", label: "Fields" }, { value: "json", label: "Paste JSON" }]} bind:value={mode} />
          {/if}
        </div>

        {#if mode === "json"}
          <label class="f">
            {@render field("Server JSON", "As a server's README gives it: { \"mcpServers\": { … } }. Several can be added at once.")}
            <TextArea bind:value={jsonText} rows={8} spellcheck="false" placeholder={'{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }\n  }\n}'} />
          </label>
        {:else}
          <label class="f">
            {@render field("Name")}
            <TextField bind:value={form.name} placeholder="github" spellcheck="false" autocomplete="off" aria-label="Server name" />
          </label>
          <div class="f">
            {@render field("Connects by")}
            <Segmented
              options={[{ value: "stdio", label: "Command" }, { value: "http", label: "HTTP" }, { value: "sse", label: "SSE (older)" }]}
              bind:value={() => form.transport, (v) => (form.transport = v as Form["transport"])}
            />
          </div>
          {#if form.transport === "stdio"}
            <label class="f">
              {@render field("Command", "Runs on this server as you. Use quotes around anything with a space.")}
              <TextField bind:value={form.command} placeholder="npx -y @modelcontextprotocol/server-github" spellcheck="false" autocomplete="off" aria-label="Command" />
            </label>
            <label class="f">
              {@render field("Environment", "One NAME=value per line. The server gets only these, plus a few basics like PATH and HOME. Use ${NAME} to read one from your own environment.")}
              <TextArea bind:value={form.env} rows={3} spellcheck="false" placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}"} />
            </label>
            <label class="f">
              {@render field("Working folder", "Optional. Defaults to the project.")}
              <TextField bind:value={form.cwd} placeholder="/path/to/folder" spellcheck="false" aria-label="Working folder" />
            </label>
          {:else}
            <label class="f">
              {@render field("Address")}
              <TextField bind:value={form.url} type="url" placeholder="https://mcp.example.com/mcp" spellcheck="false" autocomplete="off" aria-label="Address" />
            </label>
            <label class="f">
              {@render field("Headers", "One Name: value per line, for a key the server wants. Kept on this server and shown hidden afterwards.")}
              <TextArea bind:value={form.headers} rows={2} spellcheck="false" placeholder="Authorization: Bearer …" />
            </label>
            <details class="advanced">
              <summary>Sign-in app (only when the server doesn't register apps itself)</summary>
              <label class="f">
                {@render field("Client ID")}
                <TextField bind:value={form.clientId} spellcheck="false" autocomplete="off" aria-label="Client ID" />
              </label>
              <label class="f">
                {@render field("Client secret", "Optional.")}
                <TextField type="password" bind:value={form.clientSecret} spellcheck="false" autocomplete="off" aria-label="Client secret" />
              </label>
            </details>
          {/if}
          <div class="setting-row inline">
            <div class="setting-text">{@render field("Also give to coding agents", "Hands this server to Claude Code and to agents that speak ACP, in chats that use them. Codex, Amp and Pi manage their own servers.")}</div>
            <Switch bind:checked={form.agents} label="Also give to coding agents" />
          </div>
          <label class="f short">
            {@render field("Call timeout", "Seconds a single tool call may take. Leave empty for the default, 5 minutes.")}
            <TextField bind:value={form.timeout} placeholder="300" inputmode="numeric" aria-label="Call timeout in seconds" />
          </label>
        {/if}

        {#if formError}<p class="problem" role="alert"><Icon name="warning" size={13} /> <span class="selectable">{formError}</span></p>{/if}
        {#if form.transport === "stdio" && mode === "form"}
          <p class="hint"><Icon name="info-circle" size={12} /> A server you add runs on the machine yoakeland runs on. Only add ones you trust.</p>
        {/if}
        <div class="btn-row">
          <Button type="submit" variant="primary" disabled={!connected || awaiting !== null}>{form.replacing ? "Save" : "Add"}</Button>
          <Button variant="ghost" onclick={() => onclose()}>Cancel</Button>
        </div>
</form>

<style>
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .problem {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger);
    word-break: break-word;
  }
  .btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.8rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.025);
  }
  .add h4 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .add-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .f.short {
    max-width: 14rem;
  }
  .row-label {
    font-size: 0.82rem;
    font-weight: 500;
  }
  .advanced {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .advanced .f {
    margin-top: 0.5rem;
  }
  .setting-row.inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .setting-text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
</style>

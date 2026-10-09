<script lang="ts">
  // Servers other tools on the daemon's machine already have (SPEC.md §3.1 scan_mcp_imports). Nothing here
  // runs or starts them: the list is what the daemon found, with the exact command or address so you can see
  // what a server would do as you. Only an id and a name go back; the daemon copies secrets file to file.
  import { untrack } from "svelte";
  import { importMcpServers, scanMcpImports } from "../ipc";
  import { app, type ConnectionId } from "../state.svelte";
  import { agentLabel, importItems, importNameError, importable, serverTarget } from "../extensions";
  import type { McpImportData } from "../types";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import Spinner from "./ui/Spinner.svelte";
  import TextField from "./ui/TextField.svelte";
  import Icon from "./Icon.svelte";

  let { cid, projectPath, connected, onclose }: { cid: ConnectionId; projectPath: string | undefined; connected: boolean; onclose: () => void } = $props();

  let scan = $state<McpImportData | null>(null);
  let scanError = $state("");
  let ticked = $state<Record<string, boolean>>({});
  let names = $state<Record<string, string>>({});
  let importError = $state("");
  let sentAt: unknown = null;
  let sending = $state(false);

  async function load() {
    scan = null;
    scanError = "";
    try {
      const r = await scanMcpImports(cid, projectPath);
      if (r.error) scanError = r.error;
      else scan = r;
    } catch (e) {
      scanError = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    untrack(() => void load());
  });

  const candidates = $derived(scan?.candidates ?? []);
  const sources = $derived([...new Set(candidates.map((c) => c.source))]);
  const tickedSet = $derived(new Set(Object.keys(ticked).filter((k) => ticked[k])));
  const nameError = $derived(importNameError(candidates, tickedSet, names));
  const items = $derived(importItems(candidates, tickedSet, names));

  function send() {
    importError = "";
    sentAt = app.servers[cid]?.mcpByProject[projectPath ?? ""];
    sending = true;
    importMcpServers(cid, projectPath, items);
  }

  // The reply is the next `mcp_servers`: the new servers, or the list again with why nothing was saved.
  $effect(() => {
    const d = app.servers[cid]?.mcpByProject[projectPath ?? ""];
    untrack(() => {
      if (!sending || !d || d === sentAt) return;
      sending = false;
      if (d.error) importError = d.error;
      else onclose();
    });
  });
</script>

<div class="import">
  <div class="head">
    <h4>Import from other tools</h4>
    <Button size="sm" variant="ghost" onclick={onclose}>Cancel</Button>
  </div>
  <p class="hint">
    These are set up in other tools on the machine yoakeland runs on. Importing copies a server into yours; the other tool's entry is left as it is.
    An imported server runs as you once saved, so read what it runs first.
  </p>

  {#if scanError}
    <p class="problem" role="alert"><Icon name="warning" size={13} /> <span class="selectable">{scanError}</span></p>
    <div class="btn-row"><Button size="sm" onclick={load}>Try again</Button></div>
  {:else if !scan}
    <p class="hint busy"><Spinner /> Looking…</p>
  {:else}
    {#each scan.problems ?? [] as p (p)}<p class="problem"><Icon name="warning" size={13} /> <span class="selectable">{p}</span></p>{/each}

    {#if !candidates.length}
      <p class="empty">No servers found in Claude Code, Claude Desktop, Cursor, Codex, OpenCode or Amp.</p>
    {/if}

    {#each sources as src (src)}
      <h5>{agentLabel(src)}</h5>
      <ul class="list">
        {#each candidates.filter((c) => c.source === src) as c (c.id)}
          {@const ok = importable(c)}
          <li class:off={!ok}>
            <label class="row">
              <Checkbox label="Import {c.name}" disabled={!ok || sending} checked={!!ticked[c.id]} onchange={(v) => (ticked[c.id] = v)} />
              <span class="text">
                <span class="name">{c.name}</span>
                <span class="target selectable" title={serverTarget(c.config)}>{serverTarget(c.config)}</span>
                {#if c.config.env && Object.keys(c.config.env).length}<span class="hint">env: {Object.keys(c.config.env).join(", ")}</span>{/if}
                {#if c.alreadyAdded}<span class="hint">Already in your servers</span>{/if}
                {#if c.unsupported}<span class="hint">{c.unsupported}</span>{/if}
              </span>
            </label>
            {#if ticked[c.id] && c.nameTaken}
              <div class="rename">
                <span class="hint">You already have a server called {c.name}. Save this one as</span>
                <TextField bind:value={() => names[c.id] ?? c.suggestedName, (v) => (names[c.id] = v)} spellcheck="false" autocomplete="off" aria-label="Name for {c.name}" />
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}

    {#if nameError}<p class="problem" role="alert"><Icon name="warning" size={13} /> {nameError}</p>{/if}
    {#if importError}<p class="problem" role="alert"><Icon name="warning" size={13} /> <span class="selectable">{importError}</span></p>{/if}
    {#if candidates.length}
      <div class="btn-row">
        <Button variant="primary" loading={sending} disabled={!connected || sending || !items.length || !!nameError} onclick={send}>
          Import {items.length || ""} {items.length === 1 ? "server" : "servers"}
        </Button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.025);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h4,
  h5 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }
  h5 {
    margin-top: 0.3rem;
    color: var(--text-dim);
    font-weight: 500;
  }
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .empty {
    margin: 0;
    padding: 0.9rem 1rem;
    border-radius: var(--radius-sm);
    background: var(--well);
    color: var(--text-dim);
    font-size: var(--text-label-size);
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
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius-xs);
    background: var(--well);
  }
  li.off .text {
    opacity: 0.55;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    cursor: pointer;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    font-size: 0.84rem;
  }
  .target {
    font-family: var(--font-mono, monospace);
    font-size: 0.74rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.4rem 0 0 1.6rem;
  }
  .btn-row {
    display: flex;
    gap: 0.5rem;
  }
</style>

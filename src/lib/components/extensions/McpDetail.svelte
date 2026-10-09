<script lang="ts">
  // One MCP server, in full (SPEC.md §3.1 "MCP servers"). The daemon owns every decision; this shows what it
  // reports and sends the person's choices. A project's server waits here for an explicit approval.
  import { cancelMcpSignIn, reconnectMcpServer, removeMcpServer, setMcpServerEnabled, setMcpToolEnabled, signInMcpServer, signOutMcpServer } from "../../ipc";
  import { app, type ConnectionId } from "../../state.svelte";
  import { STATE_LABEL, STATE_TONE, humanizeTool, serverTarget, transportOf } from "../../extensions";
  import type { McpServerStatus } from "../../types";
  import { tip } from "../../tooltip.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import Icon from "../Icon.svelte";
  import ExtPage from "./ExtPage.svelte";

  let {
    cid,
    projectPath,
    s,
    connected,
    onedit,
    onremoved,
  }: { cid: ConnectionId; projectPath: string | undefined; s: McpServerStatus; connected: boolean; onedit: () => void; onremoved: () => void } = $props();

  const approved = $derived(s.scope === "user" || s.approval === "approved");
  const refusal = $derived(projectPath ? (app.servers[cid]?.mcpByProject[projectPath]?.error ?? "") : "");

  let tab = $state("tools");
  const tabs = $derived([
    { id: "tools", label: "Tools", count: s.tools?.length ?? 0 },
    ...(s.info?.instructions ? [{ id: "notes", label: "Notes" }] : []),
    ...(s.stderr ? [{ id: "log", label: "Output" }] : []),
  ]);
  const transport = $derived(transportOf(s.config) === "stdio" ? "Command" : transportOf(s.config) === "sse" ? "Legacy SSE" : "Streamable HTTP");
  const version = $derived(s.info?.version ? `${s.info.title ?? s.info.name ?? ""} ${s.info.version}`.trim() : "");

  let confirmRemove = $state(false);
  let signing = $state(false);
  let localError = $state("");

  async function signIn() {
    localError = "";
    signing = true;
    try {
      await signInMcpServer(cid, projectPath, s.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "sign-in cancelled") localError = msg;
    } finally {
      signing = false;
    }
  }
</script>

<ExtPage kind="mcp" name={s.name} hint={serverTarget(s.config)} title={s.name} subtitle={serverTarget(s.config)} mono {tabs} bind:tab>
  {#snippet toggle()}
    <Switch
      checked={s.scope === "user" ? s.state !== "disabled" : s.approval === "approved"}
      disabled={!connected}
      label={s.scope === "user" ? `Use ${s.name}` : `Allow this project's ${s.name} to run`}
      onchange={(v) => setMcpServerEnabled(cid, projectPath, s.name, v)}
    />
  {/snippet}

  {#snippet badges()}
    {#if s.approval === "pending"}<Badge tone="warning" dot>Needs approval</Badge>
    {:else if s.approval === "changed"}<Badge tone="warning" dot>Changed, approve again</Badge>
    {:else if s.approval === "denied"}<Badge dot>Declined</Badge>
    {:else}<Badge tone={STATE_TONE[s.state]} dot>{STATE_LABEL[s.state]}</Badge>{/if}
    <Badge>{s.scope === "project" ? ".mcp.json" : "Yours"}</Badge>
    <Badge>{transport}</Badge>
  {/snippet}

  {#snippet actions()}
    {#if s.scope === "user"}
      <Button size="sm" disabled={!connected} onclick={onedit}><Icon name="pencil" size={12} /> Edit</Button>
    {/if}
    {#if approved && s.state !== "disabled"}
      <Button size="sm" disabled={!connected} onclick={() => reconnectMcpServer(cid, projectPath, s.name)}><Icon name="refresh" size={12} /> Reconnect</Button>
    {/if}
    {#if s.remote && s.signedIn}
      <Button size="sm" disabled={!connected} onclick={() => signOutMcpServer(cid, projectPath, s.name)}>Sign out</Button>
    {:else if s.remote && approved && s.state !== "needs_auth" && s.state !== "disabled"}
      {#if signing}<Button size="sm" variant="ghost" onclick={() => void cancelMcpSignIn()}>Cancel</Button>{/if}
      <Button size="sm" loading={signing} disabled={!connected} onclick={signIn}><Icon name="log-in" size={12} /> Sign in</Button>
    {/if}
    {#if s.scope === "user"}
      {#if confirmRemove}
        <span class="confirm">Remove {s.name}?
          <Button size="sm" variant="danger" onclick={() => { removeMcpServer(cid, projectPath, s.name); confirmRemove = false; onremoved(); }}>Remove</Button>
          <Button size="sm" variant="ghost" onclick={() => (confirmRemove = false)}>Keep</Button>
        </span>
      {:else}
        <Button size="sm" variant="ghost" destructive disabled={!connected} onclick={() => (confirmRemove = true)}><Icon name="trash" size={12} /> Remove</Button>
      {/if}
    {/if}
  {/snippet}

  {#snippet alerts()}
    {#if refusal}<p class="problem" role="alert"><Icon name="warning" size={13} /> <span class="selectable">{refusal}</span></p>{/if}
    {#if localError}<p class="problem" role="alert"><Icon name="warning" size={13} /> <span class="selectable">{localError}</span></p>{/if}

    {#if s.approval === "pending" || s.approval === "changed"}
      <div class="callout">
        <p>
          {s.approval === "changed" ? "This project's .mcp.json changed this server since you approved it." : "This project's .mcp.json wants to run a server on this machine."}
          Approving lets it run as you, with your files and network:
        </p>
        <pre class="selectable">{serverTarget(s.config)}{#if s.config.env && Object.keys(s.config.env).length}
env: {Object.keys(s.config.env).join(", ")}{/if}</pre>
        <div class="btn-row">
          <Button variant="primary" size="sm" disabled={!connected} onclick={() => setMcpServerEnabled(cid, projectPath, s.name, true)}>Approve and run</Button>
          <Button size="sm" disabled={!connected} onclick={() => setMcpServerEnabled(cid, projectPath, s.name, false)}>Don't run</Button>
        </div>
      </div>
    {/if}

    {#if s.state === "failed" && s.error}
      <p class="problem"><Icon name="warning" size={13} /> <span class="selectable">{s.error}</span></p>
    {/if}
    {#if s.state === "needs_auth"}
      <div class="callout">
        <div class="signin">
          <span>{s.error || "This server wants you to sign in."}</span>
          <span class="btn-row">
            {#if signing}<Button size="sm" variant="ghost" onclick={() => void cancelMcpSignIn()}>Cancel</Button>{/if}
            <Button size="sm" variant="primary" loading={signing} disabled={!connected} onclick={signIn}><Icon name="log-in" size={13} /> Sign in</Button>
          </span>
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet body(t)}
    {#if t === "tools"}
      {#if s.tools?.length}
        <ul class="tools">
          {#each s.tools as tool (tool.name)}
            <li class:off={!tool.enabled}>
              <div class="tool-text">
                <span class="tool-name">{tool.title || humanizeTool(tool.rawName)} <code>{tool.rawName}</code></span>
                {#if tool.description}<span class="tool-desc" title={tool.description}>{tool.description}</span>{/if}
              </div>
              {#if tool.readOnly}<Badge tone="success">read-only</Badge>{/if}
              {#if tool.destructive}<Badge tone="danger">destructive</Badge>{/if}
              <Switch checked={tool.enabled} disabled={!connected || s.scope !== "user"} label="Offer {tool.rawName} to the model" onchange={(v) => setMcpToolEnabled(cid, projectPath, s.name, tool.rawName, v)} />
            </li>
          {/each}
        </ul>
        <p class="hint">
          Each tool call asks before it runs, like any command.
          {#if s.scope === "project"}Hide a tool with <code>disabledTools</code> in the project's <code>.mcp.json</code>.{/if}
          {#if s.truncated}{s.truncated} more tools were left out: a server offers at most 200.{/if}
        </p>
      {:else if s.state === "ready"}
        <p class="hint">This server offers no tools{s.info?.resources || s.resources ? ", only resources" : ""}.</p>
      {:else if approved && s.state === "idle"}
        <p class="hint">Not started yet. Its tools show up once it connects.</p>
      {:else}
        <p class="hint">No tools to show.</p>
      {/if}
    {:else if t === "notes"}
      <p class="notes selectable">{s.info?.instructions}</p>
      <p class="hint">Shown here only. They are not given to the model.</p>
    {:else}
      <pre class="selectable">{s.stderr}</pre>
    {/if}
  {/snippet}

  {#snippet rail()}
    <dl>
      <div><dt>Scope</dt><dd>{s.scope === "project" ? "This project's .mcp.json" : "Yours"}</dd></div>
      <div><dt>Transport</dt><dd>{transport}</dd></div>
      <div><dt>{transportOf(s.config) === "stdio" ? "Command" : "URL"}</dt><dd class="mono">{serverTarget(s.config)}</dd></div>
      {#if s.config.env && Object.keys(s.config.env).length}
        <div><dt>Environment</dt><dd class="mono">{Object.keys(s.config.env).join(", ")}</dd></div>
      {/if}
      {#if version}<div><dt>Server</dt><dd>{version}</dd></div>{/if}
      {#if s.info?.protocol}<div><dt>Protocol</dt><dd>{s.info.protocol}</dd></div>{/if}
      {#if s.config.agents}<div><dt>Shared with</dt><dd>Claude Code and ACP coding agents, when they start a chat</dd></div>{/if}
      {#if s.scope === "project"}<div><dt>Edit</dt><dd>In the project's <code>.mcp.json</code></dd></div>{/if}
    </dl>
  {/snippet}
</ExtPage>

<style>
  .problem {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger);
    word-break: break-word;
  }
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.5;
    color: var(--text-dim);
  }
  .callout {
    padding: 0.8rem 0.9rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 28%, transparent);
    font-size: var(--text-label-size);
  }
  .callout p {
    margin: 0 0 0.5rem;
    line-height: 1.5;
  }
  pre {
    margin: 0 0 0.6rem;
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-xs);
    background: var(--well);
    font-family: var(--font-mono, monospace);
    font-size: 0.74rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 24rem;
    overflow: auto;
  }
  .signin {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    color: var(--warning);
  }
  .notes {
    margin: 0;
    font-size: var(--text-body-size);
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .tools {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tools li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 6%, transparent);
  }
  .tools li:first-child {
    padding-top: 0.3rem;
  }
  .tools li.off .tool-text {
    opacity: 0.5;
  }
  .tool-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .tool-name {
    font-size: var(--text-body-size);
    font-weight: 500;
  }
  .tool-name code {
    margin-left: 0.4rem;
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--text-dim);
  }
  .tool-desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  code {
    font-family: var(--font-mono, monospace);
  }
  .btn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .confirm {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--text-label-size);
  }
</style>

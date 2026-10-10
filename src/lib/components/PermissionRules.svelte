<script lang="ts">
  // The permission rules that stop yoakeland asking (SPEC.md §3.1 "Permission rules"): what is in
  // force for a project, with a way to revoke each and to write new ones. Rules apply to
  // yoakeland's own tool loop (API models); a coding agent keeps its own rules and only
  // yoakeland's "never" rules reach it.
  import { addPermissionRule, deletePermissionRule, listPermissionRules } from "../ipc";
  import { app, type ConnectionId } from "../state.svelte";
  import { SCOPES, TOOLS, describeRule, modesLabel, ruleFromForm, sortRules, toolLabel } from "../permissionRules";
  import type { PermissionDecision, PermissionScope } from "../types";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import Button from "./ui/Button.svelte";
  import TextField from "./ui/TextField.svelte";

  let { cid, projectPath }: { cid: ConnectionId | null; projectPath: string | undefined } = $props();

  const data = $derived(projectPath ? app.servers[cid ?? ""]?.permissionRules[projectPath] : undefined);
  const rules = $derived(sortRules(data?.rules ?? []));
  $effect(() => {
    if (cid && projectPath) listPermissionRules(cid, projectPath);
  });

  let decision = $state<PermissionDecision>("allow");
  let tool = $state("bash");
  let scope = $state<PermissionScope>("project");
  let text = $state("");
  const decisionItems = [
    { value: "allow", label: "Allow" },
    { value: "ask", label: "Always ask" },
    { value: "deny", label: "Never" },
  ];
  const toolItems = TOOLS.map((t) => ({ value: t.value, label: t.label }));
  const scopeItems = SCOPES.map((s) => ({ value: s.value, label: s.label }));
  const placeholder = $derived(TOOLS.find((t) => t.value === tool)?.placeholder ?? "");

  function add(e: SubmitEvent) {
    e.preventDefault();
    if (!cid || !text.trim()) return;
    addPermissionRule(cid, projectPath, scope, { ...ruleFromForm(tool, text), decision });
    text = "";
  }
  const revoke = (id: string) => cid && deletePermissionRule(cid, projectPath, id);
  const where = (s: string) => (s === "builtin" ? "built in" : (SCOPES.find((x) => x.value === s)?.label ?? s));
</script>

<div class="rules">
  {#if !projectPath}
    <p class="hint">Open a project to see its rules.</p>
  {:else}
    {#each data?.errors ?? [] as err (err)}
      <p class="problem"><Icon name="warning" size={13} /> {err}</p>
    {/each}
    {#if data?.error}<p class="problem"><Icon name="warning" size={13} /> {data.error}</p>{/if}

    {#if rules.length}
      <ul class="list">
        {#each rules as r (r.id)}
          <li class:deny={r.decision === "deny"} title={describeRule(r)}>
            <span class="badge {r.decision}">{r.decision}</span>
            <span class="pattern selectable">{r.text}</span>
            <span class="meta">{toolLabel(r.tool)} · {where(r.scope)} · {modesLabel(r)}{r.source === "migrated" ? " · from before rules" : ""}</span>
            {#if r.readonly}
              <span class="meta">preset</span>
            {:else}
              <button type="button" class="revoke" aria-label="Revoke rule {r.text}" title="Revoke" onclick={() => revoke(r.id)}>
                <Icon name="xmark" size={12} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">No rules yet. Choosing “Always allow” on a permission request adds one here.</p>
    {/if}

    <form class="add" onsubmit={add}>
      <Dropdown items={decisionItems} bind:value={() => decision, (v) => (decision = v as PermissionDecision)} triggerClass="rule-pick" triggerTitle="Decision" contentClass="above-modal" />
      <Dropdown items={toolItems} bind:value={() => tool, (v) => (tool = v ?? "bash")} triggerClass="rule-pick" triggerTitle="What it applies to" contentClass="above-modal" />
      <TextField class="pattern" bind:value={text} {placeholder} aria-label="Pattern" spellcheck="false" />
      <Dropdown items={scopeItems} bind:value={() => scope, (v) => (scope = v as PermissionScope)} triggerClass="rule-pick" triggerTitle="Where it applies" contentClass="above-modal" />
      <Button type="submit" disabled={!text.trim()}>Add</Button>
    </form>
    <p class="hint">
      A command rule matches the program and its arguments word by word. A final <code>*</code> matches any more arguments
      (<code>go test *</code>). A command with <code>;</code> <code>|</code> <code>&amp;&amp;</code> or <code>$()</code> is never
      allowed by a rule. “Never” beats “Allow”, whichever is broader. Edit rules match paths inside the project
      (<code>internal/**</code>, <code>docs/*.md</code>).
    </p>
    {#if data?.notes?.length}
      <details class="notes">
        <summary>{data.notes.length} old {data.notes.length === 1 ? "entry" : "entries"} could not be converted</summary>
        <ul>{#each data.notes as n (n)}<li>{n}</li>{/each}</ul>
      </details>
    {/if}
  {/if}
</div>

<style>
  .rules {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
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
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2rem;
    padding: 0 0.4rem;
    border-radius: var(--radius-sm);
  }
  li:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .badge {
    flex-shrink: 0;
    width: 3rem;
    text-align: center;
    padding: 0.1rem 0;
    border-radius: var(--radius-pill);
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.07);
    color: var(--text-dim);
  }
  .badge.allow {
    color: var(--accent);
  }
  .badge.deny {
    color: var(--danger);
    background: var(--danger-dim);
  }
  .pattern {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-label-size);
  }
  .meta {
    flex-shrink: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
  }
  .revoke {
    flex-shrink: 0;
    display: inline-flex;
    border: none;
    background: none;
    padding: 0.3rem;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .revoke:hover {
    color: var(--danger);
    background: var(--danger-dim);
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .add :global(.ui-field.pattern) {
    flex: 1;
    width: auto;
    min-width: 10rem;
  }
  .add :global(.dropdown-trigger.rule-pick) {
    box-sizing: border-box;
    height: var(--ctrl-h);
    padding: 0 0.7rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    color: var(--text);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: var(--text-label-size);
  }
  code {
    font-family: var(--font-mono, monospace);
  }
  .notes {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .notes ul {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
  }
</style>

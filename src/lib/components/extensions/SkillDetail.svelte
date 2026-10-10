<script lang="ts">
  // One skill, in full (SPEC.md §3.1 "Skills"): its SKILL.md as the model would read it, and where it was
  // found. Which agents load a skill depends on the folder it sits in, so that is shown rather than implied.
  import { getSkill, setSkillEnabled } from "../../ipc";
  import { app, type ConnectionId } from "../../state.svelte";
  import { agentLabel, formatBytes } from "../../extensions";
  import type { SkillInfo } from "../../types";
  import { tip } from "../../tooltip.svelte";
  import Badge from "../ui/Badge.svelte";
  import Switch from "../ui/Switch.svelte";
  import Icon from "../Icon.svelte";
  import Markdown from "../Markdown.svelte";
  import ExtPage from "./ExtPage.svelte";

  let { cid, projectPath, s, connected }: { cid: ConnectionId; projectPath: string | undefined; s: SkillInfo; connected: boolean } = $props();

  const d = $derived(app.servers[cid]?.skillDetails[s.dir]);
  $effect(() => {
    if (!d) getSkill(cid, projectPath, s.dir);
  });

  let tab = $state("doc");
  const tabs = $derived([{ id: "doc", label: "Instructions" }, ...(d?.files?.length ? [{ id: "files", label: "Files", count: d.files.length }] : [])]);

  const home = (p: string) => p.replace(/^\/home\/[^/]+/, "~");
</script>

<ExtPage kind="skill" name={s.name} title={s.name} subtitle={s.description} {tabs} bind:tab>
  {#snippet toggle()}
    <Switch checked={s.enabled} disabled={!connected || !!s.shadowed} label="Use {s.name}" onchange={(v) => setSkillEnabled(cid, projectPath, s.dir, v)} />
  {/snippet}

  {#snippet badges()}
    <Badge tone={s.scope === "project" ? "accent" : "neutral"}>{s.scope === "project" ? "Project" : "Yours"}</Badge>
    {#if s.argumentHint}<Badge mono>{s.argumentHint}</Badge>{/if}
    {#if s.shadowed}<span {@attach tip("Another folder has a skill with this name, and it wins")}><Badge>Shadowed</Badge></span>{/if}
    {#if s.disableModelInvocation}<Badge tone="warning">Only when you name it</Badge>{/if}
    {#if !s.userInvocable}<Badge>Model only</Badge>{/if}
  {/snippet}

  {#snippet alerts()}
    {#each s.warnings ?? [] as w (w)}<p class="problem"><Icon name="warning" size={12} /> {w}</p>{/each}
    {#if d?.error}<p class="problem"><Icon name="warning" size={12} /> {d.error}</p>{/if}
  {/snippet}

  {#snippet body(t)}
    {#if t === "files"}
      <ul class="files">{#each d?.files ?? [] as f (f)}<li><code>{f}</code></li>{/each}</ul>
    {:else if d?.body !== undefined}
      <div class="doc"><Markdown text={d.body} /></div>
      {#if d.truncated}<p class="hint">Shortened here. The model gets up to 64 KB of it.</p>{/if}
    {:else if !d?.error}
      <p class="hint">Loading…</p>
    {/if}
  {/snippet}

  {#snippet rail()}
    <dl>
      <div><dt>Loaded by</dt><dd class="chips">{#each s.agents as a (a)}<Badge tone="success">{agentLabel(a)}</Badge>{/each}</dd></div>
      <div><dt>Location</dt><dd class="mono">{home(s.dir)}</dd></div>
      <div><dt>Size</dt><dd>{s.files} {s.files === 1 ? "file" : "files"}, {formatBytes(s.bytes)}</dd></div>
      {#if s.license}<div><dt>License</dt><dd>{s.license}</dd></div>{/if}
      {#if s.compatibility}<div><dt>Needs</dt><dd>{s.compatibility}</dd></div>{/if}
      {#if s.alsoIn?.length}<div><dt>Also found in</dt><dd class="mono">{s.alsoIn.map(home).join("\n")}</dd></div>{/if}
      {#if s.allowedTools}<div><dt>Declares tools</dt><dd class="mono">{s.allowedTools}</dd></div>{/if}
      {#if s.userInvocable && s.enabled && !s.shadowed}
        <div><dt>Use it</dt><dd>Start a message with <code>/{s.name}</code>, or write <code>${s.name}</code> anywhere in one.</dd></div>
      {/if}
    </dl>
  {/snippet}
</ExtPage>

<style>
  .hint {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.5;
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
  .doc {
    font-size: 0.9rem;
    line-height: 1.6;
  }
  code {
    font-family: var(--font-mono, monospace);
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .files li {
    padding: 0.5rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 6%, transparent);
    font-size: 0.78rem;
  }
</style>

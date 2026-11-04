<script lang="ts">
  // One account or API key, opened on the right of Settings > Providers: who it is and whether it
  // is on, its subscription limits, the few things that can be edited, its models, and removal.
  import { untrack } from "svelte";
  import { ensureModels, refreshModels, setFavoriteModels } from "../../ipc";
  import { MULTI_ACCOUNT, providerLabel, type AgentGroup } from "../../modelVendor";
  import { signInCommand } from "../../agentSignIn";
  import { resetText, resetTitle, windows } from "../../rateLimits";
  import { tip } from "../../tooltip.svelte";
  import { app, type ServerState } from "../../state.svelte";
  import type { ModelInfo, ProviderInfo } from "../../types";
  import Button from "../ui/Button.svelte";
  import Progress from "../ui/Progress.svelte";
  import Switch from "../ui/Switch.svelte";
  import TextField from "../ui/TextField.svelte";
  import Icon from "../Icon.svelte";
  import SearchInput from "../SearchInput.svelte";
  import LobeIcon from "../LobeIcon.svelte";

  let {
    cid,
    server,
    connected,
    p,
    title,
    icon,
    group,
    off,
    others,
    onToggle,
    onRemove,
    onSave,
    onAddAccount,
  }: {
    cid: string | null;
    server: ServerState | null;
    connected: boolean;
    p: ProviderInfo;
    title: string;
    icon: string;
    group?: AgentGroup;
    off: boolean;
    /** Every registered provider, to spot two accounts sharing a folder. */
    others: ProviderInfo[];
    onToggle: (on: boolean) => void;
    onRemove: () => void;
    onSave: (patch: { label: string; configDir: string }) => void;
    onAddAccount: (kind: string) => void;
  } = $props();

  const isKey = $derived(p.kind === "api_key");
  const oauth = $derived(p.authMethod === "oauth");
  const multi = $derived(MULTI_ACCOUNT.has(p.kind));
  const HTTP_LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI-compatible", openrouter: "OpenRouter" };

  const sub = $derived(
    isKey
      ? (HTTP_LABELS[p.httpProvider ?? ""] ?? p.httpProvider ?? "")
      : p.kind === "cli_acp"
        ? [p.command, ...(p.args ?? [])].join(" ")
        : multi
          ? p.configDir || "default folder"
          : "",
  );

  // ---- Edits: the name and, for Claude and Codex, the login folder ----
  let draftLabel = $state("");
  let draftDir = $state("");
  $effect(() => {
    const x = p;
    untrack(() => {
      draftLabel = providerLabel(x);
      draftDir = x.configDir ?? "";
    });
  });
  // An ACP agent's env values never come back from the server, so saving would drop them.
  const locked = $derived(p.kind === "cli_acp" && !!p.envKeys?.length);
  const dirty = $derived(draftLabel.trim() !== providerLabel(p) || draftDir.trim() !== (p.configDir ?? ""));
  const clash = $derived(multi && others.some((o) => o.name !== p.name && o.kind === p.kind && (o.configDir ?? "") === draftDir.trim()));
  // Yoake's terminals are sandboxed, so a login can't run in one: show the line to run on the server.
  const loginLine = $derived(signInCommand(p.kind, p.configDir));
  let copied = $state(false);
  function copyLogin() {
    void navigator.clipboard?.writeText(loginLine);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // ---- Subscription limits ----
  const limits = $derived(server?.serverStatus?.rateLimits?.[p.name]);
  const wins = $derived(limits ? windows(limits) : []);
  const now = Date.now();

  // ---- Models ----
  const models = $derived(server?.modelsByProvider[p.name] ?? []);
  const favorites = $derived(models.filter((m) => m.isFavorite));
  $effect(() => {
    if (cid && connected && !off && server && !server.modelsByProvider[p.name]) untrack(() => ensureModels(cid, p.name));
  });
  // Hidden models are kept out of the model picker. Servers have no such list, so this stays on this device.
  const hidden = $derived(app.settings.hiddenModels?.[p.name] ?? []);
  function setHidden(m: ModelInfo, hide: boolean) {
    const rest = hidden.filter((id) => id !== m.id);
    app.settings.hiddenModels = { ...app.settings.hiddenModels, [p.name]: hide ? [...rest, m.id] : rest };
  }
  let mq = $state("");
  const shownModels = $derived.by(() => {
    const n = mq.trim().toLowerCase();
    return n ? models.filter((m) => `${m.displayName ?? ""} ${m.id}`.toLowerCase().includes(n)) : models;
  });
  // The fades say there is more above or below, and go when the list is at that end.
  let fadeTop = $state(false);
  let fadeBottom = $state(false);
  function observeList(el: HTMLElement) {
    const measure = () => {
      fadeTop = el.scrollTop > 2;
      fadeBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    };
    el.addEventListener("scroll", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    measure();
    return () => (el.removeEventListener("scroll", measure), ro.disconnect());
  }

  function toggleFavorite(m: ModelInfo) {
    if (!cid || !server) return;
    const on = !m.isFavorite;
    server.setModelFavorite(p.name, m.id, on);
    setFavoriteModels(
      cid,
      p.name,
      models.map((x) => (x.id === m.id ? { ...x, isFavorite: on } : x)).filter((x) => x.isFavorite).map((x) => x.id),
    );
  }
</script>

<div class="stack">
  <header class="dhd">
    <span class="ico"><LobeIcon name={icon} size={26} /></span>
    <div class="tt">
      <h3>{title}</h3>
      <div class="sb">
        <i class="dot" class:success={!off}></i>
        <span>{isKey ? (oauth ? "Signed in with your account" : "API key stored on the server") : off ? "Off" : "On"}</span>
        {#if sub}<span>·</span><span class="mono">{sub}</span>{/if}
      </div>
    </div>
    {#if !isKey}
      <Switch checked={!off} disabled={!connected} label="Enabled" onchange={onToggle} />
    {/if}
  </header>

  {#if limits?.email || limits?.plan}
    <div class="pcard">
      <div class="prow who">
        <div class="l"><b>{limits.email ? "Signed in as" : "Plan"}</b>{#if limits.email}<span class="email">{limits.email}</span>{/if}</div>
        {#if limits.plan}<div class="c"><span class="plan">{limits.plan}</span></div>{/if}
      </div>
    </div>
  {/if}

  {#if wins.length && !off}
    <section class="sec">
      <h4>Usage</h4>
      <div class="pcard">
        {#each wins as w (w.label)}
          <div class="prow">
            <div class="l"><b>{w.label}</b>{#if w.resetsAt}<span {@attach tip(resetTitle(w.resetsAt))}>Resets {resetText(w.resetsAt, now)}</span>{/if}</div>
            <div class="c meter"><Progress value={w.pct} label={w.label} /><span class="pct">{w.pct}%</span></div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if isKey}
    <section class="sec">
      <h4>Connection</h4>
      <div class="pcard">
        <div class="prow"><div class="l"><b>Provider</b></div><div class="c">{HTTP_LABELS[p.httpProvider ?? ""] ?? p.httpProvider}</div></div>
        <div class="prow">
          <div class="l"><b>{oauth ? "Account" : "API key"}</b><span>{oauth ? "Signed in with your OpenRouter account." : "Stored on the server. To replace it, add it again under the same name, with its base URL if it had one."}</span></div>
        </div>
      </div>
    </section>
  {:else}
    <section class="sec">
      <h4>Settings</h4>
      <div class="pcard">
        <label class="pfld">
          Name
          <span class="h">What chats and pickers show. Chats keep the id.</span>
          <TextField type="text" bind:value={draftLabel} disabled={locked || !connected} />
        </label>
        {#if multi}
          <label class="pfld">
            Account folder
            <span class="h">Where this login lives. Two accounts can't share one.</span>
            <TextField type="text" bind:value={draftDir} placeholder="Default folder" disabled={!connected} />
            {#if clash}<span class="warn">Another account already uses this folder, so they'd share a login.</span>{/if}
          </label>
        {:else if p.kind === "cli_acp"}
          <div class="pfld">Command<span class="h">Runs on the server.</span><span class="mono">{sub}</span></div>
        {/if}
        {#if dirty}
          <div class="prow save">
            <span class="grow"></span>
            <Button variant="ghost" onclick={() => ((draftLabel = providerLabel(p)), (draftDir = p.configDir ?? ""))}>Reset</Button>
            <Button variant="primary" disabled={!draftLabel.trim() || locked || clash || !connected} onclick={() => onSave({ label: draftLabel.trim(), configDir: draftDir.trim() })}>Save</Button>
          </div>
        {/if}
        {#if multi}
          <div class="prow">
            <div class="l"><b>Sign-in</b><span>Run this on the server, then come back. Yoake's own terminals are sandboxed and can't sign in.</span><code class="login">{loginLine}</code></div>
            <div class="c"><Button size="sm" onclick={copyLogin}><Icon name="copy" size={13} /> {copied ? "Copied" : "Copy command"}</Button></div>
          </div>
          <div class="prow">
            <div class="l"><b>Another account</b><span>A second {group?.title ?? "login"} with its own folder.</span></div>
            <div class="c"><Button size="sm" disabled={!connected} onclick={() => onAddAccount(p.kind)}><Icon name="plus" size={13} /> Add</Button></div>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if !off && (models.length || favorites.length)}
    <section class="sec">
      <h4>Models</h4>
      <div class="mbox">
        <div class="mtools">
          <div class="msearch"><SearchInput bind:value={mq} placeholder="Search models" /></div>
          <Button size="sm" variant="ghost" disabled={!cid || !connected} onclick={() => cid && refreshModels(cid, p.name)}><Icon name="refresh" size={12} /> Refresh list</Button>
        </div>
        <div class="mwell">
          <div class="mlist" class:ft={fadeTop} class:fb={fadeBottom} {@attach observeList}>
            <div>
              {#each shownModels as m (m.id)}
                {@const off = hidden.includes(m.id)}
                <div class="mr" class:off>
                  <button type="button" class="star" class:on={m.isFavorite} aria-label={m.isFavorite ? "Unstar" : "Star"} onclick={() => toggleFavorite(m)}>
                    <Icon name={m.isFavorite ? "star-filled" : "star"} size={14} />
                  </button>
                  <span class="tx">{m.displayName ?? m.id}{#if m.displayName && m.displayName !== m.id}<code>{m.id}</code>{/if}</span>
                  <Switch checked={!off} label={off ? "Show in the model picker" : "Hide from the model picker"} onchange={(on) => setHidden(m, !on)} />
                </div>
              {:else}
                <p class="mnone">{models.length ? "No match" : "No models yet."}</p>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </section>
  {/if}

  <section class="sec">
    <div class="pcard danger">
      <div class="prow">
        <div class="l"><b>{oauth ? "Sign out" : isKey ? "Remove key" : "Remove account"}</b><span>{isKey ? (oauth ? "Chats using OpenRouter lose it until you sign in again." : "Chats using this key lose it.") : "Chats keep their history but lose this account."}</span></div>
        <div class="c"><Button size="sm" variant="danger" disabled={!connected} onclick={onRemove}>{oauth ? "Sign out" : "Remove"}</Button></div>
      </div>
    </div>
  </section>
</div>

<style>
  .dhd {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .ico {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text);
  }
  .tt {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.01em;
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
  .sb .mono {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
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
  .plan {
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-xs);
    background: var(--accent-dim);
    color: var(--accent-ink);
    font-size: 0.79rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* Blurred so a screen share doesn't leak it; hover reveals. */
  .email {
    filter: blur(5px);
    transition: filter 0.15s;
  }
  .email:hover {
    filter: none;
  }
  .meter {
    width: 11rem;
  }
  .meter :global(.progress) {
    flex: 1;
  }
  .pct {
    width: 2.3rem;
    text-align: right;
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .warn {
    font-size: var(--text-label-size);
    font-weight: 400;
    color: var(--warning);
  }
  .save {
    justify-content: flex-end;
    gap: 0.5rem;
    padding-block: 0.6rem;
  }
  .grow {
    flex: 1;
  }
  /* The list is its own rounded, darker box inside the section, not a strip of the card. */
  .mbox {
    margin: 0 1.14rem 0.4rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    overflow: clip;
  }
  .mtools {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.35rem 0.5rem 0.35rem 0.4rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .msearch {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .mwell {
    display: block;
  }
  .mlist {
    max-height: 13rem;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .mlist.ft {
    mask-image: linear-gradient(to bottom, transparent, #000 2rem);
  }
  .mlist.fb {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 2.4rem), transparent);
  }
  .mlist.ft.fb {
    mask-image: linear-gradient(to bottom, transparent, #000 2rem, #000 calc(100% - 2.4rem), transparent);
  }
  .mr {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 2.5rem;
    padding: 0.3rem 1.14rem;
  }
  .mr + .mr {
    border-top: 1px solid var(--panel-border);
  }
  .mr.off .tx {
    opacity: 0.5;
  }
  .mnone {
    margin: 0;
    padding: 1rem;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .tx {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-body-size);
  }
  .tx code {
    margin-left: 0.5rem;
    font-size: 0.79rem;
    color: var(--text-dim);
  }
  .star {
    display: inline-flex;
    padding: 0.2rem;
    background: none;
    border: 0;
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    cursor: pointer;
  }
  .star:hover {
    color: var(--text);
  }
  .star.on {
    color: var(--warning);
  }
  .danger {
    border-color: color-mix(in srgb, var(--danger) 25%, var(--panel-border));
  }
  .login {
    margin-top: 0.4rem;
    padding: 0.4rem 0.6rem;
    background: var(--wash-2);
    border-radius: var(--radius-sm);
    font-family: var(--code-font-family, ui-monospace, monospace);
    font-size: var(--text-label-size);
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
</style>

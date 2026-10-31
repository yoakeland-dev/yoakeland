<script lang="ts">
  import SheetDialog from "./SheetDialog.svelte";
  // Add a coding agent or another account of one: agent, name, folder (Claude/Codex) or command
  // (custom), then sign in. A dialog on desktop, a tall bottom sheet on phones (mobile.css).
  import { Dialog } from "bits-ui";
  import { registerProvider } from "../ipc";
  import { CLI_AGENTS, MULTI_ACCOUNT } from "../modelVendor";
  import { signInCommand, openSignInTerminal } from "../agentSignIn";
  import type { ServerState } from "../state.svelte";
  import type { CliKind } from "../types";
  import Button from "./ui/Button.svelte";
  import TextField from "./ui/TextField.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";

  let {
    open = $bindable(false),
    cid,
    server,
    initial,
    offNames = [],
  }: {
    open: boolean;
    cid: string | null;
    server: ServerState | null;
    /** Agent to start on (a CliKind or "custom"); the first step is skipped when given. */
    initial?: string;
    /** Names of accounts switched off in the list: still taken. */
    offNames?: string[];
  } = $props();

  type Step = "agent" | "name" | "folder" | "command" | "signin";
  let kind = $state<string>("");
  let step = $state<Step>("agent");
  let label = $state("");
  let folder = $state("");
  let folderTouched = $state(false);
  let commandLine = $state("");
  let envText = $state("");
  let added = $state<{ dir: string } | null>(null);
  let note = $state("");

  const providers = $derived(server?.providers ?? []);
  const custom = $derived(kind === "custom");
  const multi = $derived(MULTI_ACCOUNT.has(kind));
  const steps = $derived<Step[]>(custom ? ["agent", "name", "command"] : multi ? ["agent", "name", "folder", "signin"] : ["agent", "name"]);
  const idx = $derived(Math.max(0, steps.indexOf(step)));
  const meta = $derived(CLI_AGENTS[kind as CliKind]);

  // Reset whenever the sheet opens, jumping past the agent step when one was chosen.
  $effect(() => {
    if (!open) return;
    kind = initial ?? "";
    step = initial ? "name" : "agent";
    label = folder = commandLine = envText = note = "";
    folderTouched = false;
    added = null;
  });

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const taken = $derived(new Set([...providers.map((p) => p.name), ...offNames]));
  function uniq(base: string, first?: string) {
    if (first && !taken.has(first)) return first;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  const accountName = $derived(
    custom ? uniq(slug(label).replace(/_/g, "-") || "agent") : meta ? uniq(meta.cli, meta.defaultName) : "",
  );

  // Suggest the folder from the label until the user edits it.
  const folderBase = $derived(kind === "cli_codex" ? "~/.codex_" : "~/.claude_");
  $effect(() => {
    if (!folderTouched && step === "folder") folder = folderBase + (slug(label) || "2");
  });

  const clash = $derived(
    multi && providers.some((p) => p.kind === kind && (p.configDir ?? "").trim() === folder.trim()),
  );

  const parsedEnv = $derived(
    envText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1)] as const)
      .filter(([k]) => k),
  );

  const canNext = $derived(
    !!cid &&
      (step === "agent"
        ? !!kind
        : step === "name"
          ? !!label.trim()
          : step === "command"
            ? !!commandLine.trim()
            : true),
  );

  function pick(k: string) {
    kind = k;
    step = "name";
  }

  function register() {
    if (!cid) return false;
    const data: Record<string, unknown> = { name: accountName, kind: custom ? "cli_acp" : kind, label: label.trim(), authMethod: "manual" };
    if (multi && folder.trim()) data.configDir = folder.trim();
    if (custom) {
      // "cmd arg1 arg2": the first word is the binary, the rest its args (no quoting; use a wrapper script for odd ones).
      const [command, ...args] = commandLine.trim().split(/\s+/);
      data.command = command;
      data.args = args;
      if (parsedEnv.length) data.env = Object.fromEntries(parsedEnv);
    }
    registerProvider(cid, data);
    added = { dir: folder.trim() };
    return true;
  }

  function next() {
    if (!canNext) return;
    const to = steps[idx + 1];
    if (to === "signin") {
      register();
      step = "signin";
    } else if (to) {
      step = to;
    } else if (register()) {
      open = false;
    }
  }
  function back() {
    if (idx > 0 && step !== "signin") step = steps[idx - 1];
  }

  const command = $derived(signInCommand(kind, added?.dir));
  function openTerminal() {
    if (!server || openSignInTerminal(server, command)) return;
    note = "Open a chat first, or run it in any terminal on the server.";
  }
  function copy() {
    void navigator.clipboard?.writeText(command);
    note = "Copied.";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay agent-add-overlay" />
    <SheetDialog class="dialog-content agent-add">
      <div class="strip"><i style:width="{((idx + 1) / steps.length) * 100}%"></i></div>
      <Dialog.Close class="dialog-close agent-add-close" aria-label="Close"><Icon name="xmark" size={14} /></Dialog.Close>

      {#if step === "agent"}
        <Dialog.Title class="add-title">Add an agent</Dialog.Title>
        <div class="tiles">
          {#each Object.entries(CLI_AGENTS) as [k, m] (k)}
            {@const off = !server?.cliAvailability[k as CliKind] || (!MULTI_ACCOUNT.has(k) && providers.some((p) => p.kind === k))}
            <button type="button" class="tile" disabled={off} onclick={() => pick(k)}>
              <LobeIcon name={m.icon} size={20} />
              <span>{m.title}</span>
            </button>
          {/each}
          <button type="button" class="tile" onclick={() => pick("custom")}>
            <LobeIcon name="tool" size={20} />
            <span>Custom command</span>
          </button>
        </div>
        <p class="sub">Greyed out agents aren't installed on the server, or are already added.</p>
      {:else if step === "name"}
        <Dialog.Title class="add-title">Name it</Dialog.Title>
        <p class="sub">{custom ? "What you'll see in the model list." : multi ? `A name for this ${meta.title} account, like Work or Personal.` : `Shown in the model list as ${meta.title}.`}</p>
        <TextField type="text" bind:value={label} placeholder={custom ? "My agent" : multi ? "Work" : meta.title} autofocus onkeydown={(e) => e.key === "Enter" && next()} />
      {:else if step === "folder"}
        <Dialog.Title class="add-title">Account folder</Dialog.Title>
        <p class="sub">Keeps this login separate from your other accounts. We'll create it for you.</p>
        <TextField type="text" bind:value={folder} oninput={() => (folderTouched = true)} placeholder={folderBase + "work"} onkeydown={(e) => e.key === "Enter" && next()} />
        {#if clash}<p class="warn">Another account already uses this folder, so they'd share a login.</p>{/if}
      {:else if step === "command"}
        <Dialog.Title class="add-title">Command</Dialog.Title>
        <p class="sub">Any agent that speaks the Agent Client Protocol. It runs on the server, so it must be installed and signed in there.</p>
        <TextField type="text" bind:value={commandLine} placeholder="my-agent --acp" />
        <label class="sub" for="agent-env">Environment <span class="opt">(optional, KEY=VALUE per line)</span></label>
        <textarea id="agent-env" class="env" rows="3" bind:value={envText} placeholder="API_URL=http://localhost:8080"></textarea>
      {:else}
        <Dialog.Title class="add-title">Sign in</Dialog.Title>
        <p class="sub">Run this in a terminal on the server, then come back. yoakeland never sees the credential.</p>
        <code class="cmd">{command}</code>
        <div class="row">
          <Button type="button" variant="primary" onclick={openTerminal}><Icon name="terminal-2" size={13} /> Open terminal</Button>
          <Button type="button" onclick={copy}><Icon name="copy" size={13} /> Copy</Button>
        </div>
        {#if note}<p class="sub">{note}</p>{/if}
      {/if}

      <div class="actions">
        {#if idx > 0 && step !== "signin"}<Button type="button" variant="ghost" onclick={back}>Back</Button>{/if}
        <span class="grow"></span>
        {#if step === "signin"}
          <Button type="button" variant="primary" onclick={() => (open = false)}>Done</Button>
        {:else if step !== "agent"}
          <Button type="button" variant="primary" disabled={!canNext} onclick={next}>{idx === steps.length - 1 ? "Add" : "Next"}</Button>
        {/if}
      </div>
    </SheetDialog>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.dialog-overlay.agent-add-overlay) {
    z-index: var(--z-context-menu);
  }
  :global(.dialog-content.agent-add) {
    width: min(26rem, 92vw);
    padding: var(--space-2);
    gap: 0.7rem;
    z-index: calc(var(--z-context-menu) + 1);
    overflow-y: auto;
  }
  .strip {
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: var(--well);
  }
  .strip i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  :global(.agent-add-close) {
    position: absolute;
    top: 0.57rem;
    right: 0.57rem;
  }
  :global(.add-title) {
    margin: 0;
    font-size: var(--text-title-size);
    font-weight: 600;
  }
  .sub,
  .warn {
    margin: 0;
    font-size: var(--text-label-size);
    line-height: 1.45;
    color: var(--text-dim);
  }
  .warn {
    color: var(--warning);
  }
  .opt {
    opacity: 0.7;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: 0.43rem;
  }
  .tile {
    display: flex;
    align-items: center;
    gap: 0.57rem;
    min-height: 2.4rem;
    padding: 0.4rem 0.7rem;
    background: var(--wash-1);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    color: var(--text);
    font-size: var(--text-body-size);
    text-align: left;
  }
  .tile:not(:disabled):hover {
    background: var(--sidebar-active);
  }
  .tile:disabled {
    opacity: 0.4;
  }
  .env {
    resize: vertical;
    padding: 0.5rem 0.6rem;
    background: var(--well);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-label-size);
  }
  .cmd {
    padding: 0.6rem 0.7rem;
    background: var(--well);
    border-radius: var(--radius-md);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-label-size);
    word-break: break-all;
    user-select: all;
  }
  .row,
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .grow {
    flex: 1;
  }
  .actions {
    margin-top: 0.3rem;
  }
  @media (max-width: 700px) {
    :global(.dialog-content.agent-add) {
      min-height: 70dvh;
      z-index: calc(var(--z-sheet) + 2) !important;
    }
    :global(.dialog-overlay.agent-add-overlay) {
      z-index: calc(var(--z-sheet) + 1) !important;
    }
    .actions {
      margin-top: auto;
    }
    .tile {
      min-height: 2.9rem;
    }
  }
</style>

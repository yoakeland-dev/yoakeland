<script lang="ts">
  // The "Add provider" page of Settings > Providers: CLIs found on the server and the ACP registry
  // (AddProvider), then API keys. OpenRouter can be added two ways: pasting a key, or signing in from
  // the desktop app (openrouter_oauth_*, SPEC.md §3.1).
  import { registerProvider, signInOpenRouter, cancelOpenRouterSignIn } from "../../ipc";
  import type { AgentGroup } from "../../modelVendor";
  import { isDesktop } from "../../platform";
  import type { ServerState } from "../../state.svelte";
  import AddProvider from "../AddProvider.svelte";
  import Button from "../ui/Button.svelte";
  import TextField from "../ui/TextField.svelte";
  import Dropdown from "../Dropdown.svelte";
  import LobeIcon from "../LobeIcon.svelte";
  import Icon from "../Icon.svelte";

  let {
    cid,
    server,
    connected,
    groups,
    taken,
    onAddAccount,
    onAdded,
    onAddedKey,
  }: {
    cid: string | null;
    server: ServerState | null;
    connected: boolean;
    groups: AgentGroup[];
    taken: Set<string>;
    onAddAccount: (kind: string) => void;
    /** The group key the new agent will appear under. */
    onAdded: (key: string) => void;
    onAddedKey: (name: string) => void;
  } = $props();

  let keyName = $state("");
  let httpProvider = $state<"anthropic" | "openai" | "openrouter">("anthropic");
  let apiKey = $state("");
  let baseUrl = $state("");
  let keyForm = $state<HTMLElement>();

  function submitKey(e: Event) {
    e.preventDefault();
    if (!cid || !keyName.trim()) return;
    const name = keyName.trim();
    registerProvider(cid, { name, kind: "api_key", httpProvider, apiKey, baseUrl: baseUrl || undefined, authMethod: "manual" });
    keyName = apiKey = baseUrl = "";
    onAddedKey(name);
  }

  const OPENROUTER_ACCOUNT = "openrouter-oauth";
  let orStatus = $state<"idle" | "waiting" | "finishing">("idle");
  let orError = $state("");
  const orAccount = $derived(server?.providers.find((p) => p.httpProvider === "openrouter" && p.authMethod === "oauth"));
  async function signInOR() {
    if (!cid) return;
    orError = "";
    orStatus = "waiting";
    try {
      await signInOpenRouter(cid, OPENROUTER_ACCOUNT);
      orStatus = "finishing";
      onAddedKey(OPENROUTER_ACCOUNT);
      // provider_registered ends this (see the effect below); a failed exchange only shows up in the log.
      setTimeout(() => {
        if (orStatus !== "finishing") return;
        orStatus = "idle";
        orError = "Sign-in failed. The server log has the reason.";
      }, 20_000);
    } catch (e) {
      // Cancel resets to idle first, so only a real failure still reads "waiting" here.
      if (orStatus === "waiting") orError = e instanceof Error ? e.message : String(e);
      orStatus = "idle";
    }
  }
  function cancelOR() {
    orStatus = "idle";
    void cancelOpenRouterSignIn();
  }
  $effect(() => {
    if (orAccount && orStatus !== "idle") orStatus = "idle";
  });
</script>

<div class="stack">
  <header class="dhd">
    <div class="tt">
      <h3>Add provider</h3>
      <div class="sb">Pick something found on the server, or connect another.</div>
    </div>
  </header>

  <AddProvider {cid} {server} {connected} {groups} {taken} {onAddAccount} onAddKey={() => keyForm?.scrollIntoView({ behavior: "smooth", block: "start" })} {onAdded} />

  <section class="sec" bind:this={keyForm}>
    <h4>API key</h4>
    <p class="sd">Keys are stored on the server.</p>
    <div class="pcard">
      {#if isDesktop && !orAccount}
        <div class="prow">
          <span class="ico"><LobeIcon name="openrouter" size={18} /></span>
          <div class="l">
            <b>OpenRouter</b>
            {#if orError}<span class="warn"><Icon name="warning" size={11} /> {orError}</span>
            {:else if orStatus === "waiting"}<span>Finish in your browser…</span>
            {:else if orStatus === "finishing"}<span>Finishing…</span>
            {:else}<span>Sign in with your account instead of pasting a key.</span>{/if}
          </div>
          <div class="c">
            {#if orStatus === "idle"}
              <Button size="sm" disabled={!connected} onclick={signInOR}>Sign in</Button>
            {:else}
              <Button size="sm" variant="ghost" onclick={cancelOR}>Cancel</Button>
            {/if}
          </div>
        </div>
      {/if}
      <form class="kform" onsubmit={submitKey}>
        <label>Name <TextField type="text" bind:value={keyName} placeholder="my-anthropic" /></label>
        <label>
          Provider
          <Dropdown
            items={[
              { value: "anthropic", label: "Anthropic" },
              { value: "openai", label: "OpenAI-compatible" },
              { value: "openrouter", label: "OpenRouter" },
            ]}
            bind:value={() => httpProvider, (v) => (httpProvider = v as typeof httpProvider)}
            contentClass="above-modal"
          />
        </label>
        <label>API key <TextField bind:value={apiKey} type="password" placeholder="sk-…" /></label>
        <label>Base URL <span class="opt">(optional)</span><TextField type="text" bind:value={baseUrl} placeholder="http://localhost:11434/v1" /></label>
        <div class="act"><Button variant="primary" type="submit" disabled={!connected || !keyName.trim() || !apiKey.trim()}>Add key</Button></div>
      </form>
    </div>
  </section>
</div>

<style>
  .dhd h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .sb {
    margin-top: 0.15rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .ico {
    display: inline-flex;
    flex-shrink: 0;
  }
  .warn {
    color: var(--warning);
  }
  .kform {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.86rem 1rem;
    padding: 0.86rem 1.14rem;
  }
  .kform label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .opt {
    font-weight: 400;
    opacity: 0.8;
  }
  .act {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
  }
  @media (max-width: 700px) {
    .kform {
      grid-template-columns: 1fr;
    }
  }
</style>

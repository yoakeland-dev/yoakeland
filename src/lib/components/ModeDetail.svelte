<script lang="ts">
  // What one mode does on this chat's provider: the words, the read/edit/run/web policy, and
  // who enforces it. The picker shows one of these at a time.
  import { tip } from "../tooltip.svelte";
  import { modeHint } from "../modes";
  import { cliMeta } from "../modelVendor";
  import type { ChatMode, ModeSpec, ProviderInfo } from "../types";

  // unsandboxed: this project has no isolation, so yoakeland's own bash is unprotected (shellOff: withheld).
  let { mode, spec, cli, unsandboxed = false, shellOff = false }: { mode: ChatMode; spec?: ModeSpec; cli?: ProviderInfo; unsandboxed?: boolean; shellOff?: boolean } = $props();

  const CELLS = [
    ["read", "Read"],
    ["edit", "Edit"],
    ["run", "Run"],
    ["network", "Web"],
  ] as const;
  const WORD = { allow: "without asking", ask: "asks first", deny: "not allowed", auto: "its reviewer decides" };

  const agent = $derived(cli ? cliMeta(cli).title : "");
  // The one provider-specific line: how it is backed, or how the plan gets made.
  const note = $derived.by(() => {
    if (!cli || !spec) return "";
    if (mode === "plan") return spec.plan === "native" ? `${agent}'s own plan mode` : spec.plan === "emulated" ? `${agent} is asked to plan` : "";
    if (spec.enforcedBy === "yoakeland") return `${agent} has no matching mode; yoakeland enforces this one`;
    return spec.native ? `${agent}: ${spec.native}` : "";
  });
</script>

<div class="detail">
  <p class="hint">{modeHint(mode, spec)}</p>
  {#if spec && mode !== "plan"}
    <div class="strip">
      {#each CELLS as [key, label] (key)}
        {#if key === "run" && shellOff && spec.policy.run !== "deny"}
          <span class="cell deny danger" {@attach tip("Run: turned off, this project has no sandbox")}><i></i>Run: off</span>
        {:else if key === "run" && unsandboxed && spec.policy.run !== "deny"}
          <span class="cell danger" {@attach tip(`Run: ${WORD[spec.policy.run]}, but with no sandbox it can touch anything on this machine`)}><i></i>Run: no sandbox</span>
        {:else}
          <span class={`cell ${spec.policy[key]}`} {@attach tip(`${label}: ${WORD[spec.policy[key]]}`)}><i></i>{label}</span>
        {/if}
      {/each}
    </div>
  {/if}
  {#if note}<p class="note">{note}</p>{/if}
</div>

<style>
  .detail {
    padding: 0.14rem 0.57rem 0.43rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-height: 3.6rem;
  }
  .hint {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--text);
  }
  .note {
    margin: 0;
    font-size: 0.68rem;
    color: var(--text-dim);
  }
  /* Filled: free. Half: asks. Empty and faint: not allowed. */
  .strip {
    display: flex;
    gap: 0.75rem;
  }
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.68rem;
    color: var(--text-dim);
  }
  .cell i {
    width: 0.52rem;
    height: 0.52rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }
  .cell.allow i {
    background: currentColor;
  }
  .cell.ask i {
    background: linear-gradient(90deg, currentColor 50%, transparent 50%);
  }
  /* Auto: a dot in a ring, decided case by case. */
  .cell.auto i {
    background: radial-gradient(circle, currentColor 32%, transparent 36%);
  }
  .cell.deny {
    opacity: 0.4;
  }
  /* Run with no sandbox around it: red, and not dimmed even when it would ask first. */
  .cell.danger {
    color: var(--danger);
    font-weight: 600;
  }
  .cell.danger.deny {
    opacity: 0.75;
  }
</style>

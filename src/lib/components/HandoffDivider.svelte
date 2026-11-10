<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import type { ModelRef } from "../handoff";
  import { vendorMetaFor, titleFor, isCli, cliMeta, providerLabel, type Entry } from "../modelVendor";
  import { describeProvider } from "../forwarding";
  import LobeIcon from "./LobeIcon.svelte";
  import Icon from "./Icon.svelte";

  // Where the chat changed models: the first message sent with the new one (see handoff.ts).
  // Each side is the model's logo and name. When both read the same (one model through two
  // providers, or two logins of one agent) each also says where it ran, else the line would
  // read "Sonnet -> Sonnet".
  let { from, to }: { from: ModelRef; to: ModelRef } = $props();

  function side(ref: ModelRef) {
    const providers = app.active?.providers ?? [];
    const { info: provider, models, label, serverName } = describeProvider(app, app.active, ref.provider);
    // A provider removed since: the model id stands in, with no logo of its own.
    if (!provider) return { icon: "openrouter", title: ref.model, via: ref.provider };
    const model = models.find((m) => m.id === ref.model) ?? { id: ref.model };
    const entry: Entry = { provider, model };
    const accounts = isCli(provider) ? providers.filter((p) => p.kind === provider.kind && p.command === provider.command).length : 1;
    const via = serverName ? `${label} · ${serverName}` : !isCli(provider) ? providerLabel(provider) : accounts > 1 ? `${cliMeta(provider).title} · ${providerLabel(provider)}` : cliMeta(provider).title;
    return { icon: vendorMetaFor(entry).icon, title: titleFor(entry), via };
  }

  const a = $derived(side(from));
  const b = $derived(side(to));
  const sameName = $derived(a.title === b.title || from.model === to.model);
  const tipText = $derived(
    sameName ? `Same model, now through ${b.via} instead of ${a.via}` : "The new model reads the conversation above, and answers from here on",
  );
</script>

<div class="handoff" {@attach tip(tipText)}>
  <span class="label">
    Context handed off
    <span class="side"><LobeIcon name={a.icon} fallback="openrouter" size={12} />{a.title}{#if sameName}<span class="via">{a.via}</span>{/if}</span>
    <Icon name="arrow-right" size={12} />
    <span class="side"><LobeIcon name={b.icon} fallback="openrouter" size={12} />{b.title}{#if sameName}<span class="via">{b.via}</span>{/if}</span>
  </span>
</div>

<style>
  /* Same quiet dashed rule as a compaction: about the context, not a message. */
  .handoff {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .handoff::before,
  .handoff::after {
    content: "";
    flex: 1;
    border-top: 1px dashed var(--panel-border);
  }
  .label {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.35rem;
    padding: 0.14rem 0.43rem;
  }
  .side {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    color: var(--text);
  }
  .via {
    color: var(--text-dim);
  }
  .via::before {
    content: "· ";
  }
</style>

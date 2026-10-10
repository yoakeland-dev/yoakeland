<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Subscription usage (SPEC.md §2a status.rateLimits). Clicking a card pins it to the collapsed
  // view (settings.usageFocus); with nothing pinned, the most-used one shows.
  import { Popover } from "bits-ui";
  import { app } from "../state.svelte";
  import { level, limitCards, resetText, resetTitle, updated, type Card } from "../rateLimits";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  let open = $state(false);

  // One login shared by several remotes reports identical numbers; show it once with every
  // remote stacked. ponytail: no account id on the wire, so matching usage is the proxy.
  const cards = $derived.by(() => {
    const out: (Card & { ids: string[]; srvs: Card["srv"][] })[] = [];
    for (const c of limitCards(Object.values(app.servers))) {
      const sig = (x: Card) => JSON.stringify([x.title, x.plan, x.windows]);
      const same = c.windows.length ? out.find((o) => sig(o) === sig(c)) : undefined;
      if (same) same.ids.push(c.id), same.srvs.push(c.srv);
      else out.push({ ...c, ids: [c.id], srvs: [c.srv] });
    }
    return out;
  });
  const focused = $derived(
    cards.find((c) => c.ids.includes(app.settings.usageFocus)) ??
      [...cards].sort((a, b) => (b.peak?.pct ?? -1) - (a.peak?.pct ?? -1))[0],
  );

  function focus(c: Card) {
    app.settings.usageFocus = c.id;
    app.applySettings();
    open = false;
  }
</script>

{#if focused}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="sb-trigger"
      {@attach tip(`${focused.title} usage${focused.peak ? `: ${focused.peak.label} ${focused.peak.pct}%` : ""}`)}
      aria-label="Subscription usage"
    >
      {#if focused.icon}<LobeIcon name={focused.icon} size={12} />{/if}
      {#if focused.peak}
        <span class="sb-level {level(focused.peak.pct)}">{focused.peak.short} {focused.peak.pct}%</span>
        <span class="sb-bar mini"><span class="sb-fill {level(focused.peak.pct)}" style="width: {Math.min(focused.peak.pct, 100)}%"></span></span>
      {:else}
        <span>{focused.title}</span>
      {/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content class="sb-panel usage-panel" side="top" align="end" sideOffset={8}>
        <div class="sb-cards">
          {#each cards as c (c.id)}
            <button
              type="button"
              class="sb-card"
              class:selected={c.id === focused.id}
              aria-pressed={c.id === focused.id}
              {@attach tip(c.id === focused.id ? "Shown in the status bar" : "Show in the status bar")}
              onclick={() => focus(c)}
            >
              <span class="sb-card-head">
                <span class="sb-mark">{#if c.icon}<LobeIcon name={c.icon} size={14} />{/if}</span>
                <span class="title-row">
                  <span class="sb-card-title">{c.title}</span>
                  {#if c.plan}<span class="plan">{c.plan}</span>{/if}
                </span>
                {#if c.updatedAt}
                  <span class="age" {@attach tip(`Updated ${updated(c.updatedAt, app.now)}`)}>
                    <Icon name="clock" size={11} />{updated(c.updatedAt, app.now)}
                  </span>
                {/if}
                <span class="stack" {@attach tip(c.srvs.map((s) => s.label).join(", "))}>
                  {#each c.srvs as s (s.connectionId)}
                    <span class="srv"><ServerAvatar name={s.label} seed={s.serverId} size={14} /></span>
                  {/each}
                </span>
              </span>
              <span class="wins">
                {#each c.windows as w (w.label)}
                  <span class="wname">{w.label}</span>
                  <span class="sb-bar"><span class="sb-fill {level(w.pct)}" style="width: {Math.min(w.pct, 100)}%"></span></span>
                  <span class="sb-value {level(w.pct)}">{w.pct}%</span>
                  <span class="reset" {@attach tip(w.resetsAt ? resetTitle(w.resetsAt) : undefined)}>{w.resetsAt ? resetText(w.resetsAt, app.now) : ""}</span>
                {:else}
                  <span class="sb-meter-note none">No plan limits on this login</span>
                {/each}
              </span>
            </button>
          {/each}
        </div>
        <div class="sb-foot">
          <span class="sb-foot-title">Subscription usage</span>
          {#if !app.showUsage}
            <button type="button" class="sb-foot-btn" onclick={() => ((app.showUsage = true), (open = false))}>
              <Icon name="chart-bar" size={12} /> Usage page
            </button>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  /* One column of compact cards: one line per window, so a long provider
     list stays a short scroll. */
  :global(.usage-panel) {
    width: min(23rem, 92vw);
  }
  :global(.usage-panel .sb-cards) {
    grid-template-columns: 1fr;
    gap: 0.14rem;
  }
  :global(.usage-panel .sb-card) {
    gap: 0.5rem;
    padding: 0.36rem 0.5rem;
  }
  .wins {
    display: grid;
    grid-template-columns: minmax(0, 6.5rem) 1fr auto 4rem;
    align-items: center;
    gap: 0.36rem 0.57rem;
    font-size: 0.7rem;
  }
  .wname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wins .sb-value {
    min-width: 2.2rem;
  }
  .reset {
    font-size: 0.64rem;
    color: var(--text-dim);
    text-align: right;
    white-space: nowrap;
  }
  .none {
    grid-column: 1 / -1;
  }
  .plan {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .title-row {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 0.43rem;
    min-width: 0;
  }
  .plan {
    flex-shrink: 0;
    font-size: 0.6rem;
    color: var(--text-dim);
  }
  .age {
    display: inline-flex;
    align-items: center;
    gap: 0.21rem;
    flex-shrink: 0;
    font-size: 0.64rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .stack {
    display: inline-flex;
    flex-shrink: 0;
  }
  .srv {
    display: inline-flex;
    border-radius: 28%;
    box-shadow: 0 0 0 1.5px var(--float-bg);
  }
  .srv + .srv {
    margin-left: -4px;
  }
</style>

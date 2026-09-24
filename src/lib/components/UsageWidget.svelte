<script lang="ts">
  // Subscription usage (SPEC.md §2a status.rateLimits). Clicking a card pins it to the collapsed
  // view (settings.usageFocus); with nothing pinned, the most-used one shows.
  import { Popover } from "bits-ui";
  import { app, type ConnectionId, type ServerState } from "../state.svelte";
  import { relTime } from "../format";
  import { CLI_AGENTS } from "../modelVendor";
  import type { CliKind, ProviderRateLimits, RateWindow } from "../types";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import ServerAvatar from "./ServerAvatar.svelte";

  interface Win {
    label: string;
    short: string;
    pct: number;
    resetsAt?: string;
  }
  interface Card {
    id: string;
    cid: ConnectionId;
    srv: ServerState;
    title: string;
    icon: string;
    plan?: string;
    updatedAt?: string;
    windows: Win[];
    peak?: Win;
  }

  let open = $state(false);

  function span(mins: number | undefined): { label: string; short: string } {
    if (!mins) return { label: "Limit", short: "" };
    if (mins === 7 * 1440) return { label: "Weekly", short: "7d" };
    if (mins % 1440 === 0) return { label: `${mins / 1440}-day`, short: `${mins / 1440}d` };
    if (mins % 60 === 0) return { label: `${mins / 60}-hour`, short: `${mins / 60}h` };
    return { label: `${mins}-min`, short: `${mins}m` };
  }
  function toWin(w: RateWindow, mins: number | undefined): Win {
    const s = span(mins);
    return {
      label: w.label ? `${s.label} · ${w.label}` : s.label,
      short: w.label ? `${w.label} ${s.short}` : s.short,
      pct: Math.round(w.usedPct),
      resetsAt: w.resetsAt || undefined,
    };
  }
  function windows(rl: ProviderRateLimits): Win[] {
    return [
      ...(rl.fiveHour ? [toWin(rl.fiveHour, 300)] : []),
      ...(rl.sevenDay ? [toWin(rl.sevenDay, 7 * 1440)] : []),
      ...(rl.other ?? []).map((w) => toWin(w, w.windowMins)),
    ];
  }

  const multiServer = $derived(Object.keys(app.servers).length > 1);
  const cards = $derived.by(() => {
    const out: Card[] = [];
    for (const srv of Object.values(app.servers)) {
      for (const [name, rl] of Object.entries(srv.serverStatus?.rateLimits ?? {})) {
        const agent = CLI_AGENTS[rl.kind as CliKind];
        // Older servers don't send `kind`; fall back to one card per name.
        const id = `${srv.serverId ?? srv.connectionId}:${rl.kind ?? name}`;
        if (out.some((c) => c.id === id)) continue;
        const ws = windows(rl);
        out.push({
          id,
          cid: srv.connectionId,
          srv,
          title: agent?.title ?? name,
          icon: agent?.icon ?? "",
          plan: rl.plan,
          updatedAt: rl.updatedAt,
          windows: ws,
          peak: ws.reduce<Win | undefined>((a, w) => (!a || w.pct > a.pct ? w : a), undefined),
        });
      }
    }
    return out;
  });
  const focused = $derived(
    cards.find((c) => c.id === app.settings.usageFocus) ??
      [...cards].sort((a, b) => (b.peak?.pct ?? -1) - (a.peak?.pct ?? -1))[0],
  );

  const level = (pct: number) => (pct >= 100 ? "full" : pct >= 80 ? "hot" : "");

  // Short enough to share a line with the window's name: "in 2h 14m", "in 3d 4h".
  function resetText(iso: string, now: number): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const mins = Math.round((t - now) / 60000);
    if (mins <= 0) return "resetting";
    if (mins < 60) return `in ${mins}m`;
    if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  }
  const resetTitle = (iso: string) => `Resets ${new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  function updated(iso: string, now: number): string {
    const r = relTime(iso, now);
    return r === "now" ? "just now" : `${r} ago`;
  }

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
      title={`${focused.title} usage${focused.peak ? ` — ${focused.peak.label} ${focused.peak.pct}%` : ""}`}
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
      <Popover.Content class="sb-panel" side="top" align="end" sideOffset={8}>
        <div class="sb-cards">
          {#each cards as c (c.id)}
            <button
              type="button"
              class="sb-card"
              class:selected={c.id === focused.id}
              aria-pressed={c.id === focused.id}
              title={c.id === focused.id ? "Shown in the status bar" : "Show in the status bar"}
              onclick={() => focus(c)}
            >
              <span class="sb-card-head">
                <span class="sb-mark">{#if c.icon}<LobeIcon name={c.icon} size={18} />{/if}</span>
                <span class="sb-who">
                  <span class="sb-card-title">{c.title}</span>
                  <span class="sb-card-sub">
                    {#if c.plan}<span class="plan">{c.plan}</span>{/if}
                    {#if c.updatedAt}<span>{updated(c.updatedAt, app.now)}</span>{/if}
                  </span>
                </span>
                {#if multiServer}<ServerAvatar name={c.srv.label} seed={c.srv.serverId} size={14} />{/if}
                {#if c.id === focused.id && cards.length > 1}<span class="pin"><Icon name="pinned" size={12} /></span>{/if}
              </span>
              <span class="sb-rows">
                {#each c.windows as w (w.label)}
                  <span class="sb-meter">
                    <span class="sb-meter-top">
                      <span class="sb-meter-name">{w.label}</span>
                      {#if w.resetsAt}<span class="sb-meter-note" title={resetTitle(w.resetsAt)}>{resetText(w.resetsAt, app.now)}</span>{/if}
                    </span>
                    <span class="sb-meter-row">
                      <span class="sb-bar"><span class="sb-fill {level(w.pct)}" style="width: {Math.min(w.pct, 100)}%"></span></span>
                      <span class="sb-value {level(w.pct)}">{w.pct}%</span>
                    </span>
                  </span>
                {:else}
                  <span class="sb-meter-note">No plan limits on this login</span>
                {/each}
              </span>
            </button>
          {/each}
        </div>
        <div class="sb-foot">
          <span class="sb-foot-title">Subscription usage</span>
          <button type="button" class="sb-foot-btn" onclick={() => ((app.showUsage = true), (open = false))}>
            <Icon name="chart-bar" size={12} /> Usage page
          </button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  .plan {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pin {
    display: flex;
    color: var(--text-dim);
  }
  .plan + span::before {
    content: "·";
    margin-right: 0.36rem;
    color: var(--text-dim);
  }
</style>

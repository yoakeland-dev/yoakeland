<script module lang="ts">
  import type { UsageReport } from "../usage";

  // Kept across visits, so reopening the page shows the last numbers while they refresh.
  interface Fetched {
    report?: UsageReport;
    error?: string;
    loading: boolean;
  }
  const fetched = $state<Record<string, Fetched>>({});
</script>

<script lang="ts">
  // The usage page (SPEC.md §3.1 get_usage): every server's yoakeland chats plus what the CLI
  // agents recorded on that machine themselves, windowed and broken down in local time.
  // Provider things wear the provider's brand color; everything else the theme accent.
  // The overview stays short; clicking a provider or row drills in for the details.
  import { app, type ServerState } from "../state.svelte";
  import { getUsage, openChatSession } from "../ipc";
  import { basename, sessionTitle } from "../format";
  import { CLI_AGENTS, titleFor } from "../modelVendor";
  import type { CliKind } from "../types";
  import { tip } from "../tooltip.svelte";
  import { level, limitCards, resetText, resetTitle, type Card } from "../rateLimits";
  import {
    BRANDS,
    bucketOf,
    delta,
    flatten,
    fmtCount,
    fmtDuration,
    fmtMetric,
    fmtUsd,
    groupBy,
    isSubscription,
    makeWindow,
    metricOf,
    modelBrand,
    providerBrand,
    shade,
    sum,
    weekHourGrid,
    type Brand,
    type Metric,
    type Period,
    type Totals,
    type UsageAccount,
    type UsageRec,
  } from "../usage";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import LobeIcon from "./LobeIcon.svelte";
  import UsageChart, { type Series } from "./usage/UsageChart.svelte";
  import UsageHeatmap from "./usage/UsageHeatmap.svelte";

  type Group = "provider" | "model" | "project" | "server";
  type Tab = "model" | "project" | "chat" | "server" | "time";

  const PERIODS: { value: Period; label: string }[] = [
    { value: "24h", label: "24 hours" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
    { value: "all", label: "All time" },
  ];
  const METRICS: { value: Metric; label: string }[] = [
    { value: "cost", label: "Cost" },
    { value: "tokens", label: "Tokens" },
    { value: "requests", label: "Requests" },
  ];
  const SOURCE_LABEL = { claude_code: "Claude Code", codex: "Codex CLI" } as const;
  const SLOTS = 5;
  const PAGE = 10;
  const ALL_SERVERS = "*";

  // --- Preferences (per viewer, best-effort) ---
  const PREFS_KEY = "yoake.usagePage";
  function loadPrefs(): { period: Period; metric: Metric; tab: Tab; yoakeOnly: boolean } {
    const d = { period: "30d" as Period, metric: "cost" as Metric, tab: "model" as Tab, yoakeOnly: false };
    try {
      const p = { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
      // Tabs from older versions of this page.
      if (!["model", "project", "chat", "server", "time"].includes(p.tab)) p.tab = "model";
      return p;
    } catch {
      return d;
    }
  }
  const prefs = loadPrefs();
  let period = $state<Period>(prefs.period);
  let metric = $state<Metric>(prefs.metric);
  let tab = $state<Tab>(prefs.tab);
  let yoakeOnly = $state(prefs.yoakeOnly);
  $effect(() => {
    const p = { period, metric, tab, yoakeOnly };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      // best-effort only
    }
  });
  let serverFilter = $state<string | null>(null);
  let drill = $state<{ dim: Group; key: string; label: string } | null>(null);
  let page = $state(0);
  // Any change to what the table lists starts it over at the first page.
  $effect(() => {
    void [tab, metric, period, drill?.dim, serverFilter, yoakeOnly];
    page = 0;
  });
  let moreProviders = $state(false);

  // --- Fetching ---
  const keyOf = (s: ServerState) => s.serverId ?? s.connectionId;
  const connected = $derived(Object.values(app.servers).filter((s) => s.connectionStatus === "connected"));
  const serverByKey = (k: string) => Object.values(app.servers).find((s) => keyOf(s) === k);

  async function load(srv: ServerState) {
    const k = keyOf(srv);
    const cur = fetched[k];
    if (cur?.loading) return;
    fetched[k] = { ...cur, loading: true };
    try {
      const r = await getUsage(srv.connectionId);
      fetched[k] = r.error ? { ...fetched[k], error: r.error, loading: false } : { report: r, loading: false };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      fetched[k] = {
        ...fetched[k],
        loading: false,
        error: msg.includes("no reply") ? "isn't reporting usage yet. Update yoakeland there to see it." : msg,
      };
    }
  }
  const refreshAll = () => connected.forEach((s) => void load(s));

  // Refetch a server when its status ping says a turn finished (activeTurns/spend moved),
  // or when it (re)connects. The server caches parsed files, so a repeat scan is cheap.
  const seen = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  $effect(() => {
    for (const s of connected) {
      const k = keyOf(s);
      const sig = `${s.connectionId}|${s.serverStatus?.activeTurns ?? ""}|${s.serverStatus?.spend?.todayUsd ?? ""}`;
      const prev = seen.get(k);
      seen.set(k, sig);
      if (prev === sig) continue;
      clearTimeout(timers.get(k));
      timers.set(k, setTimeout(() => void load(s), prev === undefined ? 0 : 1500));
    }
  });
  $effect(() => () => timers.forEach(clearTimeout));

  // --- Records ---
  const allRecs = $derived.by(() => {
    const out: UsageRec[] = [];
    for (const [k, f] of Object.entries(fetched)) if (f.report) out.push(...flatten(k, f.report));
    return out;
  });
  const serversWithData = $derived([...new Set(allRecs.map((r) => r.server))]);
  const multiServer = $derived(serversWithData.length > 1);
  const hasExternal = $derived(allRecs.some((r) => r.source));
  const pool = $derived(allRecs.filter((r) => (!serverFilter || r.server === serverFilter) && (!yoakeOnly || !r.source)));
  const firstAt = $derived(pool.length ? Math.min(...pool.map((r) => r.t)) : undefined);
  const reports = $derived(Object.entries(fetched).filter(([k, f]) => f.report && (!serverFilter || k === serverFilter)));
  const deleted = $derived(
    reports.reduce((a, [, f]) => ({ usd: a.usd + f.report!.deleted.costUsd, n: a.n + f.report!.deleted.sessions }), { usd: 0, n: 0 }),
  );

  const provKey = (r: UsageRec) => `${r.server}\0${isSubscription(r.kind) ? r.kind : r.provider}`;
  const dimKey: Record<Group, (r: UsageRec) => string> = {
    provider: provKey,
    model: (r) => r.model,
    project: (r) => `${r.server}\0${r.project}`,
    server: (r) => r.server,
  };
  const scoped = $derived(drill ? pool.filter((r) => dimKey[drill!.dim](r) === drill!.key) : pool);
  const win = $derived(makeWindow(period, app.now, firstAt));
  const inWin = $derived(scoped.filter((r) => r.t >= win.start && r.t < win.end));
  const prevWin = $derived(win.prev ? scoped.filter((r) => r.t >= win.prev!.start && r.t < win.prev!.end) : null);
  const total = $derived(sum(inWin));
  const prevTotal = $derived(prevWin ? sum(prevWin) : null);

  // --- Labels ---
  function providerInfo(r: UsageRec) {
    return serverByKey(r.server)?.providers.find((p) => p.name === r.provider);
  }
  function brandOfProvider(r: UsageRec): Brand | null {
    return providerBrand({ name: r.provider, kind: r.kind, httpProvider: providerInfo(r)?.httpProvider });
  }
  function providerLabel(r: UsageRec): string {
    const base = CLI_AGENTS[r.kind as CliKind]?.title ?? r.provider;
    return multiServer ? `${base} · ${serverLabel(r.server)}` : base;
  }
  function providerIcon(r: UsageRec): string {
    const b = brandOfProvider(r);
    return CLI_AGENTS[r.kind as CliKind]?.icon ?? (b ? BRANDS[b].icon : "");
  }
  // Any provider's model list on that server may know the id's display name.
  function modelLabel(r: UsageRec): string {
    const srv = serverByKey(r.server);
    if (srv) {
      for (const provider of srv.providers) {
        const model = srv.modelsByProvider[provider.name]?.find((m) => m.id === r.model);
        if (model) return titleFor({ provider, model });
      }
    }
    return r.model;
  }
  function projectLabel(r: UsageRec): string {
    if (!r.project) return "No project";
    const srv = serverByKey(r.server);
    const name = srv?.recentProjects.includes(r.project) ? srv.projectName(r.project) : basename(r.project);
    return multiServer && srv ? `${srv.label}/${name}` : name;
  }
  const serverLabel = (k: string) => serverByKey(k)?.label ?? "Server";
  function labelFor(dim: Group, r: UsageRec): string {
    return dim === "model" ? modelLabel(r) : dim === "provider" ? providerLabel(r) : dim === "project" ? projectLabel(r) : serverLabel(r.server);
  }
  function chatTitle(r: UsageRec): string {
    if (r.source) return r.title || `${SOURCE_LABEL[r.source]} session`;
    const live = serverByKey(r.server)?.sessionById.get(r.session);
    return sessionTitle({ title: live?.title ?? r.title });
  }

  // --- Colors: by the entity's all-time rank, so a filter never repaints survivors ---
  function ranked(key: (r: UsageRec) => string): [string, UsageRec][] {
    const list = [...groupBy(allRecs, key)].map(([k, rs]) => [k, rs[0], sum(rs)] as const);
    list.sort((a, b) => b[2].usd - a[2].usd || b[2].in + b[2].out - (a[2].in + a[2].out));
    return list.map(([k, r]) => [k, r]);
  }
  /** Brand color, stepped lighter/darker when a brand has several entries. */
  function brandColors(key: (r: UsageRec) => string, brandOf: (r: UsageRec) => Brand | null): Map<string, string> {
    const out = new Map<string, string>();
    const perBrand = new Map<string, number>();
    for (const [k, r] of ranked(key)) {
      const b = brandOf(r);
      const i = perBrand.get(b ?? "") ?? 0;
      perBrand.set(b ?? "", i + 1);
      out.set(k, shade(b ? BRANDS[b].color : "var(--accent)", i));
    }
    return out;
  }
  const providerColors = $derived(brandColors(provKey, brandOfProvider));
  const modelBrandOf = (r: UsageRec) => modelBrand(r.model) ?? brandOfProvider(r);
  const modelColors = $derived(brandColors((r) => r.model, modelBrandOf));

  // The chart stacks providers; the provider list beside it is its legend. Every provider in
  // the window keeps its series (zeros when a selection leaves it out) and its place in the
  // stack, so selecting and clearing morphs the same paths instead of swapping them.
  const winAll = $derived(pool.filter((r) => r.t >= win.start && r.t < win.end));
  const series = $derived.by((): Series[] => {
    const order = ranked(provKey).map(([k]) => k);
    const keep = new Set(order.slice(0, SLOTS));
    const out = new Map<string, Series>();
    const slot = (r: UsageRec) => {
      const k = provKey(r);
      const sk = keep.has(k) ? k : "\0other";
      let s = out.get(sk);
      if (!s) {
        s = {
          key: sk,
          label: sk === k ? providerLabel(r) : "Other",
          color: sk === k ? (providerColors.get(k) ?? "var(--accent)") : "color-mix(in srgb, var(--text) 28%, transparent)",
          values: new Array(win.buckets.length).fill(0),
        };
        out.set(sk, s);
      }
      return s;
    };
    for (const r of winAll) slot(r);
    for (const r of inWin) {
      const i = bucketOf(win, r.t);
      if (i >= 0) slot(r).values[i] += metricOf(metric, r);
    }
    const rank = (s: Series) => (s.key === "\0other" ? Infinity : order.indexOf(s.key));
    return [...out.values()].sort((a, b) => rank(a) - rank(b));
  });

  // --- Providers: usage here plus what the provider itself reports ---
  interface Provider {
    key: string;
    label: string;
    icon: string;
    color: string;
    t: Totals;
    sources: { label: string; usd: number; n: number }[];
    subscription: boolean;
    limits?: Card;
    account?: UsageAccount;
    inScope: boolean;
  }
  const limits = $derived(limitCards(serverFilter ? connected.filter((s) => keyOf(s) === serverFilter) : connected));
  const accounts = $derived(reports.flatMap(([k, f]) => (f.report!.accounts ?? []).map((a) => ({ ...a, server: k }))));
  const allProviders = $derived.by((): Provider[] => {
    const byKey = groupBy(inWin, provKey);
    // Every provider with any history, so plan limits and balances show with no usage yet.
    const list: Provider[] = [];
    for (const [k, r] of ranked(provKey)) {
      if (serverFilter && r.server !== serverFilter) continue;
      const rs = byKey.get(k) ?? [];
      const srv = serverByKey(r.server);
      const lim = limits.find((c) => c.srv === srv && c.id.endsWith(`:${r.kind}`));
      const acct = accounts.find((a) => a.server === r.server && a.provider === r.provider);
      if (!rs.length && !lim && !acct) continue;
      const bySource = groupBy(rs, (x) => x.source);
      list.push({
        key: k,
        label: providerLabel(r),
        icon: providerIcon(r),
        color: providerColors.get(k) ?? "var(--accent)",
        t: sum(rs),
        sources:
          bySource.size > 1 || (bySource.size === 1 && !bySource.has(""))
            ? [...bySource].map(([s, xs]) => {
                const t = sum(xs);
                return { label: s ? SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] : "yoake", usd: t.usd, n: t.n };
              })
            : [],
        subscription: isSubscription(r.kind),
        limits: lim,
        account: acct,
        inScope: rs.length > 0,
      });
    }
    return list.sort((a, b) => metricOf(metric, b.t) - metricOf(metric, a.t));
  });
  const providers = $derived(drill ? allProviders.filter((p) => p.inScope) : allProviders);
  const shownProviders = $derived(moreProviders || providers.length <= 4 ? providers : providers.slice(0, 3));
  const drilled = $derived(drill?.dim === "provider" ? providers.find((p) => p.key === drill!.key) : undefined);
  // Every plan's limits stay listed whatever is selected (they're about now, not this slice);
  // the ones outside the selection just gray out, so the layout doesn't jump.
  const withLimits = $derived(allProviders.filter((p) => p.limits?.windows.length));

  // --- Breakdown table ---
  interface Row {
    key: string;
    label: string;
    sub?: string;
    hint?: string;
    icon?: string;
    color?: string;
    t: Totals;
    at?: number;
    sel?: boolean;
    act?: () => void;
  }
  const TABS: { value: Tab; label: string }[] = $derived([
    { value: "model", label: "Models" },
    { value: "project", label: "Projects" },
    { value: "chat", label: "Chats" },
    ...(multiServer ? [{ value: "server" as Tab, label: "Servers" }] : []),
    { value: "time", label: win.unit === "hour" ? "Hours" : win.unit === "week" ? "Weeks" : "Days" },
  ]);
  // Drilled into this tab's own dimension: list everything and gray out the rest, so the
  // selection stays in context and a click on a sibling switches to it.
  const tableRecs = $derived(
    drill && tab === drill.dim ? winAll : inWin,
  );
  const tableTotal = $derived(sum(tableRecs));
  const rows = $derived.by((): Row[] => {
    if (tab === "time") {
      const byBucket = groupBy(inWin, (r) => String(win.buckets[bucketOf(win, r.t)]));
      return win.buckets
        .map((b) => ({
          key: String(b),
          label:
            win.unit === "hour"
              ? new Date(b).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
              : (win.unit === "week" ? "Week of " : "") +
                new Date(b).toLocaleDateString([], { weekday: win.unit === "day" ? "short" : undefined, month: "short", day: "numeric" }),
          t: sum(byBucket.get(String(b)) ?? []),
          at: b,
        }))
        .filter((r) => r.t.n > 0);
    }
    if (tab === "chat") {
      return [...groupBy(inWin, (r) => `${r.server}\0${r.source}\0${r.session}`)].map(([k, rs]) => {
        const r = rs[0];
        return {
          key: k,
          label: chatTitle(r),
          sub: r.source ? `${projectLabel(r)} · ${SOURCE_LABEL[r.source]}` : projectLabel(r),
          t: sum(rs),
          at: Math.max(...rs.map((x) => x.t)),
          act: r.source ? undefined : () => openChat(r),
        };
      });
    }
    const dim = tab as Group;
    return [...groupBy(tableRecs, dimKey[dim])].map(([k, rs]) => {
      const r = rs[0];
      const label = labelFor(dim, r);
      const b = dim === "model" ? modelBrandOf(r) : null;
      // Only name the provider when more than one served the model.
      const provs = dim === "model" ? [...new Set(rs.map(providerLabel))] : [];
      return {
        key: k,
        label,
        sub: provs.length > 1 ? provs.join(", ") : undefined,
        hint: dim === "project" ? r.project || undefined : undefined,
        icon: b ? BRANDS[b].icon : undefined,
        color: dim === "model" ? modelColors.get(k) : undefined,
        t: sum(rs),
        sel: drill?.dim === dim && drill.key === k,
        act: () => (drill = drill?.dim === dim && drill.key === k ? null : { dim, key: k, label }),
      };
    });
  });
  const sortedRows = $derived(
    [...rows].sort((a, b) =>
      tab === "time" ? (b.at ?? 0) - (a.at ?? 0) : metricOf(metric, b.t) - metricOf(metric, a.t) || a.label.localeCompare(b.label),
    ),
  );
  const pages = $derived(Math.max(1, Math.ceil(sortedRows.length / PAGE)));
  const pageAt = $derived(Math.min(page, pages - 1));
  const visibleRows = $derived(sortedRows.slice(pageAt * PAGE, pageAt * PAGE + PAGE));
  const shareOf = (t: Totals) => {
    const whole = metricOf(metric, tableTotal);
    return whole > 0 ? metricOf(metric, t) / whole : 0;
  };
  const speed = (t: Totals) => (t.ms > 0 ? (t.timedOut / t.ms) * 1000 : 0);
  const anyCached = $derived(total.cached > 0);

  function openChat(r: UsageRec) {
    const srv = serverByKey(r.server);
    if (!srv) return;
    // The server forgets which project a session belongs to on restart (§4b); tell it.
    if (r.project && !srv.projectBySession[r.session]) srv.projectBySession[r.session] = r.project;
    openChatSession(srv.connectionId, r.session);
  }

  // --- Headline ---
  const status = $derived.by(() => {
    const list = connected.map((s) => fetched[keyOf(s)]);
    return {
      loading: list.some((f) => f?.loading),
      firstLoad: list.length > 0 && list.every((f) => !f?.report && !f?.error),
      errors: connected.filter((s) => fetched[keyOf(s)]?.error).map((s) => ({ label: s.label, error: fetched[keyOf(s)]!.error! })),
    };
  });
  const cap = $derived(
    connected.flatMap((s) => s.serverStatus?.budgets ?? []).find((b) => b.scope === "session" && b.period === "total")?.limitUsd,
  );
  const metricLabel = $derived(METRICS.find((m) => m.value === metric)!.label);
  const periodText = $derived(period === "24h" ? "last 24 hours" : period === "all" ? "all time" : `last ${period.replace("d", " days")}`);
  const deltaInfo = $derived.by(() => {
    if (!prevTotal) return null;
    const cur = metricOf(metric, total);
    const d = delta(cur, metricOf(metric, prevTotal));
    const before = `the previous ${period === "24h" ? "24 hours" : period.replace("d", " days")}`;
    if (d === null) return cur > 0 ? { short: "New", long: `Nothing in ${before}`, dir: 0 } : null;
    if (Math.abs(d) < 0.005) return { short: "Flat", long: `Same as ${before}`, dir: 0 };
    const pct = Math.abs(d) >= 10 ? `${Math.round(d + 1)}×` : `${Math.round(Math.abs(d) * 100)}%`;
    return { short: pct, long: `${pct} ${d > 0 ? "more" : "less"} than ${before}`, dir: d > 0 ? 1 : -1 };
  });
  const heroSub = $derived.by(() => {
    if (metric !== "cost") return `${fmtUsd(total.usd)} at API prices`;
    const plan = total.usd - total.billed;
    if (total.usd === 0) return "Nothing spent";
    if (plan <= 0.005) return "Billed to your API keys";
    if (total.billed <= 0.005) return "Covered by your plans, priced at API rates";
    return `${fmtUsd(total.billed)} billed to API keys, the rest covered by plans`;
  });
  const totalsRow = $derived([
    { label: "Chats", value: fmtCount(total.chats) },
    { label: "Requests", value: fmtCount(total.n) },
    { label: "Tokens", value: fmtCount(total.in + total.out) },
    ...(anyCached ? [{ label: "Cached input", value: fmtCount(total.cached) }] : []),
    { label: anyCached ? "Uncached input" : "Input", value: fmtCount(total.in - total.cached) },
    { label: "Output", value: fmtCount(total.out) },
  ]);
  const hasData = $derived(allRecs.length > 0);
  const fmtBal = (v: number, cur = "USD") => (cur === "USD" ? fmtUsd(v) : `${v.toFixed(2)} ${cur}`);
</script>

<div class="panel" class:sidebar-collapsed={app.sidebarCollapsed}>
  <header class="head">
    <h1 class="chrome-surface island">
      <Icon name="chart-bar" size={15} />
      {#if drill}
        <button type="button" class="crumb" onclick={() => (drill = null)} {@attach tip("Back to all usage")}>Usage</button>
        <span class="sep">/</span>
        <span class="here">{drill.label}</span>
      {:else}
        Usage
      {/if}
    </h1>
    <div class="controls">
      {#if hasExternal}
        <Dropdown
          items={[
            { value: "all", label: "All sources" },
            { value: "yoake", label: "yoake only" },
          ]}
          bind:value={() => (yoakeOnly ? "yoake" : "all"), (v) => (yoakeOnly = v === "yoake")}
          triggerTitle="All sources adds what Claude Code and Codex recorded on the server's machine outside yoakeland"
        />
      {/if}
      {#if multiServer}
        <Dropdown
          items={[{ value: ALL_SERVERS, label: "All servers" }, ...serversWithData.map((k) => ({ value: k, label: serverLabel(k) }))]}
          bind:value={() => serverFilter ?? ALL_SERVERS, (v) => ((serverFilter = v && v !== ALL_SERVERS ? v : null), (drill = null))}
        />
      {/if}
      <Dropdown items={PERIODS} bind:value={() => period, (v) => (period = (v ?? period) as Period)} />
      <Dropdown items={METRICS} bind:value={() => metric, (v) => (metric = (v ?? metric) as Metric)} />
      <button
        type="button"
        class="icon-btn"
        class:spin={status.loading}
        disabled={status.loading || connected.length === 0}
        onclick={refreshAll}
        {@attach tip("Refresh")}
        aria-label="Refresh usage"><Icon name="refresh" size={15} /></button
      >
    </div>
  </header>

  <!-- Scrolls under the header rather than the header sticking inside it: Electron drops
       no-drag regions inside a scroller, which left the header's buttons unclickable. -->
  <div class="scroll">
  <div class="body" class:stale={status.loading && hasData}>
    {#each status.errors as e (e.label)}
      <p class="notice"><Icon name="alert-circle" size={14} /> <span><strong>{e.label}</strong> {e.error}</span></p>
    {/each}

    {#if connected.length === 0 && !hasData}
      <div class="empty">
        <Icon name="server" size={22} />
        <p>Connect a server to see its usage.</p>
      </div>
    {:else if status.firstLoad}
      <div class="empty">
        <span class="spin"><Icon name="loader-2" size={22} /></span>
        <p>Reading usage…</p>
        <p class="hint">The first read goes through every chat and CLI transcript on the server.</p>
      </div>
    {:else if !hasData && status.errors.length === 0}
      <div class="empty">
        <Icon name="chart-bar" size={22} />
        <p>No usage recorded yet.</p>
        <p class="hint">Each model request shows up here once a chat has run.</p>
      </div>
    {:else if hasData}
      <section class="cols" aria-label="Overview">
        <div class="summary">
          <span class="hero-label">{metricLabel}, {periodText}</span>
          <div class="hero-row">
            <span class="hero-value">{fmtMetric(metric, metricOf(metric, total))}</span>
            {#if deltaInfo}
              <span class="delta" {@attach tip(deltaInfo.long)}>
                {#if deltaInfo.dir}<Icon name={deltaInfo.dir > 0 ? "arrow-narrow-up" : "arrow-narrow-down"} size={12} />{/if}{deltaInfo.short}
              </span>
            {/if}
          </div>
          <p class="hero-sub">{heroSub}</p>

          {#if drill && (total.ms || drilled?.sources.length || drilled?.account)}
            <dl class="details">
              {#if total.ms}
                <dt>Speed</dt>
                <dd {@attach tip(`${fmtDuration(total.ms)} generating`)}>{Math.round(speed(total))} tok/s</dd>
              {/if}
              {#each drilled?.sources ?? [] as s (s.label)}
                <dt>{s.label}</dt>
                <dd>{metric === "cost" ? fmtUsd(s.usd) : `${fmtCount(s.n)} requests`}</dd>
              {/each}
              {#if drilled?.account}
                {@const a = drilled.account}
                {#if a.error}
                  <dt>Account</dt>
                  <dd>{a.error}</dd>
                {:else}
                  {#if a.balance !== undefined}<dt>Balance</dt><dd>{fmtBal(a.balance, a.currency)}</dd>{/if}
                  {#if a.limitRemainingUsd !== undefined && a.limitUsd !== undefined}
                    <dt>Key limit</dt>
                    <dd>{fmtUsd(a.limitRemainingUsd)} of {fmtUsd(a.limitUsd)} left</dd>
                  {/if}
                  {#if a.usage}<dt>Billed</dt><dd>{fmtUsd(a.usage.day)} today · {fmtUsd(a.usage.month)} this month</dd>{/if}
                {/if}
              {/if}
            </dl>
          {/if}

          {#if !drill || providers.length > 1}
            <ul class="plist" aria-label="Providers">
              {#each shownProviders as p (p.key)}
                <li>
                  <button type="button" class="prow" onclick={() => (drill = { dim: "provider", key: p.key, label: p.label })}>
                    <span class="dot" style="background: {p.color}"></span>
                    {#if p.icon}<LobeIcon name={p.icon} size={16} />{/if}
                    <span class="pname">{p.label}</span>
                    <span class="pval" {@attach tip(p.subscription && metric === "cost" ? "What this would cost at API prices. Your plan covers it." : undefined)}
                      >{fmtMetric(metric, metricOf(metric, p.t))}</span
                    >
                  </button>
                </li>
              {/each}
            </ul>
            {#if providers.length > shownProviders.length}
              <button type="button" class="link" onclick={() => (moreProviders = true)}>{providers.length - shownProviders.length} more</button>
            {/if}
          {/if}
        </div>
        <UsageChart buckets={win.buckets} unit={win.unit} {series} {metric} />
      </section>

      <div class="cols">
        <section aria-labelledby="totals-h">
          <div class="section-head"><h2 id="totals-h">Totals</h2></div>
          <dl class="totals">
            {#each totalsRow as f (f.label)}
              <div><dt>{f.label}</dt><dd>{f.value}</dd></div>
            {/each}
          </dl>
        </section>
        {#if period !== "24h"}
          <section aria-labelledby="when-h">
            <div class="section-head">
              <h2 id="when-h">When you work</h2>
              <span class="section-sub">{metricLabel} by weekday and hour</span>
            </div>
            <UsageHeatmap grid={weekHourGrid(inWin, metric)} {metric} />
          </section>
        {/if}
      </div>

      {#if withLimits.length}
        <section aria-labelledby="limits-h">
          <h2 id="limits-h">Limits</h2>
          <ul class="limits">
            {#each withLimits as p (p.key)}
              <li style="--brand: {p.color}" class:dimmed={drill && !p.inScope}>
                <span class="lname">
                  {#if p.icon}<LobeIcon name={p.icon} size={16} />{/if}
                  {p.label}
                  {#if p.limits?.plan}<span class="plan">{p.limits.plan}</span>{/if}
                </span>
                <span class="wins">
                  {#each p.limits?.windows ?? [] as w (w.label)}
                    <span class="win">
                      <span class="wname">{w.label}</span>
                      <span class="meter" role="meter" aria-valuenow={w.pct} aria-valuemin={0} aria-valuemax={100} aria-label="{p.label} {w.label}">
                        <span class="fill {level(w.pct)}" style="width: {Math.min(w.pct, 100)}%"></span>
                      </span>
                      {#if w.pct >= 100}
                        <span class="wpct full"><Icon name="warning" size={13} /> Limit reached</span>
                      {:else}
                        <span class="wpct">{w.pct}%</span>
                      {/if}
                      {#if w.resetsAt}
                        <span class="wreset" {@attach tip(resetTitle(w.resetsAt))}>{w.pct >= 100 ? "resets " : ""}{resetText(w.resetsAt, app.now)}</span>
                      {/if}
                    </span>
                  {/each}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section aria-labelledby="breakdown-h">
        <div class="section-head">
          <h2 id="breakdown-h">Breakdown</h2>
          <div class="tabs" role="tablist" aria-label="Breakdown">
            {#each TABS as t (t.value)}
              <button type="button" role="tab" aria-selected={tab === t.value} class:active={tab === t.value} onclick={() => (tab = t.value)}>{t.label}</button>
            {/each}
          </div>
        </div>
        <div role="tabpanel">
          <table>
            <thead>
              <tr>
                <th scope="col" class="left">
                  {tab === "time" ? (win.unit === "hour" ? "Hour" : win.unit === "week" ? "Week" : "Day") : (TABS.find((t) => t.value === tab)?.label.replace(/s$/, "") ?? "")}
                </th>
                <th scope="col">{metricLabel}</th>
                <th scope="col" class="share-col">Share</th>
              </tr>
            </thead>
            <tbody>
              {#each visibleRows as r (r.key)}
                {@const share = shareOf(r.t)}
                <tr
                  class:clickable={!!r.act}
                  class:dimmed={drill?.dim === tab && !r.sel}
                  onclick={r.act}
                  onkeydown={(e) => r.act && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), r.act())}
                  tabindex={r.act ? 0 : undefined}
                >
                  <td class="name">
                    <span class="name-in">
                      {#if r.icon}<LobeIcon name={r.icon} size={15} />{/if}
                      <span class="label-stack" {@attach tip(r.hint)}>
                        <span class="label">{r.label}</span>
                        {#if r.sub}<span class="sub">{r.sub}</span>{/if}
                      </span>
                      {#if tab === "chat" && cap && r.t.usd >= cap * 0.8}
                        <span class="cap" {@attach tip(`${Math.round((r.t.usd / cap) * 100)}% of the ${fmtUsd(cap)} per-chat cap`)}><Icon name="warning" size={13} /></span>
                      {/if}
                    </span>
                  </td>
                  <td class="val" {@attach tip(metric === "tokens" ? `${fmtCount(r.t.in)} in · ${fmtCount(r.t.out)} out` : undefined)}>
                    {fmtMetric(metric, metricOf(metric, r.t))}
                  </td>
                  <td class="share-col">
                    <span class="share" style={r.color ? `--bar: ${r.color}` : ""}>
                      <span class="bar"><span style="width: {share * 100}%"></span></span>
                      <span class="pct">{share >= 0.995 ? "100" : share < 0.005 && share > 0 ? "<1" : Math.round(share * 100)}%</span>
                    </span>
                  </td>
                </tr>
              {:else}
                <tr><td class="none" colspan="3">No usage in this period</td></tr>
              {/each}
            </tbody>
          </table>
          {#if pages > 1}
            <nav class="pager" aria-label="Pages">
              <span>{pageAt * PAGE + 1}–{Math.min(sortedRows.length, (pageAt + 1) * PAGE)} of {sortedRows.length}</span>
              <button type="button" class="icon-btn" disabled={pageAt === 0} onclick={() => (page = pageAt - 1)} aria-label="Previous page"
                ><Icon name="chevron-left" size={15} /></button
              >
              <button type="button" class="icon-btn" disabled={pageAt === pages - 1} onclick={() => (page = pageAt + 1)} aria-label="Next page"
                ><Icon name="chevron-right" size={15} /></button
              >
            </nav>
          {/if}
        </div>
      </section>

      {#if period === "all" && deleted.n > 0 && !drill}
        <p class="note">
          <Icon name="info-circle" size={13} /> Plus {fmtUsd(deleted.usd)} from {deleted.n} deleted {deleted.n === 1 ? "chat" : "chats"}, which keep no dates.
        </p>
      {/if}
    {/if}
  </div>
</div>
</div>

<style>
  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-xl);
    margin: var(--chat-margin) var(--chat-margin) var(--chat-margin) 0;
    transition: margin-left calc(0.2s * var(--anim-speed, 1)) ease;
    overflow: hidden;
    color: var(--text);
  }
  .panel.sidebar-collapsed {
    margin-left: var(--chat-margin);
  }
  :global(:root[data-main="flat"]) .panel {
    border-radius: 0;
    border-width: 0 0 0 1px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.71rem;
    flex-shrink: 0;
    min-height: var(--header-line);
    padding: var(--header-pad-y) calc(var(--header-pad-x) + var(--chrome-reserve)) var(--header-pad-y) var(--chrome-inset-in-panel);
    background: var(--panel-bg);
    transition: padding calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .panel.sidebar-collapsed .head {
    padding-left: var(--toggle-reserve-in-panel);
  }
  /* Same card as the chat title's island (ChatHeader.svelte). */
  h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin: 0;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .island {
    box-sizing: border-box;
    height: var(--chrome-h);
    padding: 0 calc(var(--chrome-pad) + var(--space-1));
    margin-block: calc((var(--header-line) - var(--chrome-h)) / 2);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .crumb {
    padding: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    cursor: pointer;
  }
  .crumb:hover {
    color: var(--text);
  }
  .sep {
    color: var(--text-dim);
  }
  .here {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Held to the header line so the taller dropdowns don't push the island off the
     sidebar toggle's line. */
  .controls {
    display: flex;
    align-items: center;
    height: var(--header-line);
    gap: 0.2rem;
    margin-left: auto;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--sidebar-hover);
    color: var(--text);
  }
  .icon-btn:disabled {
    cursor: default;
  }
  .spin :global(svg) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .body {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 2.6rem;
    box-sizing: border-box;
    width: 100%;
    max-width: 64rem;
    margin: 0 auto;
    padding: 2rem var(--header-pad-x) 3rem;
    container-type: inline-size;
    transition: opacity calc(0.15s * var(--anim-speed, 1)) ease;
  }
  .body.stale {
    opacity: 0.6;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 0.43rem;
    margin: 0 0 -1.6rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .notice :global(svg) {
    flex-shrink: 0;
    color: var(--warning);
  }
  .notice strong {
    color: var(--text);
    font-weight: 600;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.36rem;
    padding: 5rem 1rem;
    color: var(--text-dim);
    text-align: center;
  }
  .empty p {
    margin: 0.3rem 0 0;
    color: var(--text);
  }
  .empty .hint {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--text-label-size);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: -1rem 0 0;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }

  /* Hero | chart, and totals | heatmap below it, on the same two columns. */
  .cols {
    display: grid;
    grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
    align-items: start;
    gap: 2rem 3rem;
  }
  @container (max-width: 44rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .summary {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .hero-label,
  .hero-sub {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .hero-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.15rem 0 0.3rem;
  }
  .hero-value {
    font-size: 2.6rem;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .delta {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--text) 7%, transparent);
    font-size: var(--text-label-size);
    white-space: nowrap;
  }
  .hero-sub {
    margin: 0.2rem 0 0;
  }
  .details {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.4rem 1rem;
    margin: 1.4rem 0 0;
    font-size: var(--text-label-size);
  }
  .details dt {
    color: var(--text-dim);
  }
  .details dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .plist {
    display: flex;
    flex-direction: column;
    margin: 1.4rem 0 0;
    padding: 0;
    list-style: none;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: calc(100% + 0.8rem);
    margin: 0 -0.4rem;
    padding: 0.4rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    font-size: var(--text-body-size);
    text-align: left;
    cursor: pointer;
  }
  .prow:hover {
    background: var(--sidebar-hover);
  }
  .dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pval {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .link {
    align-self: flex-start;
    padding: 0.3rem 0;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .link:hover {
    color: var(--text);
  }

  h2 {
    margin: 0 0 0.8rem;
    font-size: var(--text-body-size);
    font-weight: 600;
  }
  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin-bottom: 0.6rem;
  }
  .section-head h2 {
    margin: 0;
  }
  .section-sub {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 1rem 1.5rem;
    margin: 0;
  }
  .totals div {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .totals dt {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .totals dd {
    margin: 0;
    font-size: var(--text-title-size);
    font-variant-numeric: tabular-nums;
  }

  .limits {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .limits li {
    transition: opacity calc(0.25s * var(--anim-speed, 1)) ease;
    display: grid;
    grid-template-columns: minmax(0, 12rem) minmax(0, 1fr);
    align-items: center;
    gap: 0.4rem 1.5rem;
  }
  .limits li.dimmed {
    opacity: 0.4;
  }
  @container (max-width: 44rem) {
    .limits li {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .lname {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    font-size: var(--text-body-size);
  }
  .plan {
    padding: 0 0.4rem;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-pill);
    color: var(--text-dim);
    font-size: var(--text-label-size);
    text-transform: capitalize;
  }
  .wins {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 2rem;
    font-size: var(--text-label-size);
  }
  .win {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }
  .wname,
  .wreset {
    color: var(--text-dim);
  }
  .meter {
    width: 6rem;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--brand) 18%, transparent);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--brand);
  }
  .fill.hot {
    background: var(--warning);
  }
  .fill.full {
    background: var(--danger);
  }
  .wpct {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-variant-numeric: tabular-nums;
  }
  .wpct.full :global(svg) {
    color: var(--danger);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.14rem;
  }
  .tabs button {
    padding: 0.3rem 0.64rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--text);
    background: var(--sidebar-hover);
  }
  .tabs button.active {
    color: var(--text);
    background: var(--sidebar-active);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-body-size);
    font-variant-numeric: tabular-nums;
  }
  th {
    padding: 0.45rem 0.5rem;
    font-size: var(--text-label-size);
    font-weight: 400;
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
    text-align: right;
    white-space: nowrap;
  }
  th.left {
    text-align: left;
  }
  td {
    padding: 0.62rem 0.5rem;
    text-align: right;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 5%, transparent);
    white-space: nowrap;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.dimmed td {
    opacity: 0.4;
    transition: opacity calc(0.12s * var(--anim-speed, 1)) ease;
  }
  tr.dimmed:hover td {
    opacity: 0.75;
  }
  tbody tr:hover td {
    background: color-mix(in srgb, var(--text) 3%, transparent);
  }
  tr.clickable:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
    outline-offset: -2px;
  }
  td.name {
    text-align: left;
    max-width: 22rem;
    width: 45%;
  }
  .name-in {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .label-stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .cap {
    display: inline-flex;
    color: var(--warning);
  }
  .share-col {
    width: 30%;
  }
  .share {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-dim);
  }
  .bar {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--bar, var(--accent));
  }
  .pct {
    width: 2.4rem;
    text-align: right;
  }
  td.none {
    padding: 2rem 0;
    text-align: center;
    color: var(--text-dim);
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.2rem;
    margin-top: 0.6rem;
    font-size: var(--text-label-size);
    color: var(--text-dim);
  }
  .pager span {
    margin-right: 0.5rem;
    font-variant-numeric: tabular-nums;
  }
  .icon-btn:disabled :global(svg) {
    opacity: 0.35;
  }
</style>

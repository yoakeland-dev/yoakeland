// Usage page math (SPEC.md §3.1 get_usage): flattens each server's usage_report into records,
// then windows, buckets and groups them in local time. Pure, so usage.test.js can pin it.

export interface UsageReport {
  sessions: { id: string; title?: string; projectPath: string; archived?: boolean; source?: "claude_code" | "codex" }[];
  providers: { name: string; kind?: string }[];
  models: string[];
  rows: { h: number; s: number; p: number; m: number; n: number; in: number; cached?: number; out: number; usd: number; ms: number }[];
  firstAt?: string;
  deleted: { sessions: number; inputTokens: number; outputTokens: number; costUsd: number };
  accounts?: UsageAccount[];
}

/** An api_key provider's account as its own API reports it (§3.2 usage_report). */
export interface UsageAccount {
  provider: string;
  currency?: string;
  balance?: number;
  usage?: { day: number; week: number; month: number; total: number };
  limitUsd?: number;
  limitRemainingUsd?: number;
  error?: string;
  fetchedAt: string;
}

/** One (hour, chat, provider, model) cell from one server. */
export interface UsageRec {
  t: number; // ms, start of the UTC hour
  server: string; // serverId (or connectionId)
  /** "" for a yoakeland chat, else the CLI whose own transcript it came from. */
  source: "" | "claude_code" | "codex";
  session: string;
  title: string;
  project: string;
  provider: string;
  kind: string;
  model: string;
  n: number;
  in: number;
  cached: number;
  out: number;
  usd: number;
  ms: number;
}

export function flatten(server: string, r: UsageReport): UsageRec[] {
  return r.rows.map((row) => {
    const s = r.sessions[row.s];
    const p = r.providers[row.p];
    return {
      t: row.h * 1000,
      server,
      source: s?.source ?? "",
      session: s?.id ?? "",
      title: s?.title ?? "",
      project: s?.projectPath ?? "",
      provider: p?.name || "unknown",
      kind: p?.kind ?? "",
      model: r.models[row.m] || "unknown",
      n: row.n,
      in: row.in,
      cached: row.cached ?? 0,
      out: row.out,
      usd: row.usd,
      ms: row.ms,
    };
  });
}

/** CLI agents report an API-equivalent price; the subscription is what's actually paid. */
export const isSubscription = (kind: string) => kind.startsWith("cli_");

export interface Totals {
  n: number;
  in: number;
  cached: number;
  out: number;
  usd: number;
  billed: number;
  ms: number;
  /** Output tokens of requests that carry their own generation time, for tok/s. */
  timedOut: number;
  chats: number;
}

export function sum(recs: UsageRec[]): Totals {
  const t: Totals = { n: 0, in: 0, cached: 0, out: 0, usd: 0, billed: 0, ms: 0, timedOut: 0, chats: 0 };
  const chats = new Set<string>();
  for (const r of recs) {
    t.n += r.n;
    t.in += r.in;
    t.cached += r.cached;
    t.out += r.out;
    t.usd += r.usd;
    if (!isSubscription(r.kind)) t.billed += r.usd;
    // A CLI agent reports a whole turn's tokens against one round-trip's time; only
    // yoakeland's own loop times each request it counts.
    if (r.ms > 0 && !isSubscription(r.kind)) {
      t.ms += r.ms;
      t.timedOut += r.out;
    }
    chats.add(`${r.server}\0${r.session}`);
  }
  t.chats = chats.size;
  return t;
}

// --- Brands: provider things wear the provider's color, the rest the theme's ---

export const BRANDS = {
  claude: { label: "Claude", color: "#d97757", icon: "claude" },
  openai: { label: "OpenAI", color: "#10a37f", icon: "openai" },
  gemini: { label: "Gemini", color: "#4285f4", icon: "gemini" },
  deepseek: { label: "DeepSeek", color: "#4d6bfe", icon: "deepseek" },
  openrouter: { label: "OpenRouter", color: "#6566f1", icon: "openrouter" },
  mistral: { label: "Mistral", color: "#fa520f", icon: "mistral" },
  meta: { label: "Meta", color: "#0668e1", icon: "meta" },
  qwen: { label: "Qwen", color: "#615ced", icon: "qwen" },
  grok: { label: "Grok", color: "#8b8f98", icon: "grok" },
  kimi: { label: "Kimi", color: "#1a8cff", icon: "kimi" },
  cursor: { label: "Cursor", color: "#8b8f98", icon: "cursor" },
  opencode: { label: "OpenCode", color: "#8b8f98", icon: "opencode" },
  local: { label: "Local", color: "#8b8f98", icon: "lmstudio" },
} as const;
export type Brand = keyof typeof BRANDS;

const SNIFF: [Brand, RegExp][] = [
  ["openrouter", /openrouter/],
  ["claude", /claude|anthropic|opus|sonnet|haiku/],
  ["gemini", /gemini|gemma|google/],
  ["deepseek", /deepseek/],
  ["mistral", /mistral|codestral|devstral/],
  ["meta", /llama|meta-/],
  ["qwen", /qwen/],
  ["grok", /grok|x-ai|xai/],
  ["kimi", /kimi|moonshot/],
  ["openai", /gpt|codex|openai|\bo\d/],
  ["local", /lm ?studio|ollama|localhost|gguf|qat/],
];
export function sniffBrand(text: string): Brand | null {
  const t = text.toLowerCase();
  for (const [b, re] of SNIFF) if (re.test(t)) return b;
  return null;
}
const KIND_BRAND: Record<string, Brand> = {
  cli_claude: "claude",
  cli_codex: "openai",
  cli_gemini: "gemini",
  cli_deepseek: "deepseek",
  cli_kimi: "kimi",
  cli_grok: "grok",
  cli_cursor: "cursor",
  cli_opencode: "opencode",
};
/** Whose account a provider bills: the CLI's maker, else what its name says. */
export function providerBrand(p: { name: string; kind: string; httpProvider?: string }): Brand | null {
  if (KIND_BRAND[p.kind]) return KIND_BRAND[p.kind];
  if (p.httpProvider === "openrouter") return "openrouter";
  return sniffBrand(p.name) ?? (p.httpProvider === "anthropic" ? "claude" : p.httpProvider === "openai" ? "openai" : null);
}
/** Who made a model: an OpenRouter-style "vendor/model" prefix, else its name. */
export function modelBrand(model: string): Brand | null {
  const slash = model.indexOf("/");
  return (slash > 0 ? sniffBrand(model.slice(0, slash)) : null) ?? sniffBrand(model);
}

/** Steps of one color, alternating toward the text and the surface color, so they read as
 * lighter/darker in either theme. */
const STEPS: [number, string][] = [
  [0, ""],
  [45, "var(--text)"],
  [45, "var(--panel-bg)"],
  [70, "var(--text)"],
  [65, "var(--panel-bg)"],
  [22, "var(--text)"],
  [25, "var(--panel-bg)"],
  [85, "var(--text)"],
];
export function shade(color: string, i: number): string {
  const [k, toward] = STEPS[i % STEPS.length];
  return k ? `color-mix(in oklab, ${color} ${100 - k}%, ${toward})` : color;
}

export type Metric = "cost" | "tokens" | "requests";
export const metricOf = (m: Metric, t: { usd: number; in: number; out: number; n: number }) =>
  m === "cost" ? t.usd : m === "tokens" ? t.in + t.out : t.n;

export function groupBy(recs: UsageRec[], key: (r: UsageRec) => string): Map<string, UsageRec[]> {
  const out = new Map<string, UsageRec[]>();
  for (const r of recs) {
    const k = key(r);
    const g = out.get(k);
    if (g) g.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export type Period = "24h" | "7d" | "30d" | "90d" | "all";
export type Unit = "hour" | "day" | "week";

export interface Window {
  start: number;
  end: number;
  unit: Unit;
  /** Bucket start times, ascending; the last bucket ends at `end`. */
  buckets: number[];
  /** The same-length window just before this one, for deltas; null for "all". */
  prev: { start: number; end: number } | null;
}

const DAY_COUNT: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function midnight(t: number): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local calendar buckets, so a "day" is the viewer's day (DST-safe via setDate/setHours). */
export function makeWindow(period: Period, now: number, firstAt?: number): Window {
  if (period === "24h") {
    const end = new Date(now);
    end.setMinutes(0, 0, 0);
    end.setHours(end.getHours() + 1);
    const buckets: number[] = [];
    for (let i = 24; i > 0; i--) buckets.push(end.getTime() - i * 3_600_000);
    const start = buckets[0];
    return { start, end: end.getTime(), unit: "hour", buckets, prev: { start: start - 86_400_000, end: start } };
  }
  const endD = midnight(now);
  endD.setDate(endD.getDate() + 1);
  const end = endD.getTime();
  let startD: Date;
  if (period === "all") {
    startD = midnight(Math.min(firstAt ?? now, now));
  } else {
    startD = new Date(endD);
    startD.setDate(startD.getDate() - DAY_COUNT[period]);
  }
  const days = Math.round((end - startD.getTime()) / 86_400_000);
  const unit: Unit = period === "all" && days > 120 ? "week" : "day";
  if (unit === "week") {
    // Monday-start weeks.
    startD.setDate(startD.getDate() - ((startD.getDay() + 6) % 7));
  }
  const buckets: number[] = [];
  for (const d = new Date(startD); d.getTime() < end; d.setDate(d.getDate() + (unit === "week" ? 7 : 1))) {
    buckets.push(d.getTime());
  }
  let prev: Window["prev"] = null;
  if (period !== "all") {
    const p = new Date(startD);
    p.setDate(p.getDate() - DAY_COUNT[period]);
    prev = { start: p.getTime(), end: startD.getTime() };
  }
  return { start: startD.getTime(), end, unit, buckets, prev };
}

/** Index of the bucket holding t, or -1 outside the window.
 * ponytail: rows are UTC hours, so in a zone with a :30/:45 offset an hour lands wholly
 * in the local hour/day it starts in; the server would need finer rows to split it. */
export function bucketOf(w: Window, t: number): number {
  if (t < w.start || t >= w.end) return -1;
  let lo = 0;
  let hi = w.buckets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (w.buckets[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Weekday (0 = Monday) x local hour grid of a metric. */
export function weekHourGrid(recs: UsageRec[], metric: Metric): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of recs) {
    const d = new Date(r.t);
    grid[(d.getDay() + 6) % 7][d.getHours()] += metricOf(metric, r);
  }
  return grid;
}

/** Round ticks from 0 up to the first one at or above max. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

/** SVG path through the points as a monotone cubic (Fritsch-Carlson): never overshoots a
 * point, so a flat run stays flat and a zero day never dips below the baseline. */
export function monotonePath(pts: [number, number][]): string {
  const f = (v: number) => Math.round(v * 100) / 100;
  if (!pts.length) return "";
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  const n = pts.length;
  if (n < 2) return d;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const s = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
  const m = pts.map((_, i) => {
    if (i === 0) return s[0];
    if (i === n - 1) return s[n - 2];
    const a = s[i - 1];
    const b = s[i];
    if (a * b <= 0) return 0;
    return (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${f(x0 + h)},${f(y0 + m[i] * h)} ${f(x1 - h)},${f(y1 - m[i + 1] * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

export function fmtUsd(v: number): string {
  if (v < 0) return v > -0.01 ? "-$0.01" : `-${fmtUsd(-v)}`;
  if (v === 0) return "$0";
  if (v < 0.01) return "<$0.01";
  if (v >= 10_000) return `$${compact.format(v)}`;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const fmtCount = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : whole.format(Math.round(v)));

export function fmtMetric(m: Metric, v: number): string {
  return m === "cost" ? fmtUsd(v) : fmtCount(v);
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Signed % change, or null when there's nothing to compare against. */
export function delta(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return (cur - prev) / prev;
}

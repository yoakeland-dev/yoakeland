// The math behind the composer's context ring and its panel (SPEC.md §3.2 turn_completed.context,
// context_breakdown). Pure, so it's tested with node --test.
import type { ContextBreakdown, ContextData } from "./types";

export type RingState =
  /** Nothing has been reported for this chat yet (before its first turn on a fresh open). */
  | { kind: "empty" }
  /** The server has nothing to measure: no messages, or an agent that doesn't say. */
  | { kind: "unknown" }
  | {
      kind: "ok";
      used: number;
      /** The model's window when known, else the compaction budget. */
      limit: number;
      windowKnown: boolean;
      /** 0-100, null when no limit is known at all. */
      pct: number | null;
      /** Not counted by the provider: a character heuristic. */
      estimated: boolean;
      level: "ok" | "warn" | "hot";
    };

export function ringState(ctx: ContextData | undefined | null): RingState {
  if (!ctx) return { kind: "empty" };
  if (ctx.source === "unknown") return { kind: "unknown" };
  const limit = ctx.windowTokens || ctx.maxTokens || 0;
  const pct = limit > 0 ? Math.min(100, Math.round((ctx.estimatedTokens / limit) * 100)) : null;
  return {
    kind: "ok",
    used: ctx.estimatedTokens,
    limit,
    windowKnown: !!ctx.windowTokens,
    pct,
    estimated: ctx.source !== "provider",
    level: pct === null ? "ok" : pct >= 90 ? "hot" : pct >= 70 ? "warn" : "ok",
  };
}

/** One line for the ring's tooltip and screen-reader label; `fmt` prints token counts. */
export function ringSummary(s: RingState, fmt: (n: number) => string): string {
  if (s.kind === "empty") return "Context: nothing reported yet";
  if (s.kind === "unknown") return "Context: nothing to measure yet";
  const tilde = s.estimated ? "~" : "";
  if (s.pct === null) return `Context: ${tilde}${fmt(s.used)} tokens`;
  return `Context: ${tilde}${s.pct}% of ${fmt(s.limit)}${s.windowKnown ? "" : " (compaction budget, model window unknown)"}`;
}

export interface Segment {
  key: string;
  label: string;
  tokens: number;
  /** Share of the bar, 0-100. */
  pct: number;
  exact: boolean;
  kind: "used" | "free" | "buffer";
}

export interface Bar {
  segments: Segment[];
  /** What the bar's full width stands for: the window, or everything listed when that is unknown. */
  denominator: number;
  /** Where the chat compacts itself, as a share of the bar; null when it doesn't say or it is off the bar. */
  compactPct: number | null;
  /** Some used slice is apportioned rather than counted. */
  anyEstimated: boolean;
}

export function bar(b: ContextBreakdown): Bar {
  const cats = b.categories.filter((c) => c.tokens > 0);
  const sum = cats.reduce((n, c) => n + c.tokens, 0);
  const denominator = Math.max(b.windowTokens ?? 0, sum);
  const kindOf = (key: string): Segment["kind"] => (key === "free" ? "free" : key === "buffer" ? "buffer" : "used");
  const segments = cats.map((c) => ({
    key: c.key,
    label: c.label,
    tokens: c.tokens,
    pct: denominator > 0 ? (c.tokens / denominator) * 100 : 0,
    exact: c.exact,
    kind: kindOf(c.key),
  }));
  const at = b.autoCompactAt ?? 0;
  return {
    segments,
    denominator,
    compactPct: at > 0 && denominator > 0 && at < denominator ? (at / denominator) * 100 : null,
    anyEstimated: segments.some((s) => s.kind === "used" && !s.exact),
  };
}

/** Hue for a category, so the same slice keeps its colour across chats; free space and the buffer are drawn neutral. */
const HUES: Record<string, number> = {
  system: 285,
  tools: 250,
  mcp: 225,
  memory: 200,
  skills: 175,
  agents: 150,
  summary: 330,
  user: 145,
  assistant: 210,
  reasoning: 305,
  tool_calls: 60,
  tool_results: 30,
  attachments: 95,
  messages: 190,
  other: 0,
};
export const categoryHue = (key: string): number | null => (key === "free" || key === "buffer" ? null : (HUES[key] ?? HUES.other));

/** Share of the last request's prompt that came from the cache, 0-100; null when there is no figure. */
export function cacheHitPct(cache: ContextBreakdown["cache"]): number | null {
  return cache && cache.input > 0 ? Math.round((cache.read / cache.input) * 100) : null;
}

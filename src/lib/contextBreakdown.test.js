// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { bar, cacheHitPct, categoryHue, ringState, ringSummary, usd } from "./contextBreakdown.ts";

const cat = (key, tokens, exact = false) => ({ key, label: key, tokens, exact });

test("no report yet is empty, an unmeasurable chat is unknown", () => {
  assert.deepEqual(ringState(undefined), { kind: "empty" });
  assert.deepEqual(ringState({ estimatedTokens: 0, maxTokens: 64000, source: "unknown" }), { kind: "unknown" });
});

test("the ring measures against the window when known, else the budget", () => {
  const known = ringState({ estimatedTokens: 50_000, maxTokens: 200_000, windowTokens: 200_000, budgetTokens: 64_000, source: "provider" });
  assert.equal(known.pct, 25);
  assert.equal(known.windowKnown, true);
  assert.equal(known.estimated, false);
  const budget = ringState({ estimatedTokens: 32_000, maxTokens: 64_000, source: "estimated" });
  assert.equal(budget.pct, 50);
  assert.equal(budget.windowKnown, false);
  assert.equal(budget.estimated, true);
});

test("levels warn from 70% and run hot from 90%, and the percentage never passes 100", () => {
  const at = (n) => ringState({ estimatedTokens: n, maxTokens: 100, source: "provider" });
  assert.equal(at(69).level, "ok");
  assert.equal(at(70).level, "warn");
  assert.equal(at(90).level, "hot");
  assert.equal(at(250).pct, 100);
});

test("no limit at all leaves the percentage out rather than dividing by zero", () => {
  const s = ringState({ estimatedTokens: 1234, maxTokens: 0, source: "estimated" });
  assert.equal(s.kind, "ok");
  assert.equal(s.pct, null);
  assert.equal(s.level, "ok");
});

test("the bar is drawn against the window, shares add up, and free/buffer are not 'used'", () => {
  const b = bar({
    sessionId: "s",
    totalTokens: 60_000,
    windowTokens: 200_000,
    autoCompactAt: 150_000,
    source: "provider",
    categories: [cat("system", 10_000, true), cat("user", 50_000), cat("free", 90_000), cat("buffer", 50_000), cat("tools", 0)],
  });
  assert.equal(b.denominator, 200_000);
  assert.equal(b.segments.length, 4);
  assert.deepEqual(b.segments.map((s) => s.kind), ["used", "used", "free", "buffer"]);
  assert.equal(b.segments.reduce((n, s) => n + s.pct, 0), 100);
  assert.equal(b.compactPct, 75);
  assert.equal(b.anyEstimated, true);
});

test("without a window the bar spans everything listed, and an all-exact bar says so", () => {
  const b = bar({ sessionId: "s", totalTokens: 30, source: "provider", categories: [cat("system", 10, true), cat("free", 30, true)] });
  assert.equal(b.denominator, 40);
  assert.equal(b.anyEstimated, false);
  assert.equal(b.compactPct, null);
  // A compaction point beyond the bar isn't drawn.
  assert.equal(bar({ sessionId: "s", totalTokens: 1, autoCompactAt: 900, source: "estimated", categories: [cat("user", 100)] }).compactPct, null);
});

test("used beyond the window widens the bar instead of overflowing it", () => {
  const b = bar({ sessionId: "s", totalTokens: 120, windowTokens: 100, source: "provider", categories: [cat("user", 120, true)] });
  assert.equal(b.denominator, 120);
  assert.equal(b.segments[0].pct, 100);
});

test("hues: free space and the buffer are neutral, unknown keys fall back to other", () => {
  assert.equal(categoryHue("free"), null);
  assert.equal(categoryHue("buffer"), null);
  assert.equal(categoryHue("system"), 285);
  assert.equal(categoryHue("something-new"), categoryHue("other"));
});

test("cache hit rate", () => {
  assert.equal(cacheHitPct({ read: 750, write: 0, input: 1000 }), 75);
  assert.equal(cacheHitPct({ read: 0, write: 0, input: 0 }), null);
  assert.equal(cacheHitPct(undefined), null);
});

test("cost: a missing rate is 'unknown', not $0.00", () => {
  assert.equal(usd(1.234), "$1.23");
  assert.equal(usd(0.004), "<$0.01");
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(0, true), "unknown");
  assert.equal(usd(2.5, true), "$2.50+");
});

test("the ring's one-liner says what it is measured against and whether it is a guess", () => {
  const fmt = (n) => `${n / 1000}k`;
  assert.equal(ringSummary({ kind: "empty" }, fmt), "Context: nothing reported yet");
  assert.equal(ringSummary({ kind: "unknown" }, fmt), "Context: nothing to measure yet");
  assert.equal(ringSummary(ringState({ estimatedTokens: 50_000, maxTokens: 200_000, windowTokens: 200_000, source: "provider" }), fmt), "Context: 25% of 200k");
  assert.equal(
    ringSummary(ringState({ estimatedTokens: 32_000, maxTokens: 64_000, source: "estimated" }), fmt),
    "Context: ~50% of 64k (compaction budget, model window unknown)",
  );
  assert.equal(ringSummary(ringState({ estimatedTokens: 3000, maxTokens: 0, source: "estimated" }), fmt), "Context: ~3k tokens");
});

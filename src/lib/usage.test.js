// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: TZ=Europe/Berlin node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { bucketOf, flatten, makeWindow, niceTicks, sum, weekHourGrid } from "./usage.ts";

const report = {
  sessions: [{ id: "s1", title: "A", projectPath: "/p" }, { id: "s2", projectPath: "/q" }],
  providers: [{ name: "claude", kind: "cli_claude" }, { name: "or", kind: "api_key" }],
  models: ["m1", "m2"],
  rows: [
    { h: Date.UTC(2026, 8, 27, 22) / 1000, s: 0, p: 0, m: 0, n: 2, in: 100, cached: 60, out: 10, usd: 1, ms: 1000 },
    { h: Date.UTC(2026, 8, 28, 9) / 1000, s: 1, p: 1, m: 1, n: 1, in: 50, out: 5, usd: 0.5, ms: 500 },
  ],
  deleted: { sessions: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
};

test("flatten and sum split billed from subscription", () => {
  const recs = flatten("c1", report);
  assert.equal(recs[1].cached, 0);
  const t = sum(recs);
  assert.deepEqual([t.n, t.in, t.cached, t.out, t.usd, t.billed, t.chats, t.ms, t.timedOut], [3, 150, 60, 15, 1.5, 0.5, 2, 500, 5]);
});

test("windows bucket by local day", () => {
  if (process.env.TZ !== "Europe/Berlin") return; // the dates below assume CEST
  const now = Date.UTC(2026, 8, 28, 12);
  const w = makeWindow("7d", now);
  assert.equal(w.buckets.length, 7);
  assert.equal(w.unit, "day");
  // 22:00 UTC on the 27th is 00:00 on the 28th in Berlin: today's (last) bucket.
  assert.equal(bucketOf(w, Date.UTC(2026, 8, 27, 22)), 6);
  assert.equal(bucketOf(w, Date.UTC(2026, 8, 27, 21)), 5);
  assert.equal(bucketOf(w, w.end), -1);
  assert.equal(w.prev.end, w.start);
  const h = makeWindow("24h", now);
  assert.equal(h.buckets.length, 24);
  assert.equal(bucketOf(h, Date.UTC(2026, 8, 28, 12)), 23);
  // DST: the 90d window crosses no change here, but "all" from March must still be whole days.
  const all = makeWindow("all", now, Date.UTC(2026, 2, 1));
  assert.equal(all.unit, "week");
  assert.equal(new Date(all.buckets[0]).getDay(), 1);
  assert.ok(all.buckets.every((b) => new Date(b).getHours() === 0));
  const grid = weekHourGrid(flatten("c1", report), "requests");
  assert.equal(grid[0][0], 2); // Monday 00:00
});

test("nice ticks", () => {
  assert.deepEqual(niceTicks(0), [0]);
  assert.deepEqual(niceTicks(9), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceTicks(0.37), [0, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(niceTicks(1200), [0, 500, 1000, 1500]);
});

test("brands", async () => {
  const { modelBrand, providerBrand } = await import("./usage.ts");
  assert.equal(providerBrand({ name: "claude-subscription", kind: "cli_claude" }), "claude");
  assert.equal(providerBrand({ name: "my-or", kind: "api_key", httpProvider: "openrouter" }), "openrouter");
  assert.equal(providerBrand({ name: "DeepSeek", kind: "api_key", httpProvider: "openai" }), "deepseek");
  assert.equal(providerBrand({ name: "LM Studio", kind: "api_key", httpProvider: "openai" }), "local");
  assert.equal(modelBrand("google/gemini-3-pro"), "gemini");
  assert.equal(modelBrand("claude-opus-5-5"), "claude");
  assert.equal(modelBrand("gpt-5.5-codex"), "openai");
  assert.equal(modelBrand("o3"), "openai");
  assert.equal(modelBrand("inclusionai/ling-3.0-flash-vl:free"), null);
});

test("monotone path never overshoots", async () => {
  const { monotonePath } = await import("./usage.ts");
  for (const ys of [[0, 0, 5, 0, 0], [1, 3, 2], [0, 10, 10, 0]]) {
    const pts = ys.map((y, i) => [i * 10, y]);
    const segs = monotonePath(pts).split("C").slice(1);
    segs.forEach((seg, i) => {
      const [lo, hi] = [Math.min(ys[i], ys[i + 1]), Math.max(ys[i], ys[i + 1])];
      for (const pair of seg.trim().split(" ")) {
        const y = Number(pair.split(",")[1]);
        assert.ok(y >= lo && y <= hi, `segment ${i} of ${ys}: ${y} outside [${lo}, ${hi}]`);
      }
    });
  }
  assert.equal(monotonePath([[0, 5]]), "M0,5");
});

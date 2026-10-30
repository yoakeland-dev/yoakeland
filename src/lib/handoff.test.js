// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { handoffs } from "./handoff.ts";

const a = (provider, model) => ({ role: "assistant", provider, model });
const u = { role: "user" };

test("a marker where the model changes, not where it stays", () => {
  const h = handoffs([u, a("p", "m1"), u, a("p", "m1"), u, a("p", "m2"), u, a("p", "m2")]);
  assert.deepEqual([...h], [[5, { provider: "p", model: "m1" }]]);
});

test("same model on another provider counts, and going back counts again", () => {
  const h = handoffs([a("anthropic", "s"), a("openrouter", "s"), a("anthropic", "s")]);
  assert.deepEqual([...h.keys()], [1, 2]);
});

test("replies without a stamp neither mark nor reset", () => {
  const h = handoffs([a("p", "m1"), { role: "assistant" }, a("p", "m1"), a("q", "m1")]);
  assert.deepEqual([...h.keys()], [3]);
  assert.equal(handoffs([a("p", "m1")]).size, 0);
});

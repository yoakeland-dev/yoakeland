// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { pendingWhatsNew, WHATS_NEW } from "./whatsnew.ts";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
};

test("a fresh install only records the version", () => {
  store.clear();
  assert.equal(pendingWhatsNew("0.1.7"), null);
  assert.equal(store.get("yoake.lastSeenVersion"), "0.1.7");
});

test("an upgrade from a version that never recorded one shows the notes", () => {
  store.clear();
  store.set("yoake.settings", "{}");
  assert.equal(pendingWhatsNew("0.1.7"), WHATS_NEW["0.1.7"]);
  assert.equal(pendingWhatsNew("0.1.7"), null);
});

test("an upgrade from a recorded version shows the notes", () => {
  store.clear();
  store.set("yoake.lastSeenVersion", "0.1.6");
  assert.equal(pendingWhatsNew("0.1.7"), WHATS_NEW["0.1.7"]);
});

// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { liveTabsFor } from "./liveChats.ts";

const sess = (sessionId, extra = {}) => ({ sessionId, updatedAt: "2026-01-01T00:00:00Z", messageCount: 1, ...extra });

function server({ asks = [], active = {}, finished = {}, sessions = [], messages = {} }) {
  const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
  return {
    pendingAsks: asks.map((sessionId) => ({ sessionId, createdAt: "2026-01-01T00:00:00Z" })),
    activeTurnBySession: active,
    finishedSessions: finished,
    sessionById,
    messagesBySession: messages,
    sessionStatus: (id) =>
      asks.includes(id) ? "action" : active[id] ? "working" : finished[id] ? "finished" : "idle",
  };
}
const ids = (tabs) => tabs.map((t) => `${t.sessionId}:${t.status}`);

test("chats on screen never get a tab", () => {
  const srv = server({ active: { a: "t1", b: "t2" }, sessions: [sess("a"), sess("b")] });
  assert.deepEqual(ids(liveTabsFor("c", srv, ["a", null])), ["b:working"]);
});

test("needs-you sorts first, the rest by when the run started", () => {
  const srv = server({
    asks: ["c"],
    active: { a: "t1", b: "t2" },
    finished: { d: true },
    sessions: [sess("a"), sess("b"), sess("c"), sess("d")],
    messages: { a: [{ role: "user", createdAt: 300 }], b: [{ role: "user", createdAt: 100 }], d: [{ role: "user", createdAt: 200 }] },
  });
  assert.deepEqual(ids(liveTabsFor("c", srv, [])), ["c:action", "b:working", "d:finished", "a:working"]);
});

test("a split pair is one tab under its anchor, taking the stronger status", () => {
  const srv = server({
    asks: ["partner"],
    active: { anchor: "t1" },
    sessions: [sess("anchor", { linkedSessionId: "partner" }), sess("partner")],
  });
  assert.deepEqual(ids(liveTabsFor("c", srv, [])), ["anchor:action"]);
});

test("a pair whose anchor is on screen is hidden even when the partner is live", () => {
  const srv = server({ active: { partner: "t1" }, sessions: [sess("anchor", { linkedSessionId: "partner" }), sess("partner")] });
  assert.deepEqual(liveTabsFor("c", srv, ["anchor"]), []);
});

test("a chat with a pending ask but no listing still gets a stub tab", () => {
  const srv = server({ asks: ["ghost"] });
  assert.deepEqual(ids(liveTabsFor("c", srv, [])), ["ghost:action"]);
});

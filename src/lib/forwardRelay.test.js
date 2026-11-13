// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { createRelay } from "./forwardRelay.ts";

const server = (connectionId, serverId, relayKey, extra = {}) => ({
  connectionId,
  connectionStatus: "connected",
  serverId,
  relayKey,
  idConflict: false,
  features: ["forwarding"],
  ...extra,
});

function world(servers) {
  const sent = [];
  const relay = createRelay((to, env) => sent.push({ to, ...env }), () => servers);
  const ask = (from, data) => relay.handle(from, { type: "forward_request", data: { requestId: "r", serverId: "A", seq: 0, last: true, data: "{}", ...data } });
  return { sent, relay, ask };
}

test("a request is stamped with who asked and how this device reached them, over what the asker wrote", () => {
  const { sent, ask } = world({ a: server("a", "A", "ca:aa"), b: server("b", "B", "ca:bb") });
  ask("b", { from: "C", fromKey: "ca:cc" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "a");
  assert.equal(sent[0].data.from, "B");
  assert.equal(sent[0].data.fromKey, "ca:bb");
});

test("a server that claims another's id relays nothing, and the real one is held back too", () => {
  const servers = { a: server("a", "A", "ca:aa"), b: server("b", "B", "ca:bb"), evil: server("evil", "B", "ca:ee") };
  const { sent, ask, relay } = world(servers);
  ask("evil");
  assert.ok(sent.every((e) => e.to !== "a"), "the impostor's request reached the lender");
  assert.equal(sent.at(-1).type, "forward_end");
  relay.syncOffers();
  assert.ok(!sent.some((e) => e.type === "relay_offer" && e.data.servers.includes("B")), "a clashing id was offered");
});

test("a server whose id changed on its connection relays nothing", () => {
  const { sent, ask } = world({ a: server("a", "A", "ca:aa"), b: server("b", "B", "ca:bb", { idConflict: true }) });
  ask("b");
  assert.ok(sent.every((e) => e.to !== "a"));
});

test("nothing is relayed before this device has a key for the asker", () => {
  const { sent, ask } = world({ a: server("a", "A", "ca:aa"), b: server("b", "B", null) });
  ask("b");
  assert.ok(sent.every((e) => e.to !== "a"));
});

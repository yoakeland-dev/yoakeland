// Run with: node --test electron/
// The exchange itself is tested against the real server (yoakeland/cmd/yoakeland/pairpake_node_test.go).
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { normalizePin, pairWithPin } from "./pair.js";

test("a PIN is its digits, however it was typed", () => {
  assert.equal(normalizePin("4821-7733"), "48217733");
  assert.equal(normalizePin(" 4821 7733\n"), "48217733");
  assert.equal(normalizePin(undefined), "");
});

test("it refuses without a PIN or a device id before touching the network", async () => {
  let dialled = false;
  const connect = () => ((dialled = true), assert.fail("dialled"));
  await assert.rejects(pairWithPin({ host: "h", port: 1, pin: " - ", deviceId: "d" }, { connect }), /Enter the PIN/);
  await assert.rejects(pairWithPin({ host: "h", port: 1, pin: "12345678", deviceId: "" }, { connect }), /no id/);
  assert.equal(dialled, false);
});

test("a server that isn't there is reported with its address", async () => {
  const closed = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
  await assert.rejects(pairWithPin({ host: "127.0.0.1", port: closed, pin: "12345678", deviceId: "d" }), new RegExp(`127.0.0.1:${closed}`));
});

test("a server that isn't TLS at all is a failed connection, not a hang", async () => {
  const server = net.createServer((s) => s.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(pairWithPin({ host: "127.0.0.1", port: server.address().port, pin: "12345678", deviceId: "d" }), /couldn't connect/);
  } finally {
    server.close();
  }
});

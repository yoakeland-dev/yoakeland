// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { decodePairingCode, pairingUrl } from "./pairing.ts";

test("the QR URL carries the token in the fragment and decodes back", () => {
  const url = new URL(pairingUrl("192.168.1.20", 7890, "tok+/en=="));
  assert.equal(url.origin, "https://192.168.1.20:7890");
  assert.equal(url.search, ""); // only the fragment: it never reaches the server
  assert.ok(url.hash.startsWith("#pair="));
  assert.equal(decodePairingCode(url.hash.slice("#pair=".length))?.token, "tok+/en==");
});

test("junk in the fragment is not a pairing code", () => {
  assert.equal(decodePairingCode("not base64 json"), null);
});

test("a code with a fingerprint opens the hosted app and carries the address", () => {
  const fp = "AB:CD:EF";
  const url = new URL(pairingUrl("192.168.1.20", 7890, "tok", fp));
  assert.equal(url.origin, "https://app.yoake.land");
  assert.equal(url.search, "");
  const code = decodePairingCode(url.hash.slice("#pair=".length));
  assert.deepEqual(code, { token: "tok", caPem: undefined, host: "192.168.1.20", port: 7890, rtcFp: fp });
});

test("a code from the server's console has a fingerprint but no address", () => {
  const code = decodePairingCode(btoa(JSON.stringify({ t: "tok", ca: "PEM", fp: "AB:CD" })));
  assert.deepEqual(code, { token: "tok", caPem: "PEM", host: undefined, port: undefined, rtcFp: "AB:CD" });
});

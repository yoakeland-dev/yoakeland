// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { decodePairingCode, pairingUrl, parseScanned } from "./pairing.ts";

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

test("a scanned QR is a hosted URL, a server URL or a bare code", () => {
  const hosted = parseScanned(pairingUrl("10.0.0.2", 7890, "tok", "AB:CD"));
  assert.deepEqual([hosted.token, hosted.host, hosted.port, hosted.rtcFp], ["tok", "10.0.0.2", 7890, "AB:CD"]);
  const own = parseScanned(pairingUrl("10.0.0.2", 7890, "tok"));
  assert.deepEqual([own.token, own.host, own.port], ["tok", "10.0.0.2", 7890]);
  assert.equal(parseScanned(btoa(JSON.stringify({ t: "tok" }))).token, "tok");
  assert.equal(parseScanned("https://example.com/"), null);
});

test("a code carries every address and a phone gets them all back", async () => {
  const { pairingUrl, parseScanned } = await import("./pairing.ts");
  const got = parseScanned(pairingUrl(["192.168.1.5", "10.0.0.2", "100.64.1.1"], 7890, "tok", "AB:CD"));
  assert.equal(got.host, "192.168.1.5");
  assert.deepEqual(got.hosts, ["10.0.0.2", "100.64.1.1"]);
  assert.equal(parseScanned(pairingUrl("192.168.1.5", 7890, "tok", "AB:CD")).hosts?.length ?? 0, 0);
});

test("the code the server prints says where to go and what CA to trust", () => {
  const printed = btoa(JSON.stringify({ t: "tok", ca: "PEM", h: "203.0.113.7", hs: ["10.0.0.2"], p: 7890, fp: "AB:CD" }));
  const got = parseScanned(printed);
  assert.deepEqual([got.token, got.caPem, got.host, got.port, got.hosts], ["tok", "PEM", "203.0.113.7", 7890, ["10.0.0.2"]]);
  // and without a fingerprint, as the desktop's copy has when the server has no WebRTC
  assert.equal(parseScanned(btoa(JSON.stringify({ t: "tok", ca: "PEM", h: "10.0.0.2", p: 7890 }))).host, "10.0.0.2");
});

// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { connectionKey } from "./serverKey.ts";

const pem = (b64) => `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;

test("a pinned CA is keyed by its certificate, however the PEM is wrapped", async () => {
  const a = await connectionKey({ mode: "remote", host: "a.lan", caPem: pem("AAEC\nAwQF") }, false);
  const b = await connectionKey({ mode: "remote", host: "other", caPem: `\r\n${pem("AAECAwQF")}` }, false);
  assert.match(a, /^ca:[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, await connectionKey({ mode: "remote", host: "a.lan", caPem: pem("BAECAwQF") }, false));
});

test("a server can't take another's key by claiming its id: the key comes from the connection", async () => {
  assert.equal(await connectionKey({ mode: "remote", host: "1.2.3.4", rtcFp: "AB:cd:01", caPem: pem("AAEC") }, true), "dtls:abcd01");
  // A name can't be dialed over WebRTC, so the browser's TLS carried it.
  assert.equal(await connectionKey({ mode: "remote", host: "box.lan", rtcFp: "AB:cd:01" }, true), "host:box.lan");
  assert.equal(await connectionKey({ mode: "remote", host: "Box.Example.com" }, false), "host:box.example.com");
  // The web app ignores a CA it can't pin; so does the key.
  assert.equal(await connectionKey({ mode: "remote", host: "h", caPem: pem("AAEC") }, true), "host:h");
  assert.equal(await connectionKey({ mode: "local" }, false), "local");
});

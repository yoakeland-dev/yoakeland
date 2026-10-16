import test from "node:test";
import assert from "node:assert/strict";
import { createOAuthListener } from "./oauthListener.js";

// Hit the loopback port the way a browser would; 127.0.0.1 because CI may not resolve localhost to it.
const hit = (callbackUrl, query = "") => fetch(callbackUrl.replace("localhost", "127.0.0.1") + query);

test("delivers the code from the callback and then stops listening", async () => {
  const l = createOAuthListener();
  const { callbackUrl } = await l.listen();
  assert.match(callbackUrl, /^http:\/\/localhost:\d+\/callback$/);
  const waiting = l.wait();
  const res = await hit(callbackUrl, "?code=abc123");
  assert.equal(res.status, 200);
  assert.equal(await waiting, "abc123");
  await assert.rejects(hit(callbackUrl, "?code=again")); // server is closed
  await assert.rejects(l.wait(), /no sign-in in progress/);
});

test("ignores other paths and a callback with no code", async () => {
  const l = createOAuthListener();
  const { callbackUrl } = await l.listen();
  assert.equal((await fetch(callbackUrl.replace("localhost", "127.0.0.1").replace("/callback", "/favicon.ico"))).status, 404);
  assert.equal((await hit(callbackUrl)).status, 400);
  const waiting = l.wait();
  await hit(callbackUrl, "?code=ok");
  assert.equal(await waiting, "ok");
});

test("cancel and timeout reject wait()", async () => {
  const l = createOAuthListener();
  await l.listen();
  const cancelled = l.wait();
  l.cancel();
  await assert.rejects(cancelled, /cancelled/);

  const slow = createOAuthListener({ timeoutMs: 20 });
  await slow.listen();
  await assert.rejects(slow.wait(), /timed out/);
});

test("starting a second sign-in cancels the first", async () => {
  const l = createOAuthListener();
  const first = await l.listen();
  const firstWait = l.wait();
  const second = await l.listen();
  await assert.rejects(firstWait, /cancelled/);
  assert.notEqual(first.callbackUrl, second.callbackUrl);
  l.cancel();
});

test("waitParams hands back state and issuer for a flow that checks them", async () => {
  const l = createOAuthListener();
  const { callbackUrl } = await l.listen();
  const waiting = l.waitParams();
  await hit(callbackUrl, "?code=abc&state=st1&iss=https%3A%2F%2Fauth.example");
  assert.deepEqual(await waiting, { code: "abc", state: "st1", iss: "https://auth.example" });
});

test("a refusal from the provider rejects wait() instead of hanging until the timeout", async () => {
  const l = createOAuthListener();
  const { callbackUrl } = await l.listen();
  const rejected = assert.rejects(l.wait(), /The user said no/); // attached before the rejection can happen
  const res = await hit(callbackUrl, "?error=access_denied&error_description=The+user+said+no");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /refused/);
  await rejected;
});

test("once a flow names its state, only a redirect carrying it is taken", async () => {
  const l = createOAuthListener();
  const { callbackUrl } = await l.listen();
  l.expectState("st1");
  const waiting = l.waitParams();
  assert.equal((await hit(callbackUrl, "?code=forged")).status, 404); // another page guessing the port
  assert.equal((await hit(callbackUrl, "?code=forged&state=nope")).status, 404);
  await hit(callbackUrl, "?code=real&state=st1");
  assert.deepEqual(await waiting, { code: "real", state: "st1", iss: undefined });
});

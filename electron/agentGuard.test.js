import test from "node:test";
import assert from "node:assert/strict";
import { createGuards } from "./agentGuard.js";

test("no guard means everything loads", () => {
  assert.equal(createGuards().allows(1, "https://evil.example/"), true);
});

test("a guarded webview only follows approved hosts and reports the rest", () => {
  const g = createGuards();
  g.guard(7, ["Docs.Example.com", "localhost", "::1"]);
  assert.equal(g.allows(7, "https://docs.example.com/page"), true);
  assert.equal(g.allows(7, "http://localhost:3000/x"), true);
  assert.equal(g.allows(7, "http://[::1]:8080/"), true);
  assert.equal(g.allows(7, "about:blank"), true);
  assert.equal(g.allows(7, "https://evil.example/login"), false);
  assert.equal(g.allows(7, "https://docs.example.com.evil.example/"), false);
  assert.equal(g.allows(7, "not a url"), false);
  assert.equal(g.allows(8, "https://evil.example/"), true); // another webview is unaffected
  assert.deepEqual(g.unguard(7), ["https://evil.example/login", "https://docs.example.com.evil.example/", "not a url"]);
  assert.equal(g.allows(7, "https://evil.example/"), true); // released
  assert.deepEqual(g.unguard(7), []);
});

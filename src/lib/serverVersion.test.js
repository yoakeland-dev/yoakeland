// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { isOlder } from "./serverVersion.ts";

test("compares numerically, not as strings", () => {
  assert.equal(isOlder("0.9.0", "0.10.0"), true);
  assert.equal(isOlder("v1.2.3", "1.2.3"), false);
  assert.equal(isOlder("1.3", "1.2.9"), false);
});

test("no version means an old server, a dev build is left alone", () => {
  assert.equal(isOlder(undefined, "0.1.0"), true);
  assert.equal(isOlder("dev", "0.1.0"), false);
});

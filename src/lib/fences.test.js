// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { hasOpenFence } from "./fences.ts";

test("a fence that hasn't closed is open", () => {
  assert.equal(hasOpenFence("```mermaid\ngraph TD\nA-->B"), true);
  assert.equal(hasOpenFence("```mermaid\n"), true);
  assert.equal(hasOpenFence("```mermaid\ngraph TD\nA-->B\n``"), true);
  assert.equal(hasOpenFence("~~~\nx"), true);
});

test("a closed fence, or none, is complete", () => {
  assert.equal(hasOpenFence("```mermaid\ngraph TD\nA-->B\n```"), false);
  assert.equal(hasOpenFence("```mermaid\ngraph TD\nA-->B\n```\n"), false);
  assert.equal(hasOpenFence("plain text"), false);
  assert.equal(hasOpenFence(""), false);
  assert.equal(hasOpenFence("~~~\nx\n~~~"), false);
});

test("a fence quoted inside another stays code", () => {
  assert.equal(hasOpenFence("````md\n```js\nx\n```\n````"), false);
  assert.equal(hasOpenFence("````md\n```js\nx\n```\n"), true);
  assert.equal(hasOpenFence("```\n~~~\n```"), false);
  assert.equal(hasOpenFence("```\nx\n```js"), true);
});

test("indented fences (lists, quotes) count", () => {
  assert.equal(hasOpenFence("- item\n  ```mermaid\n  A-->B"), true);
  assert.equal(hasOpenFence("> ```\n> x\n> ```"), false);
});

test("an inline triple-backtick isn't a fence", () => {
  assert.equal(hasOpenFence("```code``` inline"), false);
});

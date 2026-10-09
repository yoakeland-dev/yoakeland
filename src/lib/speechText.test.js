// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { plainSpeech } from "./speechText.ts";

test("markdown is stripped and code is announced", () => {
  const md = "## Title\n\nSome **bold** and `code` with a [link](http://x.y).\n\n```js\nlet a = 1;\n```\n\n- item one\n- item two";
  assert.equal(plainSpeech(md), "Title. Some bold and code with a link. code block. item one item two");
});

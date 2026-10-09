// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { allowedImgSrc, allowedSvgHref, cssIsSafe } from "./sanitizeRules.ts";

test("image sources: https and inline images only", () => {
  assert.equal(allowedImgSrc("https://example.com/a.png"), true);
  assert.equal(allowedImgSrc("data:image/png;base64,AAAA"), true);
  assert.equal(allowedImgSrc("data:image/svg+xml;utf8,<svg/>"), true);
  assert.equal(allowedImgSrc("http://example.com/a.png"), false);
  assert.equal(allowedImgSrc("/etc/passwd"), false);
  assert.equal(allowedImgSrc("a.png"), false);
  assert.equal(allowedImgSrc("file:///etc/passwd"), false);
  assert.equal(allowedImgSrc("javascript:alert(1)"), false);
  assert.equal(allowedImgSrc("data:text/html,<script>"), false);
  assert.equal(allowedImgSrc("app://yoake/x.png"), false);
});

test("svg hrefs stay in the document", () => {
  assert.equal(allowedSvgHref("#marker"), true);
  assert.equal(allowedSvgHref("data:image/png;base64,AA"), true);
  assert.equal(allowedSvgHref("https://evil.example/x.svg#a"), false);
  assert.equal(allowedSvgHref("//evil.example/x.svg"), false);
});

test("css that fetches is rejected, paint servers are not", () => {
  assert.equal(cssIsSafe("fill:red;stroke:#333"), true);
  assert.equal(cssIsSafe("fill:url(#grad)"), true);
  assert.equal(cssIsSafe("fill: url( '#grad' )"), true);
  assert.equal(cssIsSafe("background:url(https://evil.example/x)"), false);
  assert.equal(cssIsSafe("background:URL(data:image/png;base64,AA)"), false);
  assert.equal(cssIsSafe("@import 'https://evil.example/x.css';"), false);
  assert.equal(cssIsSafe("background:\\75rl(https://evil.example/x)"), false);
  assert.equal(cssIsSafe("background:u\\rl(https://evil.example/x)"), false);
  assert.equal(cssIsSafe("background:ur/**/l(x)"), false); // not a url() token, but comments are stripped first: err safe
  assert.equal(cssIsSafe("background:url(#a) url(https://evil.example/x)"), false);
  assert.equal(cssIsSafe("content:'\\201C'"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CSP } from "./csp.js";

// An ```artifact frame must load a real URL with a policy of its own: srcdoc, data: and blob: frames
// inherit the app's, whose script-src 'self' blocks the page's inline scripts (src/lib/artifact.ts).
const frame = readFileSync(new URL("../static/artifact-frame.html", import.meta.url), "utf8");
const own = frame.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? "";

test("the frame page allows inline scripts, and nothing from the network", () => {
  assert.match(own, /script-src 'unsafe-inline'/);
  assert.match(own, /default-src 'none'/);
  assert.doesNotMatch(own, /connect-src|https?:/);
});

test("the app itself never allows inline scripts", () => {
  assert.deepEqual(CSP["script-src"], ["'self'"]);
});

test("the frame only takes its page from the app", () => {
  assert.match(frame, /e\.source !== top/);
});

// A sandboxed page can still navigate itself, and the app's frame-src lets a frame go anywhere on the
// web. The shell between them is what keeps a page from carrying its contents to another host.
const shell = readFileSync(new URL("../static/artifact-shell.html", import.meta.url), "utf8");
const shellCsp = shell.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? "";

test("the shell lets the page's frame load only the app's own files, and runs no script", () => {
  assert.match(shellCsp, /frame-src 'self'(;|$)/);
  assert.match(shellCsp, /default-src 'none'/);
  assert.doesNotMatch(shellCsp, /script-src|https?:/);
  assert.doesNotMatch(shell, /<script/);
  assert.match(shell, /<iframe sandbox="allow-scripts"[^>]* src="\/artifact-frame\.html"/);
});

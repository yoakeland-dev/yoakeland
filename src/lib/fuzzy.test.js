// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import { fuzzyFilter, fuzzyIndices, fuzzyScore } from "./fuzzy.ts";

test("quick-open matching", () => {
  assert.equal(fuzzyScore("src/a.ts", "xyz"), null);
  assert.equal(fuzzyScore("src/a.ts", "ta"), null); // order matters
  const files = ["some/deep/fe/x.go", "src/lib/components/sidebar/FileEditor.svelte", "README.md"];
  assert.equal(fuzzyFilter(files, "fileed")[0], "src/lib/components/sidebar/FileEditor.svelte");
  assert.deepEqual(fuzzyFilter(files, "rdme"), ["README.md"]);
  assert.equal(fuzzyFilter(files, "").length, 3);
});

test("fuzzyIndices marks the greedy match", () => {
  assert.deepEqual(fuzzyIndices("src/FileEditor.svelte", "fe"), [4, 7]);
  assert.deepEqual(fuzzyIndices("abc", "x"), []);
});

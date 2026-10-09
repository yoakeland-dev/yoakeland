// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseThemeFile, parseThemeFiles, terminalFromVariant, tokensFor, tokensFromVariant } from "./theme.ts";

const side = { bg: "#111111", panelBg: "#222222", text: "#eeeeee", accent: "#ff00aa" };

test("shipped theme files all parse, and ids are their file names", () => {
  const dir = new URL("./themes/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 14);
  for (const f of files) {
    const t = parseThemeFile(f.slice(0, -5), JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    assert.ok(!("error" in t), `${f}: ${t.error}`);
    assert.ok(t.name && (t.dark || t.light), f);
  }
});

test("theme file: either side alone is enough, neither is not", () => {
  assert.ok(parseThemeFile("a", { name: "A", dark: side }).dark);
  assert.equal(parseThemeFile("a", { name: "A", light: side }).dark, undefined);
  assert.match(parseThemeFile("a", { name: "A" }).error, /dark or light/);
  assert.equal(parseThemeFile("a", { dark: side }).name, "a");
});

test("theme file: bad colors name the side and the field", () => {
  assert.match(parseThemeFile("a", { dark: { ...side, accent: "red" } }).error, /dark: accent/);
  assert.match(parseThemeFile("a", { light: { ...side, bg: "url(http://x)" } }).error, /light: bg/);
  assert.match(parseThemeFile("a", { dark: { ...side, text: undefined } }).error, /text/);
});

test("theme file: unknown token and terminal keys dropped, bad values refused", () => {
  const t = parseThemeFile("a", {
    dark: { ...side, tokens: { textDim: "#999", evil: "#000", bg: "url(x)" }, terminal: { red: "#ff0000", blue: "blue", nope: "#000000" } },
  });
  assert.deepEqual(t.dark.tokens, { textDim: "#999" });
  assert.deepEqual(t.dark.terminal, { red: "#ff0000" });
});

test("folder of files: good ones kept, each reject says which file and why", () => {
  const { themes, problems } = parseThemeFiles([
    { file: "mine.json", text: JSON.stringify({ name: "Mine", dark: side }) },
    { file: "broken.json", text: "{nope" },
    { file: "empty.json", text: "{}" },
  ]);
  assert.deepEqual(themes.map((t) => t.id), ["custom:mine"]);
  assert.deepEqual(problems, ["broken.json: not valid JSON", "empty.json: needs a dark or light section"]);
});

test("a missing side falls back to colors derived from the accent", () => {
  const t = parseThemeFile("a", { dark: side });
  assert.equal(tokensFor(t, "#7c9bff", "dark").bg, "#111111");
  assert.match(tokensFor(t, "#7c9bff", "light").bg, /^hsl\(/);
});

test("tokensFromVariant fills every token and honors overrides", () => {
  const full = Object.keys(tokensFromVariant(side, "dark")).sort();
  assert.equal(full.length, 16);
  assert.deepEqual(Object.keys(tokensFromVariant(side, "light")).sort(), full);
  assert.equal(tokensFromVariant({ ...side, tokens: { textDim: "#123456" } }, "dark").textDim, "#123456");
});

test("terminal palette takes the theme's surfaces and its own ANSI slots", () => {
  const c = terminalFromVariant({ ...side, terminal: { red: "#ab0000" } }, "dark");
  assert.equal(c.background, "#222222");
  assert.equal(c.foreground, "#eeeeee");
  assert.equal(c.red, "#ab0000");
  assert.equal(c.selectionBackground, "#ff00aa40");
  assert.ok(c.green);
});

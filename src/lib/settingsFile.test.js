// @ts-nocheck: run by node --test, which needs the .ts import extension.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFromFile, settingsToFile } from "./settingsFile.ts";

const cur = { theme: "dark", uiFontSize: 14, keybinds: {}, onboarded: true, trustedCaByServer: {} };

test("round trip leaves out the install's own state and anything that doesn't fit", () => {
  const text = settingsToFile({ ...cur, theme: "light", trustedCaByServer: { a: "PEM" } });
  assert.ok(!text.includes("PEM") && !text.includes("onboarded"));
  assert.deepEqual(settingsFromFile(text, cur), { theme: "light", uiFontSize: 14, keybinds: {} });
  const odd = JSON.stringify({ kind: "yoakeland-settings", settings: { theme: 5, gone: 1, onboarded: false, uiFontSize: 16 } });
  assert.deepEqual(settingsFromFile(odd, cur), { uiFontSize: 16 });
});

test("rejects other files", () => {
  assert.throws(() => settingsFromFile("{}", cur));
  assert.throws(() => settingsFromFile("nope", cur));
});

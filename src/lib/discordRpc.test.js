// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DISCORD_CLIENT_ID,
  DEFAULT_DISCORD_RPC,
  buildDiscordActivity,
  buildDiscordEditorActivity,
  discordLanguageKey,
  discordRpcConfigured,
  renderDiscordTemplate,
  resolveDiscordClientId,
} from "./discordRpcSettings.ts";

const settings = (over = {}) => ({ ...DEFAULT_DISCORD_RPC, enabled: true, clientId: "123456789012345678", ...over });
const context = (over = {}) => ({ project: "yoake", chat: "Fix the settings page", status: "Working", server: "laptop", ...over });

test("rich presence is off and unconfigured by default", () => {
  assert.equal(DEFAULT_DISCORD_RPC.enabled, false);
  assert.equal(discordRpcConfigured(DEFAULT_DISCORD_RPC), false);
  assert.equal(resolveDiscordClientId(DEFAULT_DISCORD_RPC), DEFAULT_DISCORD_CLIENT_ID);
  assert.equal(discordRpcConfigured(settings()), true);
});

test("templates replace known variables and drop unknown ones", () => {
  assert.equal(
    renderDiscordTemplate("{status} in {project} on {server}", { status: "Working", project: "yoake", server: "laptop" }),
    "Working in yoake on laptop",
  );
  assert.equal(renderDiscordTemplate("hello {nope}", {}), "hello");
});

test("builds the default activity with elapsed time and artwork", () => {
  const activity = buildDiscordActivity(settings(), context(), 1_700_000_000_000);
  assert.equal(activity.type, 0);
  assert.equal(activity.details, "Working in yoake");
  assert.equal(activity.state, "Fix the settings page");
  assert.deepEqual(activity.timestamps, { start: 1_700_000_000_000 });
  assert.deepEqual(activity.assets, { large_image: "logo", large_text: "yoakeland" });
  assert.equal(activity.buttons, undefined);
});

test("idle is hidden unless asked for, then uses the idle lines", () => {
  assert.equal(buildDiscordActivity(settings(), context({ project: "", chat: "" }), 1), null);
  const idle = buildDiscordActivity(settings({ showWhenIdle: true }), context({ project: "", chat: "" }), 1);
  assert.equal(idle.details, "Taking a break");
  assert.equal(idle.state, "yoakeland");
  assert.equal(idle.timestamps, undefined);
});

test("buttons and activity type are configurable and validated", () => {
  const activity = buildDiscordActivity(
    settings({
      activityType: "listening",
      showButtons: true,
      button1Label: "Website",
      button1Url: "https://yoakeland.land",
      button2Label: "Bad",
      button2Url: "javascript:alert(1)",
    }),
    context(),
    1,
  );
  assert.equal(activity.type, 2);
  assert.deepEqual(activity.buttons, [{ label: "Website", url: "https://yoakeland.land" }]);
});

test("a plain chat can be hidden entirely", () => {
  const chat = { project: "Chat", regularChat: true, chat: "Thoughts", status: "Composing", server: "laptop" };
  assert.equal(buildDiscordActivity(settings({ hideOnChats: true }), chat, 1), null);
  assert.ok(buildDiscordActivity(settings(), chat, 1));
  // Repository-backed chats are never "plain".
  assert.ok(buildDiscordActivity(settings({ hideOnChats: true }), context(), 1));
});

test("empty lines are omitted rather than sent blank", () => {
  const activity = buildDiscordActivity(settings({ details: "", state: "", largeImage: "", largeText: "" }), context(), 1);
  assert.equal(activity, null);
});

test("supports the current RPC fields: name, links, status text and external images", () => {
  const activity = buildDiscordActivity(
    settings({
      name: "yoakeland",
      statusDisplayType: "details",
      detailsUrl: "https://yoakeland.land/projects/yoake",
      stateUrl: "javascript:alert(1)",
      largeImage: "https://cdn.example.com/logo.gif",
      largeUrl: "https://yoakeland.land",
      smallImage: "badge",
      smallUrl: "https://yoakeland.land/badge",
    }),
    context(),
    1,
  );
  assert.equal(activity.name, "yoakeland");
  assert.equal(activity.status_display_type, 2);
  assert.equal(activity.details_url, "https://yoakeland.land/projects/yoake");
  assert.equal(activity.state_url, undefined);
  assert.deepEqual(activity.assets, {
    large_image: "https://cdn.example.com/logo.gif",
    large_text: "yoakeland",
    large_url: "https://yoakeland.land",
    small_image: "badge",
    small_url: "https://yoakeland.land/badge",
  });
});

test("status display type defaults to the app name and can be omitted", () => {
  const activity = buildDiscordActivity(settings(), context(), 1);
  assert.equal(activity.status_display_type, undefined);
});

const editorContext = (over = {}) => ({ file: "App.svelte", path: "src/App.svelte", project: "yoake", language: "Svelte", server: "laptop", ...over });

test("editor activity uses the file/language templates", () => {
  const activity = buildDiscordEditorActivity(settings(), editorContext(), 1_700_000_000_000);
  assert.equal(activity.details, "Editing App.svelte");
  assert.equal(activity.state, "yoake · Svelte");
  assert.deepEqual(activity.timestamps, { start: 1_700_000_000_000 });
  assert.deepEqual(activity.assets, { large_image: "logo", large_text: "Svelte" });
});

test("editor activity is configurable and needs an open file", () => {
  assert.equal(buildDiscordEditorActivity(settings(), editorContext({ file: "" }), 1), null);
  const activity = buildDiscordEditorActivity(
    settings({
      editorDetails: "{filePath} — {languageKey}",
      editorState: "{project} on {server}",
      editorLargeImage: "{languageKey}",
      editorSmallImage: "logo",
    }),
    editorContext(),
    1,
  );
  assert.equal(activity.details, "src/App.svelte — svelte");
  assert.equal(activity.state, "yoake on laptop");
  assert.deepEqual(activity.timestamps, { start: 1 });
  assert.deepEqual(activity.assets, { large_image: "svelte", large_text: "Svelte", small_image: "logo" });
});

test("language names become asset-key slugs", () => {
  assert.equal(discordLanguageKey("TypeScript"), "typescript");
  assert.equal(discordLanguageKey("C++"), "cpp");
  assert.equal(discordLanguageKey("Plain text"), "text");
});

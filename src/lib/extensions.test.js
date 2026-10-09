// @ts-nocheck: run by node --test, which needs the .ts import extension.
// Run with: node --test src/lib/
import assert from "node:assert/strict";
import test from "node:test";
import {
  awaitingApproval, filterSkills, formatEnvLines, formatHeaderLines, humanizeTool, joinCommand, mcpToolParts,
  parseEnvLines, parseHeaderLines, parseServersJson, pickableSkills, slashToSkill, importItems, importNameError, serverNameError, skillKindOf, serverTarget, splitCommand,
} from "./extensions.ts";

test("server names follow the daemon's rule", () => {
  assert.equal(serverNameError("github"), "");
  assert.equal(serverNameError("my-server_2"), "");
  assert.notEqual(serverNameError(""), "");
  assert.notEqual(serverNameError("-x"), "");
  assert.notEqual(serverNameError("a b"), "");
  assert.notEqual(serverNameError("a__b"), "");
  assert.notEqual(serverNameError("x".repeat(41)), "");
});

test("splitCommand handles quotes and joinCommand round-trips", () => {
  assert.deepEqual(splitCommand(`npx -y @modelcontextprotocol/server-filesystem "/home/me/My Docs"`), ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/me/My Docs"]);
  assert.deepEqual(splitCommand(`a 'b c' "" d\\ e`), ["a", "b c", "", "d e"]);
  assert.deepEqual(splitCommand(`  `), []);
  assert.throws(() => splitCommand(`a "b`), /Unclosed/);
  for (const words of [["uvx", "mcp-server-git", "--repository", "/a b/c"], ["x", 'say "hi"', "back\\slash", ""]]) {
    assert.deepEqual(splitCommand(joinCommand(words[0], words.slice(1))), words);
  }
});

test("env and header lines", () => {
  assert.deepEqual(parseEnvLines("# c\nA=1\n\nB = x=y\n"), { A: "1", "B": " x=y" });
  assert.throws(() => parseEnvLines("A=1\nnonsense"), /Line 2/);
  assert.throws(() => parseEnvLines("1BAD=x"), /Line 1/);
  assert.equal(formatEnvLines({ A: "1", B: "2" }), "A=1\nB=2");
  assert.deepEqual(parseHeaderLines("X-Api-Key: abc\nAuthorization: Bearer t:o:k"), { "X-Api-Key": "abc", Authorization: "Bearer t:o:k" });
  assert.throws(() => parseHeaderLines("no colon"), /Line 1/);
  assert.equal(formatHeaderLines({ A: "b" }), "A: b");
});

test("mcp tool names split on the first double underscore after the server", () => {
  assert.deepEqual(mcpToolParts("mcp__github__create_issue"), { server: "github", tool: "create_issue" });
  assert.deepEqual(mcpToolParts("mcp__srv__a__b"), { server: "srv", tool: "a__b" });
  assert.equal(mcpToolParts("bash"), null);
  assert.equal(mcpToolParts("mcp__"), null);
  assert.equal(humanizeTool("create_issue"), "Create issue");
  assert.equal(humanizeTool("listFiles"), "List files");
});

test("serverTarget never includes env or headers", () => {
  assert.equal(serverTarget({ command: "npx", args: ["-y", "x y"], env: { K: "secret" } }), 'npx -y "x y"');
  assert.equal(serverTarget({ type: "http", url: "https://h/mcp", headers: { A: "secret" } }), "https://h/mcp");
});

test("awaitingApproval is project servers whose exact config hasn't been approved", () => {
  const s = (name, scope, approval) => ({ name, scope, approval });
  const got = awaitingApproval([s("a", "user"), s("b", "project", "approved"), s("c", "project", "pending"), s("d", "project", "changed"), s("e", "project", "denied")]);
  assert.deepEqual(got.map((x) => x.name), ["c", "d"]);
});

test("skills: filtering and what the $ picker offers", () => {
  const sk = (name, over = {}) => ({ name, description: "does " + name, source: "yoake", enabled: true, userInvocable: true, agents: ["native"], ...over });
  const all = [sk("review"), sk("deploy", { shadowed: true }), sk("release"), sk("hidden", { userInvocable: false }), sk("off", { enabled: false })];
  assert.deepEqual(filterSkills(all, "").map((s) => s.name), ["hidden", "off", "release", "review", "deploy"]);
  assert.deepEqual(filterSkills(all, "DEPLOY").map((s) => s.name), ["deploy"]);
  assert.deepEqual(pickableSkills(all, "").map((s) => s.name), ["release", "review"]);
  assert.deepEqual(pickableSkills(all, "rev").map((s) => s.name), ["review"]);
  assert.deepEqual(pickableSkills(undefined, ""), []);
  const mixed = [sk("a", { agents: ["native"] }), sk("b", { agents: ["claude"] }), sk("c", { agents: ["native", "codex"] })];
  assert.deepEqual(pickableSkills(mixed, "", "claude").map((s) => s.name), ["b"]);
  assert.deepEqual(pickableSkills(mixed, "", "native").map((s) => s.name), ["a", "c"]);
  assert.deepEqual(pickableSkills(mixed, "", "gemini"), []);
  assert.equal(skillKindOf("api_key"), "native");
  assert.equal(skillKindOf("cli_ohmypi"), "ohmypi");
});

test("pasted README JSON, in the shapes people copy", async () => {
  const { parseServersJson } = await import("./extensions.ts");
  const a = parseServersJson(`{"mcpServers":{"fs":{"command":"npx","args":["-y","srv",1],"env":{"K":"v"}},"remote":{"type":"streamable-http","url":"https://h/mcp","headers":{"X":"y"}}}}`);
  assert.deepEqual(a, [
    { name: "fs", config: { type: "stdio", command: "npx", args: ["-y", "srv", "1"], env: { K: "v" } } },
    { name: "remote", config: { type: "http", url: "https://h/mcp", headers: { X: "y" } } },
  ]);
  assert.equal(parseServersJson(`{"legacy":{"type":"sse","url":"https://h/sse"}}`)[0].config.type, "sse");
  assert.equal(parseServersJson(`{"name":"one","command":"x"}`)[0].name, "one");
  assert.throws(() => parseServersJson("{"), /Not valid JSON/);
  assert.throws(() => parseServersJson(`{"a b":{"command":"x"}}`), /a b/);
  assert.throws(() => parseServersJson(`{"x":{"foo":1}}`), /command or a url/);
  assert.throws(() => parseServersJson(`[]`), /object/);
});

test("a leading /name for a known skill is sent as $name", () => {
  const known = new Set(["review-pr"]);
  assert.equal(slashToSkill("/review-pr 12", known), "$review-pr 12");
  assert.equal(slashToSkill("/review-pr", known), "$review-pr");
  assert.equal(slashToSkill("/etc/hosts", known), "/etc/hosts");
  assert.equal(slashToSkill("/nope x", known), "/nope x");
  assert.equal(slashToSkill("see /review-pr", known), "see /review-pr");
});

test("pasted server JSON keeps every field the daemon knows", () => {
  const [{ name, config }] = parseServersJson(JSON.stringify({ mcpServers: { gh: {
    url: "https://x/mcp", agents: true, timeoutMs: 5000, disabledTools: ["a"], oauth: { clientId: "id", clientSecret: "s", scope: "r", junk: 1 }, junk: 1,
  } } }));
  assert.equal(name, "gh");
  assert.deepEqual(config, { type: "http", url: "https://x/mcp", headers: undefined, agents: true, timeoutMs: 5000, disabledTools: ["a"], oauth: { clientId: "id", clientSecret: "s", scope: "r" } });
});

test("import: only ticked, convertible rows go back, with a name only when it was changed", () => {
  const c = (id, extra = {}) => ({ id, source: "cursor", file: "f", name: id, suggestedName: id, config: {}, ...extra });
  const list = [c("a"), c("b", { nameTaken: true, suggestedName: "b-2" }), c("dup", { alreadyAdded: true }), c("x", { unsupported: "no" })];
  const ticked = new Set(["a", "b", "dup", "x"]);
  assert.deepEqual(importItems(list, ticked, { b: "mine" }), [{ id: "a" }, { id: "b", name: "mine" }]);
  assert.deepEqual(importItems(list, ticked, {}), [{ id: "a" }, { id: "b" }]);
  assert.equal(importNameError(list, ticked, { b: "mine" }), "");
  assert.match(importNameError(list, ticked, { b: "a" }), /Two servers/);
  assert.match(importNameError(list, ticked, { b: "bad__name" }), /underscore/);
});

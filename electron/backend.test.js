// Run with: node --test electron/
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commands, loadCredential, loadThemes, storeCredential, themesRevealPath } from "./backend.js";

// Waits for a condition instead of sleeping: a fixed delay is too short on a loaded machine.
async function until(cond, what, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("unix connect: auth frame, framing, oversized frame, disconnect event", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  const sockPath = path.join(dir, "s.sock");
  const got = [];
  let peer;
  const server = net.createServer((s) => {
    peer = s;
    s.setEncoding("utf8").on("data", (d) => got.push(d));
  });
  await new Promise((r) => server.listen(sockPath, r));
  try {
    await unixConnectBody();
  } finally {
    peer?.destroy(); // a failed assertion must not leave the server holding the process open
    server.close();
  }

  async function unixConnectBody() {
  const events = [];
  const cmds = commands((channel, payload) => events.push({ channel, payload }));
  assert.equal(await cmds.probe_unix({ path: sockPath }), true);
  assert.equal(await cmds.probe_unix({ path: sockPath + ".nope" }), false);

  const id = await cmds.connect_unix({ path: sockPath, name: "me" });
  await cmds.send_envelope({ connectionId: id, envelope: { type: "ping" } });
  await until(() => got.join("").trim().split("\n").length >= 2, "the auth and ping frames");
  assert.deepEqual(got.join("").trim().split("\n").map((l) => JSON.parse(l)), [
    { type: "auth", data: { name: "me" } },
    { type: "ping" },
  ]);

  peer.write('{"a":1}\n\n{"b"');
  peer.write(':2}\nnot json\n' + "x".repeat(11 * 1024 * 1024) + 'tail\n{"c":3}\n');
  await until(() => events.filter((e) => e.channel === "yoake-event").length >= 3, "the three frames");
  peer.end();
  await until(() => events.some((e) => e.channel === "yoake-disconnected"), "the disconnect");

  const envs = events.filter((e) => e.channel === "yoake-event").map((e) => e.payload.envelope);
  assert.deepEqual(envs, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  const logs = events.filter((e) => e.channel === "yoake-log").map((e) => e.payload.message);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /bad frame/);
  assert.match(logs[1], /oversized/);
  assert.deepEqual(events.at(-1), { channel: "yoake-disconnected", payload: { connectionId: id, reason: "connection closed" } });
  await assert.rejects(async () => cmds.send_envelope({ connectionId: id, envelope: {} }), /not connected/);
  }
});

test("credentials: store, load, delete, 0600", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  await storeCredential(dir, "srv", "tok");
  assert.equal(await loadCredential(dir, "srv"), "tok");
  assert.equal((await stat(path.join(dir, "credentials.json"))).mode & 0o777, 0o600);
  await storeCredential(dir, "srv", null);
  assert.equal(await loadCredential(dir, "srv"), null);
  assert.equal(await readFile(path.join(dir, "credentials.json"), "utf8"), "{}");
});

test("tcp connect rejects a CA file with no certificate in it", async () => {
  const cmds = commands(() => {});
  await assert.rejects(cmds.connect_tcp({ host: "127.0.0.1", port: 1, token: "t", caPem: "garbage" }), /no certificate/);
});

test("themes folder: absent is empty, reveal seeds an example once, files come back as text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  assert.deepEqual(await loadThemes(dir), []);
  const example = await themesRevealPath(dir);
  assert.equal(path.basename(example), "example.json");
  const seeded = await loadThemes(dir);
  assert.deepEqual(seeded.map((f) => f.file), ["example.json"]);
  assert.equal(JSON.parse(seeded[0].text).name, "My theme");
  // Once the folder has a theme, revealing never adds another.
  await writeFile(path.join(dir, "themes", "b.json"), "{}");
  await writeFile(path.join(dir, "themes", "notes.txt"), "ignored");
  assert.equal(path.basename(await themesRevealPath(dir)), "b.json");
  assert.deepEqual((await loadThemes(dir)).map((f) => f.file), ["b.json", "example.json"]);
});

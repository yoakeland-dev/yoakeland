// Run with: node --test electron/
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { clearDiscordApplicationCache, createDiscordRpc, discordIpcPaths, encodeFrame, fetchDiscordApplication, sanitizeActivity } from "./discordRpc.js";

test("finds Discord's IPC socket in the usual places on every platform", () => {
  const win = discordIpcPaths("win32", {}, "/home/me");
  assert.equal(win.length, 10);
  assert.equal(win[0], "\\\\?\\pipe\\discord-ipc-0");

  const linux = discordIpcPaths(
    "linux",
    { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp/user" },
    "/home/me",
  );
  assert.ok(linux.includes("/run/user/1000/discord-ipc-0"));
  assert.ok(linux.includes("/tmp/user/discord-ipc-0"));
  assert.ok(linux.includes("/tmp/discord-ipc-0"));
  assert.ok(linux.includes("/run/user/1000/snap.discord/discord-ipc-0"));
  assert.ok(linux.includes("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0"));

  const mac = discordIpcPaths("darwin", { TMPDIR: "/var/folders/x/T" }, "/Users/me");
  assert.equal(mac[0], "/var/folders/x/T/discord-ipc-0");
  assert.ok(mac.includes("/Users/me/Library/Application Support/discord/discord-ipc-0"));
});

test("frames carry the opcode and JSON length Discord expects", () => {
  const frame = encodeFrame(1, { hello: "world" });
  assert.equal(frame.readInt32LE(0), 1);
  assert.equal(frame.readInt32LE(4), Buffer.byteLength(JSON.stringify({ hello: "world" })));
  assert.deepEqual(JSON.parse(frame.subarray(8).toString()), { hello: "world" });
});

test("activity sanitizing keeps only Discord's fields and clips text", () => {
  assert.equal(sanitizeActivity(null), null);
  assert.equal(sanitizeActivity({ type: 0 }), null);

  const clean = sanitizeActivity({
    type: 2,
    details: "  details  ",
    state: "x".repeat(128),
    timestamps: { start: 1234.6 },
    assets: { large_image: "logo", large_text: "yoakeland", nope: "gone" },
    buttons: [
      { label: "Site", url: "https://yoakeland.land" },
      { label: "Bad", url: "javascript:alert(1)" },
      { label: "Third", url: "https://example.com" },
    ],
    secret: "dropped",
  });
  assert.deepEqual(clean, {
    type: 2,
    details: "  details  ",
    state: "x".repeat(128),
    timestamps: { start: 1235 },
    assets: { large_image: "logo", large_text: "yoakeland" },
    buttons: [
      { label: "Site", url: "https://yoakeland.land" },
      { label: "Third", url: "https://example.com" },
    ],
  });
});

test("accepts the newer activity fields and blocks non-http links", () => {
  const clean = sanitizeActivity({
    type: 0,
    name: "yoakeland",
    status_display_type: 1,
    details: "Details",
    details_url: "https://example.com/d",
    state: "State",
    state_url: "javascript:alert(1)",
    timestamps: { start: 1_700_000_000_000 },
    assets: {
      large_image: "https://cdn.example.com/a.gif",
      large_url: "https://example.com/a",
      small_image: "s",
      small_url: "data:text/html,x",
    },
  });
  assert.deepEqual(clean, {
    type: 0,
    name: "yoakeland",
    status_display_type: 1,
    details: "Details",
    details_url: "https://example.com/d",
    state: "State",
    timestamps: { start: 1_700_000_000_000 },
    assets: {
      large_image: "https://cdn.example.com/a.gif",
      large_url: "https://example.com/a",
      small_image: "s",
    },
  });
  assert.equal(sanitizeActivity({ type: 0, status_display_type: 9 }), null);
});

async function harness(options = {}) {
  const sockets = [];
  const statuses = [];
  const rpc = createDiscordRpc({
    paths: ["/tmp/discord-ipc-0"],
    minUpdateMs: 0,
    retryMs: 10,
    createConnection: () => {
      const s = new EventEmitter();
      s.destroyed = false;
      s.writes = [];
      s.ended = false;
      s.write = (b) => (s.writes.push(Buffer.from(b)), true);
      s.end = () => (s.ended = true);
      s.destroy = () => {
        s.destroyed = true;
        queueMicrotask(() => s.emit("close"));
      };
      sockets.push(s);
      queueMicrotask(() => s.emit("connect"));
      return s;
    },
    onStatus: (s) => statuses.push(s),
    ...options,
  });
  return { rpc, sockets, statuses };
}

function frames(socket) {
  const out = [];
  let buf = Buffer.concat(socket.writes);
  while (buf.length >= 8) {
    const len = buf.readInt32LE(4);
    out.push({ op: buf.readInt32LE(0), body: JSON.parse(buf.subarray(8, 8 + len).toString()) });
    buf = buf.subarray(8 + len);
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test("does nothing while disabled", async () => {
  const h = await harness();
  h.rpc.configure({ enabled: false, clientId: "" });
  await tick();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.rpc.status().enabled, false);
});

test("rejects an invalid application id instead of trying to connect", async () => {
  const h = await harness();
  h.rpc.configure({ enabled: true, clientId: "not-a-snowflake" });
  await tick();
  assert.equal(h.sockets.length, 0);
  assert.match(h.rpc.status().error, /valid Discord application id/);
});

test("handshakes, waits for READY, then sets and clears the activity", async () => {
  const h = await harness();
  h.rpc.configure({ enabled: true, clientId: "123456789012345678" });
  await tick();
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(frames(h.sockets[0])[0], {
    op: 0,
    body: { v: 1, client_id: "123456789012345678" },
  });
  assert.equal(h.rpc.status().connected, false);

  h.sockets[0].emit("data", encodeFrame(1, { cmd: "DISPATCH", evt: "READY", data: {} }));
  assert.equal(h.rpc.status().connected, true);

  h.rpc.setPresence({ type: 0, details: "Working in yoake", state: "A chat" });
  const set = frames(h.sockets[0]).filter((f) => f.body.cmd === "SET_ACTIVITY").at(-1);
  assert.equal(set.op, 1);
  assert.equal(set.body.args.activity.details, "Working in yoake");
  assert.equal(set.body.args.pid, process.pid);

  h.rpc.setPresence(null);
  const cleared = frames(h.sockets[0]).filter((f) => f.body.cmd === "SET_ACTIVITY").at(-1);
  assert.equal(cleared.body.args.activity, undefined);

  h.rpc.shutdown();
  assert.equal(h.sockets[0].ended, true);
});

test("answers Discord pings", async () => {
  const h = await harness();
  h.rpc.configure({ enabled: true, clientId: "123456789012345678" });
  await tick();
  h.sockets[0].emit("data", encodeFrame(3, { hello: "ping" }));
  const pong = frames(h.sockets[0]).find((f) => f.op === 4);
  assert.deepEqual(pong.body, { hello: "ping" });
  h.rpc.shutdown();
});

test("fetches a Discord application's public profile and caches it per id", async () => {
  clearDiscordApplicationCache();
  let calls = 0;
  const json = (t) => ({ ok: true, status: 200, json: async () => t });
  const fetchFn = async () => {
    calls++;
    return json({
      name: "Yoakeland",
      icon: "abc123",
      assets: [
        { id: "1", name: "logo", type: 1 },
        { id: "2", name: "typescript", type: 2 },
        { bad: true },
        null,
      ],
    });
  };
  const app = await fetchDiscordApplication("1564111675915903046", fetchFn);
  assert.equal(app.name, "Yoakeland");
  assert.equal(app.icon, "abc123");
  assert.deepEqual(app.assets, [
    { id: "1", name: "logo", type: "png" },
    { id: "2", name: "typescript", type: "gif" },
  ]);
  await fetchDiscordApplication("1564111675915903046", fetchFn);
  assert.equal(calls, 1); // cached

  await assert.rejects(() => fetchDiscordApplication("not-a-number", fetchFn), /valid Discord application id/);
  clearDiscordApplicationCache();
});

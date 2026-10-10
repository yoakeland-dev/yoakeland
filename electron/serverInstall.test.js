// Run with: node --test electron/
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assetName, installedServer, installServer } from "./serverInstall.js";

test("asset names follow Go's GOOS/GOARCH", () => {
  assert.equal(assetName("linux", "x64"), "yoakeland_linux_amd64");
  assert.equal(assetName("darwin", "arm64"), "yoakeland_darwin_arm64");
  assert.equal(assetName("win32", "x64"), "yoakeland_windows_amd64.exe");
});

test("install downloads this platform's asset, marks it executable and records the version", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  assert.equal(await installedServer(dir), null);
  const fake = async (url) =>
    url.includes("api.github.com")
      ? Response.json([{ tag_name: "v1.2.3", assets: [{ name: assetName(), browser_download_url: "https://dl/x", size: 3 }] }])
      : new Response("bin");
  const r = await installServer(dir, fake);
  assert.equal(r.version, "1.2.3");
  assert.equal(await readFile(r.path, "utf8"), "bin");
  if (process.platform !== "win32") assert.ok((await stat(r.path)).mode & 0o100);
  assert.deepEqual(await installedServer(dir), r);
});

test("a release without our asset, or no release at all, is a readable error", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  await assert.rejects(installServer(dir, async () => Response.json([{ tag_name: "v1", assets: [] }])), /has a yoakeland_/);
  await assert.rejects(installServer(dir, async () => Response.json([])), /no yoakeland server release has been published/);
  assert.equal(await installedServer(dir), null);
});

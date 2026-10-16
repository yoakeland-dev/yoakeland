// Run with: node --test electron/
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assetName, installedServer, installServer, managedBinPath, verifyChecksum } from "./serverInstall.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// A fake GitHub: one release with this platform's binary (body "bin") and its SHA256SUMS.
function fakeGitHub(bin = "bin", sums = `${sha256("bin")}  ${assetName()}\n`, version = "v1.2.3") {
  return async (url) =>
    url.includes("api.github.com")
      ? Response.json([
          {
            tag_name: version,
            assets: [
              { name: assetName(), browser_download_url: "https://dl/x", size: 3 },
              { name: "SHA256SUMS", browser_download_url: "https://dl/sums", size: sums.length },
            ],
          },
        ])
      : new Response(url.endsWith("/sums") ? sums : bin);
}

test("asset names follow Go's GOOS/GOARCH", () => {
  assert.equal(assetName("linux", "x64"), "yoakeland_linux_amd64");
  assert.equal(assetName("darwin", "arm64"), "yoakeland_darwin_arm64");
  assert.equal(assetName("win32", "x64"), "yoakeland_windows_amd64.exe");
});

test("install downloads this platform's asset, marks it executable and records the version", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  assert.equal(await installedServer(dir), null);
  const r = await installServer(dir, fakeGitHub());
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

test("a download is accepted only when its hash is the one SHA256SUMS lists for its name", () => {
  const n = assetName();
  const sums = `${sha256("server")}  ${n}\n${sha256("other")} *yoakeland_windows_amd64.exe\n`;
  verifyChecksum(Buffer.from("server"), sums, n);
  verifyChecksum(Buffer.from("other"), sums, "yoakeland_windows_amd64.exe");
  assert.throws(() => verifyChecksum(Buffer.from("tampered"), sums, n), /does not match/);
  assert.throws(() => verifyChecksum(Buffer.from("server"), sums, "yoakeland_darwin_arm64"), /has no entry/);
  assert.throws(() => verifyChecksum(Buffer.from("server"), `${sha256("x")}  ${n}\n${sha256("server")}  ${n}\n`, n), /more than once/);
});

test("a binary that fails its checksum is never installed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  await assert.rejects(installServer(dir, fakeGitHub("evil", `${sha256("bin")}  ${assetName()}\n`)), /does not match/);
  assert.equal(await installedServer(dir), null);
  await assert.rejects(stat(managedBinPath(dir) + ".part"));
});

test("an install never replaces a newer server with an older release", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yoake-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  await writeFile(managedBinPath(dir), "newer");
  await writeFile(path.join(dir, "server", "version"), "1.3.0\n");
  await assert.rejects(installServer(dir, fakeGitHub("bin", undefined, "v1.2.3")), /refusing to replace server v1\.3\.0/);
  assert.equal(await readFile(managedBinPath(dir), "utf8"), "newer");
});

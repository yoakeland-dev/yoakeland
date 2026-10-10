// The yoakeland server, downloaded from GitHub releases into <userData>/server/.
// Release contract: tag `vX.Y.Z`, one raw binary per platform named by `assetName`.
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "yoakeland-dev/yoakeland-server";

export function assetName(platform = process.platform, arch = process.arch) {
  const os = platform === "win32" ? "windows" : platform;
  return `yoakeland_${os}_${arch === "x64" ? "amd64" : arch}${platform === "win32" ? ".exe" : ""}`;
}

export const managedBinPath = (dir, platform = process.platform) =>
  path.join(dir, "server", platform === "win32" ? "yoakeland.exe" : "yoakeland");

const versionFile = (dir) => path.join(dir, "server", "version");

/** The binary this app downloaded and its version, or null when it never did. */
export async function installedServer(dir) {
  try {
    const version = (await readFile(versionFile(dir), "utf8")).trim();
    await stat(managedBinPath(dir));
    return { path: managedBinPath(dir), version };
  } catch {
    return null;
  }
}

/** The newest release that has a binary for this platform. */
export async function latestRelease(fetchFn = fetch) {
  // Releases are all prereleases, which /releases/latest never returns, so read the list.
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the releases`);
  const releases = await res.json();
  if (!releases.length) throw new Error("no yoakeland server release has been published yet");
  const name = assetName();
  for (const rel of releases) {
    const asset = rel.assets?.find((a) => a.name === name);
    if (asset) return { version: String(rel.tag_name).replace(/^v/, ""), url: asset.browser_download_url, size: asset.size };
  }
  throw new Error(`no yoakeland server release has a ${name} for this machine`);
}

/** Downloads the latest release over any previous one; returns the same shape as installedServer. */
export async function installServer(dir, fetchFn = fetch) {
  const rel = await latestRelease(fetchFn);
  const res = await fetchFn(rel.url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const bin = managedBinPath(dir);
  await mkdir(path.dirname(bin), { recursive: true });
  // Temp file and rename: a failed download never replaces a working binary, and on Unix a
  // running server keeps its old inode.
  const tmp = bin + ".part";
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp, { mode: 0o755 }));
    await chmod(tmp, 0o755);
    await rename(tmp, bin);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await writeFile(versionFile(dir), rel.version + "\n");
  return { path: bin, version: rel.version };
}

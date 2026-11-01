// The yoakeland server, downloaded from GitHub releases into <userData>/server/.
// Release contract: tag `vX.Y.Z`, one raw binary per platform named by `assetName`, and a
// `SHA256SUMS` file next to them (sha256sum format). The sums come from the same release, so they
// catch a corrupt or swapped download, not a release that was published with the wrong files.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "yoakeland-dev/yoakeland-server";
const SUMS_NAME = "SHA256SUMS";

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

/** Throws unless `bytes` hash to the digest `sumsText` lists for `name` (`<hex>  <name>` lines). */
export function verifyChecksum(bytes, sumsText, name) {
  const want = new Set();
  for (const line of sumsText.split("\n")) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.replace(/\r$/, ""));
    if (m && m[2] === name) want.add(m[1].toLowerCase());
  }
  if (want.size !== 1) {
    throw new Error(want.size ? `${SUMS_NAME} lists ${name} more than once` : `${SUMS_NAME} has no entry for ${name}`);
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (!want.has(got)) throw new Error(`${name} does not match its ${SUMS_NAME} entry; the download is corrupt or tampered with`);
}

// Dotted numbers, as src/lib/serverVersion.ts. Among builds with the same numbers a nightly ("0.1.8-early.20261102")
// is newer than the release of that number (it is built after it) and nightlies sort by date.
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  const early = (v) => {
    const m = /-early(?:\.(\d+))?/.exec(String(v));
    return m ? Number(m[1] ?? 0) + 1 : 0;
  };
  return early(a) - early(b);
}

/** The newest release that has a binary for this platform and checksums to verify it with. */
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
    const sums = rel.assets?.find((a) => a.name === SUMS_NAME);
    if (asset && sums) {
      return {
        version: String(rel.tag_name).replace(/^v/, ""),
        url: asset.browser_download_url,
        size: asset.size,
        sumsUrl: sums.browser_download_url,
      };
    }
  }
  throw new Error(`no yoakeland server release has a ${name} and ${SUMS_NAME} for this machine`);
}

/** Downloads the latest release over any previous one; returns the same shape as installedServer. */
export async function installServer(dir, fetchFn = fetch) {
  const rel = await latestRelease(fetchFn);
  // There is no way to ask for an older version, so an older release is never installed over a newer one.
  const have = await installedServer(dir);
  if (have && compareVersions(rel.version, have.version) < 0) {
    throw new Error(`refusing to replace server v${have.version} with the older v${rel.version}`);
  }
  const sumsRes = await fetchFn(rel.sumsUrl);
  if (!sumsRes.ok) throw new Error(`checksum download failed: ${sumsRes.status}`);
  const sums = await sumsRes.text();
  const res = await fetchFn(rel.url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const bin = managedBinPath(dir);
  await mkdir(path.dirname(bin), { recursive: true });
  // Temp file and rename: a failed download never replaces a working binary, and on Unix a
  // running server keeps its old inode. It only becomes executable once its checksum matches.
  const tmp = bin + ".part";
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    verifyChecksum(await readFile(tmp), sums, assetName());
    await chmod(tmp, 0o755);
    await rename(tmp, bin);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await writeFile(versionFile(dir), rel.version + "\n");
  return { path: bin, version: rel.version };
}

/** The server shipped inside this app (extraResources: <resources>/server/yoakeland and its version file), or null. */
export async function bundledServer(resources = process.resourcesPath) {
  if (!resources) return null;
  const dir = path.join(resources, "server");
  const bin = path.join(dir, process.platform === "win32" ? "yoakeland.exe" : "yoakeland");
  try {
    const version = (await readFile(path.join(dir, "version"), "utf8")).trim();
    await stat(bin);
    return { path: bin, version };
  } catch {
    return null;
  }
}

/** Puts the bundled server in place when none is installed or the installed one is older, so an app update
 * brings the matching server with it. A newer downloaded server (a hotfix) is kept. Returns what is installed. */
export async function ensureBundledServer(dir, resources) {
  const bundled = await bundledServer(resources);
  const have = await installedServer(dir);
  if (!bundled || (have && compareVersions(bundled.version, have.version) <= 0)) return have;
  const bin = managedBinPath(dir);
  await mkdir(path.dirname(bin), { recursive: true });
  const tmp = bin + ".part";
  try {
    await copyFile(bundled.path, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, bin);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await writeFile(versionFile(dir), bundled.version + "\n");
  return { path: bin, version: bundled.version };
}

/** True when `have` is a numeric release older than `latest`. Missing means a server that predates
 * version reporting; a non-numeric one (a dev build) is never called old. */
export function isOlder(have: string | null | undefined, latest: string): boolean {
  if (have == null || have === "") return true;
  const parse = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
  const a = parse(have);
  if (a.some(Number.isNaN)) return false;
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}

/** "0.1.6" -> "v0.1.6"; a dev build's "dev" stays as is. */
export const fmtVersion = (v: string) => (/^\d/.test(v) ? `v${v}` : v);

/** Where room is short: "0.1.7-early.202611042156" -> "v0.1.7 early". The full string belongs in a tooltip. */
export const shortVersion = (v: string) => fmtVersion(v).replace(/-early\.\d+$/, " early");

/** True when `server` is ahead of this `client`: a nightly of a stable client, or a newer release.
 * An early client never warns (it is the newest build there is), nor does a server that predates version reporting. */
export function serverAhead(server: string | null | undefined, client: string): boolean {
  if (!server || client.includes("-early")) return false;
  return server.includes("-early") || isOlder(client, server);
}

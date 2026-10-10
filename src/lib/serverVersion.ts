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

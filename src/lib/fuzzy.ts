/** Quick-open matching: `query`'s characters in order somewhere in `path`, case-insensitive.
 * Lower is better; null is no match. Hits in the file name, at word starts and in a row
 * score best, so "fe" finds FileEditor.svelte before some/deep/fe/... path. */
export function fuzzyScore(path: string, query: string): number | null {
  const p = path.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const nameStart = p.lastIndexOf("/") + 1;
  let score = 0;
  let prev = -2;
  let i = 0;
  for (const ch of q) {
    const at = p.indexOf(ch, i);
    if (at === -1) return null;
    score += at - i; // characters skipped
    if (at !== prev + 1) score += 3; // a new run
    if (at >= nameStart) score -= 2;
    if (at === 0 || "/._-".includes(p[at - 1])) score -= 2;
    prev = at;
    i = at + 1;
  }
  return score + p.length / 100; // shorter paths break ties
}

export function fuzzyFilter(paths: string[], query: string, limit = 50): string[] {
  const scored: [number, string][] = [];
  for (const path of paths) {
    const s = fuzzyScore(path, query);
    if (s !== null) scored.push([s, path]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, path]) => path);
}

/** Where fuzzyScore's greedy scan matched `query` in `path`, for highlighting. */
export function fuzzyIndices(path: string, query: string): number[] {
  const p = path.toLowerCase();
  const out: number[] = [];
  let i = 0;
  for (const ch of query.toLowerCase().replace(/\s+/g, "")) {
    const at = p.indexOf(ch, i);
    if (at === -1) return [];
    out.push(at);
    i = at + 1;
  }
  return out;
}

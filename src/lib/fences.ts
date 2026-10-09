/** Whether `raw` ends inside a fenced code block that hasn't closed yet, i.e. its code is still
 * streaming in. Follows CommonMark: a fence closes on the same character, at least as long as the
 * opener, with nothing after it, so a shorter fence (or another character's) quoted inside is
 * just code. Leading indentation and `>` quote markers are ignored, for fences inside lists and
 * blockquotes. */
export function hasOpenFence(raw: string): boolean {
  let open: { char: string; len: number } | undefined;
  for (const line of raw.split("\n")) {
    const m = /^[\s>]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const [, fence, rest] = m;
    if (open) {
      if (fence[0] === open.char && fence.length >= open.len && !rest.trim()) open = undefined;
    } else if (fence[0] !== "`" || !rest.includes("`")) {
      open = { char: fence[0], len: fence.length };
    }
  }
  return !!open;
}

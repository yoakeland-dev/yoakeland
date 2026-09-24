/** Pass `app.now` as `now` in a template so it re-renders as time passes. */
export function relTime(iso: string | number, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function shortNum(n: number): string {
  return compactNumber.format(n);
}

export function basename(path: string): string {
  if (typeof path !== "string") return String(path ?? "");
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

// Title arrives asynchronously after the first exchange; show a placeholder until then.
export function sessionTitle(s: { title?: string | null }): string {
  return s.title || "New chat";
}

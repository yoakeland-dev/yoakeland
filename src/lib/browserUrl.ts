/** Typed text to a URL: dev-server shorthands go to http://localhost, bare words to a search. */
export function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^(https?:\/\/|about:)/i.test(s)) return s;
  if (/^\d{2,5}$/.test(s)) return `http://localhost:${s}`;
  if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$)/i.test(s)) return `http://${s}`;
  if (/^\S+\.\S+$/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

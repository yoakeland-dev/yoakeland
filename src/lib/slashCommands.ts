// The composer's own commands: typed like a skill (`/name`) but handled here, never sent as a prompt.
// Pure parsing, so the composer only has to act on the result.

export type SlashCommand =
  | { kind: "compact"; instructions: string }
  /** `tokens`: this chat compacts at that size; 0 = back to the server's setting; null = leave it. */
  | { kind: "autocompact"; auto: boolean | null; tokens: number | null }
  | { kind: "autocompact-help" }
  | { kind: "invalid"; message: string };

export const SLASH_COMMANDS = [
  { name: "compact", argumentHint: "[what to keep]", description: "Summarize the conversation now" },
  { name: "autocompact", argumentHint: "on | off | 400k | default", description: "Change when this chat compacts itself" },
] as const;

/** "400k", "1.5m", "400000" → tokens; null when it isn't a size. */
export function parseTokens(word: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(word);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * ({ "": 1, k: 1e3, m: 1e6 } as Record<string, number>)[m[2].toLowerCase()]);
  return n > 0 ? n : null;
}

/** The command a message is, or null when it's an ordinary message (a path like `/etc/hosts`, or a skill). */
export function parseSlashCommand(text: string): SlashCommand | null {
  const m = /^\/(compact|autocompact)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const arg = (m[2] ?? "").trim();
  if (m[1] === "compact") return { kind: "compact", instructions: arg };
  if (!arg) return { kind: "autocompact-help" };
  const word = arg.toLowerCase();
  if (word === "off") return { kind: "autocompact", auto: false, tokens: null };
  if (word === "on") return { kind: "autocompact", auto: true, tokens: null };
  if (word === "default" || word === "reset") return { kind: "autocompact", auto: true, tokens: 0 };
  const tokens = parseTokens(word);
  if (tokens === null) return { kind: "invalid", message: "Use /autocompact on, off, default, or a size like 400k" };
  return { kind: "autocompact", auto: true, tokens };
}

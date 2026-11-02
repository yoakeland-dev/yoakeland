// Settings as a file, to move them between installs (Stable to Early, one machine to another).
// Pairing trust and the first-run flag belong to the install, so they neither leave nor arrive.
const LOCAL = new Set(["trustedCaByHostPort", "trustedCaByServer", "onboarded"]);
const KIND = "yoakeland-settings";

export function settingsToFile(settings: object): string {
  const entries = Object.entries(settings).filter(([k]) => !LOCAL.has(k));
  return JSON.stringify({ kind: KIND, settings: Object.fromEntries(entries) }, null, 2) + "\n";
}

/** The values from `text` that `current` has a setting for, of the same type; throws when it isn't a settings file. */
export function settingsFromFile(text: string, current: object): Record<string, unknown> {
  let file: { kind?: unknown; settings?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("That isn't a settings file.");
  }
  const s = file?.kind === KIND && file.settings && typeof file.settings === "object" ? (file.settings as Record<string, unknown>) : null;
  if (!s) throw new Error("That isn't a settings file.");
  const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  const cur = current as Record<string, unknown>;
  return Object.fromEntries(Object.entries(s).filter(([k, v]) => !LOCAL.has(k) && k in cur && kind(v) === kind(cur[k])));
}

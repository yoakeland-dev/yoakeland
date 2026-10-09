// Vite-only (import.meta.glob), so the parsing itself stays in theme.ts where node --test can reach it.
import { parseThemeFile, type AppTheme } from "./theme";

const files = import.meta.glob<unknown>("./themes/*.json", { eager: true, import: "default" });

/** One per file in src/lib/themes/, alphabetical. A broken file would fail theme.test.js. */
export const APP_THEME_PRESETS: AppTheme[] = Object.entries(files).flatMap(([path, json]) => {
  const t = parseThemeFile(path.slice(path.lastIndexOf("/") + 1, -".json".length), json);
  return "error" in t ? [] : [t];
});

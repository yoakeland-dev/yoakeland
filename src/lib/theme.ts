// A preset is just a shipped accent value run through the same generator a custom color goes
// through: every token below is the same hue, carried at different saturation/lightness per role.

export interface ThemeTokens {
  /** Flat, deliberately: a gradient here just fought with the accent for attention. */
  bg: string;
  panelBg: string;
  panelBorder: string;
  /** `panelBorder` split into the two halves a bevel needs (`border-block-color`, app.css);
   * light scheme inverts which end is lighter since its border is dark ink on a pale surface. */
  panelBorderTop: string;
  panelBorderBottom: string;
  sidebarFg: string;
  sidebarFgDim: string;
  sidebarHover: string;
  sidebarActive: string;
  text: string;
  textDim: string;
  accent: string;
  bubbleUserBg: string;
  bubbleBorder: string;
  statusbarBg: string;
  statusbarFg: string;
}

export function hexToHue(hex: string): number {
  const clean = hex.replace("#", "");
  const bytes = clean.match(/.{1,2}/g)?.map((x) => parseInt(x, 16) / 255) ?? [0.5, 0.6, 1];
  const [r, g, b] = bytes;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d) % 6;
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function deriveTheme(accentHex: string, mode: "dark" | "light"): ThemeTokens {
  const h = Math.round(hexToHue(accentHex));
  if (mode === "light") {
    return {
      bg: `hsl(${h} 18% 90%)`,
      panelBg: `hsl(${h} 20% 100%)`,
      panelBorder: `hsla(${h} 30% 10% / 0.09)`,
      panelBorderTop: `hsla(${h} 30% 10% / 0.06)`,
      panelBorderBottom: `hsla(${h} 30% 10% / 0.12)`,
      sidebarFg: `hsl(${h} 20% 15%)`,
      sidebarFgDim: `hsl(${h} 10% 42%)`,
      sidebarHover: `hsla(${h} 30% 10% / 0.05)`,
      sidebarActive: `hsla(${h} 30% 10% / 0.08)`,
      text: `hsl(${h} 20% 9%)`,
      textDim: `hsl(${h} 10% 39%)`,
      accent: accentHex,
      bubbleUserBg: `hsl(${h} 30% 94%)`,
      bubbleBorder: `hsla(${h} 30% 10% / 0.08)`,
      statusbarBg: `hsl(${h} 25% 93%)`,
      statusbarFg: `hsl(${h} 10% 39%)`,
    };
  }
  return {
    // Surfaces stay low-saturation so the accent (often 60-90%) pops instead of blending in.
    bg: `hsl(${h} 15% 5%)`,
    panelBg: `hsl(${h} 12% 7%)`,
    panelBorder: `hsla(${h} 20% 95% / 0.08)`,
    panelBorderTop: `hsla(${h} 20% 95% / 0.11)`,
    panelBorderBottom: `hsla(${h} 20% 95% / 0.05)`,
    sidebarFg: `hsl(${h} 10% 85%)`,
    sidebarFgDim: `hsl(${h} 6% 58%)`,
    sidebarHover: `hsla(${h} 20% 95% / 0.06)`,
    sidebarActive: `hsla(${h} 20% 95% / 0.1)`,
    text: `hsl(${h} 10% 92%)`,
    textDim: `hsl(${h} 6% 62%)`,
    accent: accentHex,
    bubbleUserBg: `hsl(${h} 13% 16%)`,
    bubbleBorder: `hsla(${h} 20% 95% / 0.08)`,
    statusbarBg: `hsl(${h} 13% 8%)`,
    statusbarFg: `hsl(${h} 6% 62%)`,
  };
}

/** xterm.js's `ITheme` shape: every color it wants is a literal parseable
 * value, not a `var(--x)` reference, since it does its own contrast/blend
 * math on them. */
export interface TerminalColorTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Background/foreground/cursor derive from the same surface hue as the rest of the UI
 * (deriveTheme); the 16 ANSI slots are a fixed hand-picked palette instead, since programs
 * already assume specific hues for them (red is red, green is green). */
export function deriveTerminalTheme(accentHex: string, mode: "dark" | "light"): TerminalColorTheme {
  const h = Math.round(hexToHue(accentHex));
  if (mode === "light") {
    return {
      background: `hsl(${h} 20% 100%)`,
      foreground: `hsl(${h} 20% 9%)`,
      cursor: accentHex,
      cursorAccent: `hsl(${h} 20% 100%)`,
      selectionBackground: `hsla(${h} 30% 10% / 0.15)`,
      black: "#3f4451",
      red: "#c91b1b",
      green: "#4b8b13",
      yellow: "#b5890c",
      blue: "#1c6ecf",
      magenta: "#a626a4",
      cyan: "#0184bc",
      white: "#a0a1a7",
      brightBlack: "#696c77",
      brightRed: "#e05561",
      brightGreen: "#5eb95e",
      brightYellow: "#d2a02a",
      brightBlue: "#4aa5f0",
      brightMagenta: "#c162de",
      brightCyan: "#00acc1",
      brightWhite: "#1c1e26",
    };
  }
  return {
    background: `hsl(${h} 12% 7%)`,
    foreground: `hsl(${h} 10% 92%)`,
    cursor: accentHex,
    cursorAccent: `hsl(${h} 12% 7%)`,
    selectionBackground: `hsla(${h} 20% 95% / 0.18)`,
    black: "#3b3f4c",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#c9ccd6",
    brightBlack: "#5c6370",
    brightRed: "#e88a93",
    brightGreen: "#addb8f",
    brightYellow: "#f0d090",
    brightBlue: "#7cc4f3",
    brightMagenta: "#d493e6",
    brightCyan: "#7fd3de",
    brightWhite: "#f2f3f7",
  };
}

/** Standard, widely-published palettes kept verbatim so e.g. Dracula's specific reds/greens still look right. */
export interface TerminalThemePreset {
  id: string;
  name: string;
  colors: TerminalColorTheme;
}

export const TERMINAL_THEME_PRESETS: TerminalThemePreset[] = [
  {
    id: "dracula",
    name: "Dracula",
    colors: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "nord",
    name: "Nord",
    colors: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    colors: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    colors: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      cursorAccent: "#282828",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    colors: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      cursorAccent: "#272822",
      selectionBackground: "#49483e",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    colors: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#839496",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    colors: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#657b83",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
];

/** The hue slider under the color-wheel swatch: fixed saturation/lightness so
 * the whole ring stays equally vivid, only the hue moves. */
export function hslToHex(h: number, s: number, l: number): string {
  // s/l must be fractions (not 0-100) before the min(l, 1-l) trick below, or it can produce
  // negative channel values that `.toString(16)` turns into malformed, silently-ignored hex.
  const s1 = s / 100;
  const l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l1 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Added/removed lines are their own tokens, not success/danger, so red/green can be swapped for
 * a pair that survives the common color-vision deficiencies without recoloring errors. */
export const DIFF_COLORS = {
  default: { add: "#58d68d", del: "#ff6b6b" },
  colorblind: { add: "#4aa3ff", del: "#ff9f43" },
} as const;

/** One side (dark or light) of an app theme. Four hex colors define it; every other token is
 * mixed from them (tokensFromVariant), `tokens` overrides any one, and `terminal` sets ANSI slots. */
export interface ThemeVariant {
  bg: string;
  panelBg: string;
  text: string;
  accent: string;
  tokens?: Partial<ThemeTokens>;
  /** Overrides on the terminal/code palette; slots left out come from deriveTerminalTheme. */
  terminal?: Partial<TerminalColorTheme>;
}

/** A theme is one file holding whichever of the two variants it has. */
export interface AppTheme {
  id: string;
  name: string;
  dark?: ThemeVariant;
  light?: ThemeVariant;
}

/** deriveTheme's hue-tinted lightness can't fit an arbitrary palette (Nord's bg would sit
 * lighter than its derived statusbar), so the rest of the tokens are mixed from the palette. */
export function tokensFromVariant(v: ThemeVariant, mode: "dark" | "light"): ThemeTokens {
  const mix = (pct: number, into = "transparent") => `color-mix(in srgb, ${v.text} ${pct}%, ${into})`;
  const textDim = mix(60, v.bg);
  const border = mix(8);
  return {
    bg: v.bg,
    panelBg: v.panelBg,
    panelBorder: border,
    panelBorderTop: mix(mode === "dark" ? 11 : 6),
    panelBorderBottom: mix(mode === "dark" ? 5 : 12),
    sidebarFg: v.text,
    sidebarFgDim: textDim,
    sidebarHover: mix(6),
    sidebarActive: mix(10),
    text: v.text,
    textDim,
    accent: v.accent,
    bubbleUserBg: mix(8, v.panelBg),
    bubbleBorder: border,
    statusbarBg: mix(3, v.bg),
    statusbarFg: textDim,
    ...v.tokens,
  };
}

/** The tokens a mode paints with: its theme's variant, or ones derived from the accent. */
export const tokensFor = (t: AppTheme | undefined, accent: string, mode: "dark" | "light"): ThemeTokens => {
  const v = t?.[mode];
  return v ? tokensFromVariant(v, mode) : deriveTheme(accent, mode);
};

/** Terminal and code-block colors for a variant: its surfaces, its own ANSI slots where given. */
export function terminalFromVariant(v: ThemeVariant, mode: "dark" | "light"): TerminalColorTheme {
  return {
    ...deriveTerminalTheme(v.accent, mode),
    background: v.panelBg,
    foreground: v.text,
    cursor: v.accent,
    cursorAccent: v.panelBg,
    selectionBackground: `${v.accent}40`,
    ...v.terminal,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
// These land in style.setProperty, so keep out anything that could fetch or smuggle a declaration.
const cssColor = (v: unknown): v is string => typeof v === "string" && v.length < 120 && !/url\(|[;{}]|\/\*/i.test(v);

const TOKEN_KEYS: (keyof ThemeTokens)[] = [
  "bg", "panelBg", "panelBorder", "panelBorderTop", "panelBorderBottom", "sidebarFg", "sidebarFgDim",
  "sidebarHover", "sidebarActive", "text", "textDim", "accent", "bubbleUserBg", "bubbleBorder",
  "statusbarBg", "statusbarFg",
];
const TERMINAL_KEYS = Object.keys(deriveTerminalTheme("#000000", "dark")) as (keyof TerminalColorTheme)[];

function parseVariant(raw: any): ThemeVariant | string {
  if (!raw || typeof raw !== "object") return "not an object";
  for (const k of ["bg", "panelBg", "text", "accent"]) if (!HEX.test(raw[k])) return `${k} must be a #rrggbb color`;
  const v: ThemeVariant = { bg: raw.bg, panelBg: raw.panelBg, text: raw.text, accent: raw.accent };
  const tokens: Partial<ThemeTokens> = {};
  for (const k of TOKEN_KEYS) if (cssColor(raw.tokens?.[k])) tokens[k] = raw.tokens[k];
  if (Object.keys(tokens).length) v.tokens = tokens;
  // xterm parses these itself, so literal hex only.
  const terminal: Partial<TerminalColorTheme> = {};
  for (const k of TERMINAL_KEYS) if (HEX.test(raw.terminal?.[k])) terminal[k] = raw.terminal[k];
  if (Object.keys(terminal).length) v.terminal = terminal;
  return v;
}

/** One theme file, hand-edited or generated: `{ name, dark?, light? }`. */
export function parseThemeFile(id: string, raw: unknown): AppTheme | { error: string } {
  const r = raw as any;
  if (!r || typeof r !== "object") return { error: "not an object" };
  const theme: AppTheme = { id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : id };
  for (const mode of ["dark", "light"] as const) {
    if (r[mode] == null) continue;
    const v = parseVariant(r[mode]);
    if (typeof v === "string") return { error: `${mode}: ${v}` };
    theme[mode] = v;
  }
  return theme.dark || theme.light ? theme : { error: "needs a dark or light section" };
}

/** Folds the files themes/*.json holds into themes, reporting what was wrong with each reject. */
export function parseThemeFiles(files: { file: string; text: string }[]): { themes: AppTheme[]; problems: string[] } {
  const themes: AppTheme[] = [];
  const problems: string[] = [];
  for (const { file, text } of files) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      problems.push(`${file}: not valid JSON`);
      continue;
    }
    const t = parseThemeFile(`custom:${file.replace(/\.json$/i, "")}`, json);
    if ("error" in t) problems.push(`${file}: ${t.error}`);
    else themes.push(t);
  }
  return { themes, problems };
}

// OKLab/OKLCH conversion (Björn Ottosson's formulas): bucketing by hue and weighting by chroma
// picks the color the eye notices, instead of the flat gray-brown an sRGB mean produces.
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function linearToOklch(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

function oklchToHex(L: number, C: number, h: number): string {
  const hr = (h * Math.PI) / 180;
  const a = Math.cos(hr) * C;
  const bb = Math.sin(hr) * C;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toHex = (v: number) => linearToSrgb(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function extractAccentFromImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 48;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      const HUE_BUCKETS = 24;
      const bucketWeight = new Array(HUE_BUCKETS).fill(0);
      const pixels: { L: number; C: number; h: number }[] = [];

      for (let i = 0; i < data.length; i += 4) {
        const r = srgbToLinear(data[i]);
        const g = srgbToLinear(data[i + 1]);
        const b = srgbToLinear(data[i + 2]);
        const [L, C, h] = linearToOklch(r, g, b);
        pixels.push({ L, C, h });
        // chroma-squared weighting: near-gray pixels barely vote, so a few saturated pixels can win.
        bucketWeight[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS] += C * C;
      }

      let bestBucket = 0;
      for (let i = 1; i < HUE_BUCKETS; i++) {
        if (bucketWeight[i] > bucketWeight[bestBucket]) bestBucket = i;
      }
      const bucketSize = 360 / HUE_BUCKETS;
      const bestHueCenter = bestBucket * bucketSize + bucketSize / 2;

      // Weighted by chroma, so a saturated photo yields a saturated accent and a washed-out one a muted one.
      let sumL = 0, sumC = 0, sumW = 0;
      for (const p of pixels) {
        let dh = Math.abs(p.h - bestHueCenter);
        if (dh > 180) dh = 360 - dh;
        if (dh > bucketSize * 1.5) continue;
        const w = p.C;
        sumL += p.L * w;
        sumC += p.C * w;
        sumW += w;
      }

      const hasColor = sumW > 1e-6;
      let L = hasColor ? sumL / sumW : 0.6;
      let C = hasColor ? sumC / sumW : 0;
      const h = hasColor ? bestHueCenter : 0;

      // Floor chroma so the accent never goes fully gray; clamp lightness to read on both surfaces.
      C = Math.max(0.05, Math.min(C, 0.33));
      L = Math.max(0.55, Math.min(L, 0.82));

      resolve(oklchToHex(L, C, h));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

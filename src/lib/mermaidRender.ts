// Mermaid source -> sanitized SVG, themed to the app. Standalone (no markdown, no Svelte), so a
// diagram made some other way, e.g. a structured plan turned into Mermaid, can reuse it.
// Mermaid is a big library: it's imported on the first diagram, and its diagram types lazily on top.
import type { Mermaid } from "mermaid";
import { sanitizeSvg } from "./sanitize";

/** `vars` are Mermaid `themeVariables` with concrete colors (Mermaid derives shades from them, so
 * `var()` and `color-mix()` won't do). Part of the cache key, so a re-theme re-renders. */
export type MermaidTheme = { dark: boolean; fontFamily: string; vars: Record<string, string> };

let lib: Promise<Mermaid> | undefined;
const loadMermaid = () => (lib ??= import("mermaid").then((m) => m.default));

const cache = new Map<string, string>();
const CACHE_MAX = 50;
const inflight = new Map<string, Promise<string>>();
// Mermaid keeps global config and scratch elements in <body>: one render at a time.
let queue: Promise<unknown> = Promise.resolve();
let configured = "";
let seq = 0;

const themeKey = (t: MermaidTheme) => JSON.stringify([t.dark, t.fontFamily, t.vars]);
const keyOf = (src: string, t: MermaidTheme) => themeKey(t) + "\0" + src;

/** A finished render for this source and theme, if there is one: lets a caller paint in the same frame. */
export function cachedMermaid(src: string, theme: MermaidTheme): string | undefined {
  const key = keyOf(src, theme);
  const svg = cache.get(key);
  if (svg !== undefined) {
    cache.delete(key); // most recently used goes last
    cache.set(key, svg);
  }
  return svg;
}

/** The diagram as sanitized SVG. Rejects with Mermaid's own message when the source doesn't parse. */
export function renderMermaid(src: string, theme: MermaidTheme): Promise<string> {
  const key = keyOf(src, theme);
  const hit = cachedMermaid(src, theme);
  if (hit !== undefined) return Promise.resolve(hit);
  let job = inflight.get(key);
  if (!job) {
    job = queue.then(() => draw(src, theme, key));
    queue = job.catch(() => {});
    inflight.set(key, job);
    const done = () => inflight.delete(key);
    job.then(done, done);
  }
  return job;
}

async function draw(src: string, theme: MermaidTheme, key: string): Promise<string> {
  const mermaid = await loadMermaid();
  const tk = themeKey(theme);
  if (configured !== tk) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Plain SVG text labels rather than <foreignObject> HTML ones, where a diagram type allows it.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      logLevel: "fatal",
      theme: "base",
      fontFamily: theme.fontFamily,
      themeVariables: { darkMode: theme.dark, ...theme.vars },
    });
    configured = tk;
  }
  await mermaid.parse(src); // throws on a syntax error, before anything is drawn
  const id = `mmd-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, src);
    // The sanitizer drops <foreignObject>, and with it that diagram's labels (journey does this).
    if (/<foreignObject/i.test(svg)) throw new Error("This diagram type draws its labels as HTML, which isn't shown");
    const safe = sanitizeSvg(svg);
    if (!safe.includes("<svg")) throw new Error("Mermaid produced no diagram");
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, safe);
    return safe;
  } finally {
    // A failed render leaves its scratch element behind.
    document.getElementById(id)?.remove();
    document.getElementById("d" + id)?.remove();
  }
}

let canvas: CanvasRenderingContext2D | null | undefined;
/** Any CSS color (hex, rgb(), color-mix(), oklch()...) as plain #rrggbb(aa), which Mermaid can
 * parse. Painted and read back: canvas.fillStyle serializes newer color spaces as color(srgb ...). */
function concrete(color: string): string {
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas) return color;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = "#000000";
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + hex(r) + hex(g) + hex(b) + (a < 255 ? hex(a) : "");
}

/** The current app theme as a MermaidTheme, read from the CSS variables applySettings() sets. */
export function mermaidThemeFromCss(dark: boolean): MermaidTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const bg = concrete(v("--code-bg", dark ? "#0b0c11" : "#ffffff"));
  const text = concrete(v("--text", dark ? "#e7e8ee" : "#1b1c22"));
  const dim = concrete(v("--text-dim", "#9498a8"));
  const accent = concrete(v("--accent", "#7c9bff"));
  const mix = (a: string, pct: number, b: string) => concrete(`color-mix(in srgb, ${a} ${pct}%, ${b})`);
  const fill = mix(accent, 18, bg);
  return {
    dark,
    fontFamily: getComputedStyle(document.body).fontFamily,
    vars: {
      background: bg,
      primaryColor: fill,
      primaryTextColor: text,
      primaryBorderColor: mix(accent, 70, bg),
      secondaryColor: mix(text, 10, bg),
      tertiaryColor: mix(text, 6, bg),
      lineColor: dim,
      textColor: text,
      mainBkg: fill,
      nodeBorder: mix(accent, 70, bg),
      clusterBkg: mix(text, 5, bg),
      clusterBorder: mix(text, 25, bg),
      titleColor: text,
      edgeLabelBackground: bg,
      noteBkgColor: mix(accent, 12, bg),
      noteTextColor: text,
      noteBorderColor: mix(accent, 50, bg),
    },
  };
}

/** Offers `svg` (as rendered above) to the user as a downloaded file. */
export function downloadSvg(svg: string, name = "diagram.svg") {
  const xml = svg.includes("xmlns=") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

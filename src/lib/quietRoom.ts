/** Max effort turns the room down: surfaces dim and cool, signal colors cool, spinners slow.
 * The composer keeps the theme's own colors and gets a lamplight glow instead (app.css). */
const DIM = 0.25;
const DESAT = 0.4;
const SLOW = 2;
const FADE_MS = 1000;

const SURFACES = ["--bg", "--panel-bg", "--statusbar-bg", "--bubble-user-bg", "--code-bg"];
// applySettings writes each of these's real value to --orig-<name>, and this decides what --<name> is.
const THEMED = [...SURFACES, "--accent"];
const FADED = [...THEMED, "--success", "--warning", "--danger", "--info"];

let on = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const shift = (color: string, dim: number) => `oklch(from ${color} calc(l * ${1 - dim}) calc(c * ${1 - DESAT}) h / alpha)`;

export function applyQuietTokens() {
  const root = document.documentElement;
  for (const t of THEMED) {
    const orig = root.style.getPropertyValue(`--orig${t.slice(1)}`);
    if (orig) root.style.setProperty(t, on ? shift(orig, SURFACES.includes(t) ? DIM : 0) : orig);
  }
}

export function setQuietRoom(next: boolean) {
  if (next === on) return;
  on = next;
  const root = document.documentElement;
  // The fade is only declared while it runs, so a theme change never animates.
  root.style.setProperty("--room-fade", `${FADE_MS}ms`);
  root.style.transition = FADED.map((t) => `${t} ${FADE_MS}ms ease-in-out`).join(", ");
  if (on) root.dataset.effort = "max";
  else delete root.dataset.effort;
  root.style.setProperty("--icon-slow", on ? String(SLOW) : "1");
  applyQuietTokens();
  clearTimeout(timer);
  timer = setTimeout(() => {
    root.style.removeProperty("transition");
    root.style.removeProperty("--room-fade");
  }, FADE_MS);
}

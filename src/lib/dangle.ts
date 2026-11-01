// Svelte action: a springy, draggable mark. Hover pulls it a few px toward the cursor and grows it a
// little; grabbing grows it more and lets it be dragged on a rubber band inside `bounds` (the pull
// stiffens toward each edge, so it never leaves); letting go springs it home with a soft overshoot.
// Horizontal speed rocks its rotation like a pendulum. Physics is on its own clock (per-frame dt,
// not CSS transitions), so Settings > Appearance animation speed deliberately doesn't touch it.
// rAF only runs while something is moving.
export type Bounds = { l: number; r: number; u: number; d: number }; // px reach from home, all >= 0

const REACH = 3; // px of magnetic pull on hover
const SWAY = 2; // deg of rotation per px/frame of horizontal speed
const MAX_SWAY = 10; // deg
const K = 0.07; // position spring stiffness per frame: low, so it drags behind the cursor
const DAMP = 0.8; // position velocity kept per frame: high friction, barely overshoots
const RK = 0.06; // rotation spring, looser so it lags and rocks
const RDAMP = 0.82;
const SCALE_MS = 170; // scale eases in-out on a timer instead of springing

const wall = (d: number, max: number) => (max > 0 ? max * Math.tanh(d / max) : 0);

export function dangle(node: HTMLElement, bounds: () => Bounds = () => ({ l: 14, r: 14, u: 14, d: 14 })) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const s = { x: 0, y: 0, r: 0 }; // current
  const v = { x: 0, y: 0, r: 0 }; // velocity
  const t = { x: 0, y: 0 }; // target
  // Scale is a tween, not a spring: from `from` to `to` over SCALE_MS, ease-in-out.
  const sc = { from: 1, to: 1, at: 0, now: 1 };
  const grow = (to: number) => {
    sc.from = sc.now;
    sc.to = to;
    sc.at = performance.now();
    go();
  };
  let grab: { x: number; y: number; b: Bounds } | null = null;
  let raf = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = Math.min(now - last, 32) / (1000 / 60); // 1 at 60fps, so it feels the same at any refresh rate
    last = now;
    const damp = DAMP ** dt;
    for (const a of ["x", "y"] as const) {
      v[a] = (v[a] + (t[a] - s[a]) * K * dt) * damp;
      s[a] += v[a] * dt;
    }
    const swing = Math.max(-MAX_SWAY, Math.min(MAX_SWAY, v.x * SWAY));
    v.r = (v.r + (swing - s.r) * RK * dt) * RDAMP ** dt;
    s.r += v.r * dt;
    const p = Math.max(0, Math.min(1, (now - sc.at) / SCALE_MS));
    sc.now = sc.from + (sc.to - sc.from) * (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
    node.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(${sc.now})`;
    const still = [v.x, v.y, v.r, s.x - t.x, s.y - t.y, s.r, sc.now - sc.to].every((n) => Math.abs(n) < 0.01);
    if (still) {
      if (!t.x && !t.y && sc.to === 1) node.style.transform = "";
      raf = 0;
    } else raf = requestAnimationFrame(tick);
  };
  const go = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const pull = (e: PointerEvent) => {
    if (grab) {
      const dx = e.clientX - grab.x;
      const dy = e.clientY - grab.y;
      t.x = dx >= 0 ? wall(dx, grab.b.r) : -wall(-dx, grab.b.l);
      t.y = dy >= 0 ? wall(dy, grab.b.d) : -wall(-dy, grab.b.u);
    } else {
      const b = node.getBoundingClientRect();
      const dx = e.clientX - (b.left + b.width / 2 - s.x);
      const dy = e.clientY - (b.top + b.height / 2 - s.y);
      const d = Math.hypot(dx, dy) || 1;
      const lim = REACH * Math.tanh(d / 12);
      t.x = (dx / d) * lim;
      t.y = (dy / d) * lim;
    }
    go();
  };
  const enter = (e: PointerEvent) => {
    grow(1.1);
    pull(e);
  };
  const leave = () => {
    if (grab) return;
    t.x = t.y = 0;
    grow(1);
  };
  const down = (e: PointerEvent) => {
    // Measure the drag from where the mark is *now*, so grabbing mid-swing doesn't jump. Bounds
    // are measured from the mark's current spot, so shift them back to home.
    const o = bounds();
    const b = { l: o.l + s.x, r: o.r - s.x, u: o.u + s.y, d: o.d - s.y };
    grab = { x: e.clientX - s.x, y: e.clientY - s.y, b };
    try {
      node.setPointerCapture(e.pointerId);
    } catch {}
    node.style.cursor = "grabbing";
    grow(1.25);
  };
  const up = () => {
    if (!grab) return;
    grab = null;
    node.style.cursor = "grab";
    t.x = t.y = 0;
    grow(node.matches(":hover") ? 1.1 : 1);
  };

  node.style.cursor = "grab";
  const on = [["pointerenter", enter], ["pointermove", pull], ["pointerleave", leave], ["pointerdown", down], ["pointerup", up], ["pointercancel", up], ["lostpointercapture", up]] as const;
  for (const [n, f] of on) node.addEventListener(n, f as EventListener);
  return {
    destroy() {
      cancelAnimationFrame(raf);
      for (const [n, f] of on) node.removeEventListener(n, f as EventListener);
    },
  };
}

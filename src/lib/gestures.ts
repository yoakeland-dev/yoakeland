import type { Attachment } from "svelte/attachments";

export interface SwipeOptions {
  axis: "x" | "y";
  /** Look at where the touch landed before tracking it at all (e.g. not on a scrolling code block). */
  start?: (e: PointerEvent) => boolean;
  /** Called once the finger has settled on `axis`; return false to hand the touch back (scrolling etc). */
  accept?: (delta: number) => boolean;
  onMove?: (delta: number) => void;
  /** `velocity` is px/ms along the axis, signed. */
  onEnd?: (delta: number, velocity: number) => void;
  onCancel?: () => void;
}

const SLOP = 8;
// Not stopPropagation: Svelte delegates pointer events to the root, so stopping one would
// silence every handler beneath (the context menu's long-press cancel, for one).
const claimed = new WeakSet<Event>();

/** Touch/pen drag along one axis. The element needs a matching `touch-action` (pan-y for "x", none for "y"
 * on a grabber) or the browser claims the gesture first. A drag swallows the click that would follow it. */
export function swipe(opts: () => SwipeOptions): Attachment<HTMLElement> {
  return (node) => {
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let active = false;
    let last = { t: 0, p: 0 };
    let prev = { t: 0, p: 0 };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      id = -1;
      if (opts().start?.(e) === false) return;
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      active = false;
      last = prev = { t: e.timeStamp, p: 0 };
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (claimed.has(e)) return void (id = -1);
      const o = opts();
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      const main = o.axis === "x" ? dx : dy;
      const cross = o.axis === "x" ? dy : dx;
      if (!active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
        if (Math.abs(main) <= Math.abs(cross) || o.accept?.(main) === false) return void (id = -1);
        active = true;
      }
      // An inner swipe owns the touch; ancestors with their own swipe stay out of it.
      claimed.add(e);
      prev = last;
      last = { t: e.timeStamp, p: main };
      o.onMove?.(main);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (!active) return;
      active = false;
      const o = opts();
      const dt = last.t - prev.t;
      o.onEnd?.(last.p, dt > 0 ? (last.p - prev.p) / dt : 0);
      // The tap that ends a drag must not hit whatever is underneath.
      const eat = (c: Event) => c.stopPropagation();
      addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", eat, true), 120);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (active) opts().onCancel?.();
      active = false;
    };

    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
    };
  };
}

/** A release commits on distance or on a flick. */
export const commits = (progress: number, velocity: number, dir: 1 | -1) => progress > 0.4 || velocity * dir > 0.4;

/** True when the touch landed somewhere a horizontal drag already means something: a field being
 * selected, a terminal or editor, or anything that scrolls sideways (code blocks, tables). */
export function ownsHorizontalDrag(target: EventTarget | null, stop?: Element | null): boolean {
  for (let n = target as Element | null; n && n !== stop; n = n.parentElement) {
    if (n.matches?.("input, textarea, select, [contenteditable], .xterm, .cm-editor, [data-no-swipe]")) return true;
    if (getComputedStyle(n).touchAction === "none") return true;
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

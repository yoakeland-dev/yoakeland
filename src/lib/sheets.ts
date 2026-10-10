// Drag-to-dismiss for the bottom sheets mobile.css turns popovers and dialogs into. Works on
// touch events at the document: a pull down on a sheet that is scrolled to its top moves the
// sheet instead of scrolling it, and letting go far enough (or flicking) sends it Escape,
// which bits-ui already treats as "close".
// Settings is a page on phones, not a sheet: it has no pull-down dismissal.
import { haptic } from "./haptics";

const SHEET = '[data-bits-floating-content-wrapper]:not(:has(> .tooltip)) > *, [data-dialog-content]:not(.settings-content)';

function scrollTopOf(el: Element, sheet: Element): number {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight && getComputedStyle(n).overflowY !== "visible") return n.scrollTop;
    if (n === sheet) break;
  }
  return 0;
}

// Anything that opted out of browser panning (sliders, terminals) has its own use for a drag.
function ownsTouch(el: Element, sheet: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).touchAction === "none") return true;
    if (n === sheet) break;
  }
  return false;
}

const escape = (el: Element) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const stillOpen = (el: HTMLElement) => el.isConnected && el.dataset.state !== "closed";

/** Slides the sheet away, then asks bits-ui to close it. If nothing closes (a layer that swallowed
 * Escape), tries an outside tap, and failing that puts the sheet back: a sheet stranded off-screen
 * under its scrim would leave the page dimmed and dead. */
function dismiss(el: HTMLElement) {
  haptic();
  el.style.transition = "transform 0.16s ease-in";
  el.style.transform = "translateY(100%)";
  setTimeout(() => stillOpen(el) && escape(el), 120);
  setTimeout(() => {
    if (!stillOpen(el)) return;
    for (const type of ["pointerdown", "pointerup", "click"])
      document.body.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 2, clientY: 2, pointerType: "touch" }));
  }, 450);
  setTimeout(() => {
    if (!stillOpen(el)) return;
    el.style.transition = "transform 0.2s var(--ui-ease)";
    el.style.transform = "";
  }, 800);
}

export function initSheetDrag(): () => void {
  let sheet: HTMLElement | null = null;
  let y0 = 0;
  let dy = 0;
  let claimed = false;
  let last = { t: 0, y: 0 };
  let prev = { t: 0, y: 0 };

  const start = (e: TouchEvent) => {
    const target = e.target as Element;
    sheet = target.closest<HTMLElement>(SHEET);
    if (!sheet || sheet.dataset.state === "closed") return void (sheet = null);
    y0 = e.touches[0].clientY;
    dy = 0;
    claimed = false;
    last = prev = { t: e.timeStamp, y: y0 };
    // Only the sheet that is at its top can be pulled; inner scrollers keep their scroll.
    if (scrollTopOf(target, sheet) > 0 || ownsTouch(target, sheet)) sheet = null;
  };
  const move = (e: TouchEvent) => {
    if (!sheet) return;
    const y = e.touches[0].clientY;
    dy = y - y0;
    if (!claimed) {
      if (dy < 6) return void (dy < -6 && (sheet = null));
      claimed = true;
      sheet.style.transition = "none";
    }
    e.preventDefault();
    prev = last;
    last = { t: e.timeStamp, y };
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };
  const end = () => {
    if (!sheet || !claimed) return void (sheet = null);
    const el = sheet;
    sheet = null;
    const v = last.t > prev.t ? (last.y - prev.y) / (last.t - prev.t) : 0;
    if (dy > el.offsetHeight * 0.35 || v > 0.5) dismiss(el);
    else {
      el.style.transition = "transform 0.2s var(--ui-ease)";
      el.style.transform = "";
      setTimeout(() => (el.style.transition = ""), 220);
    }
  };

  addEventListener("touchstart", start, { passive: true });
  addEventListener("touchmove", move, { passive: false });
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);
  return () => {
    removeEventListener("touchstart", start);
    removeEventListener("touchmove", move);
    removeEventListener("touchend", end);
    removeEventListener("touchcancel", end);
  };
}

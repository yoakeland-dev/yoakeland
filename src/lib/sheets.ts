// Drag-to-dismiss for a bottom sheet (Sheet.svelte). Touch events on the sheet itself: a pull down on
// a sheet that is scrolled to its top moves the sheet instead of scrolling it, and letting go far
// enough (or flicking) sends it Escape, which bits-ui already treats as "close".
import type { Attachment } from "svelte/attachments";
import { haptic } from "./haptics";

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

const stillOpen = (el: HTMLElement) => el.isConnected && el.dataset.state !== "closed";

const OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

// What dims the page behind this sheet: its own scrim (popovers, menus) or the dialog overlay.
const scrimOf = (el: HTMLElement): HTMLElement | null => {
  const s = el.closest(".wrap")?.previousElementSibling;
  return s?.classList.contains("scrim") ? (s as HTMLElement) : document.querySelector<HTMLElement>("[data-dialog-overlay]:not([data-state=closed])");
};
/** Past the edge a pull gets heavier: the further, the less it moves (iOS's curve). */
const rubber = (d: number, dim = 120) => (1 - 1 / ((d * 0.55) / dim + 1)) * dim;

/** Slides the sheet away, then asks bits-ui to close it. If nothing closes (a layer that swallowed
 * Escape), the sheet comes back: one stranded off-screen under its scrim would leave the page dead. */
function dismiss(el: HTMLElement, scrim: HTMLElement | null) {
  haptic();
  el.style.transition = "transform 0.2s ease-in";
  el.style.transform = "translateY(100%)";
  if (scrim) ((scrim.style.transition = "opacity 0.2s ease-in"), (scrim.style.opacity = "0"));
  setTimeout(() => stillOpen(el) && el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), 120);
  setTimeout(() => {
    if (!stillOpen(el)) return;
    el.style.transition = `transform 0.3s ${OUT}`;
    el.style.transform = "";
    if (scrim) ((scrim.style.transition = `opacity 0.3s ${OUT}`), (scrim.style.opacity = ""));
  }, 500);
}

export function sheetDrag(): Attachment<HTMLElement> {
  return (node) => {
    let live = false;
    let claimed = false;
    let y0 = 0;
    let dy = 0;
    let scrim: HTMLElement | null = null;
    let last = { t: 0, y: 0 };
    let prev = { t: 0, y: 0 };

    const start = (e: TouchEvent) => {
      const target = e.target as Element;
      claimed = false;
      // Only a sheet at its top can be pulled; inner scrollers keep their scroll.
      live = node.dataset.state !== "closed" && scrollTopOf(target, node) === 0 && !ownsTouch(target, node);
      if (!live) return;
      y0 = e.touches[0].clientY;
      dy = 0;
      last = prev = { t: e.timeStamp, y: y0 };
    };
    const move = (e: TouchEvent) => {
      if (!live) return;
      const y = e.touches[0].clientY;
      dy = y - y0;
      if (!claimed) {
        if (dy < 6) return void (dy < -6 && (live = false));
        claimed = true;
        node.style.transition = "none";
        scrim = scrimOf(node);
        if (scrim) scrim.style.transition = "none";
      }
      e.preventDefault();
      prev = last;
      last = { t: e.timeStamp, y };
      // 1:1 down, heavier up.
      node.style.transform = `translateY(${dy > 0 ? dy : -rubber(-dy)}px)`;
      if (scrim) scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / node.offsetHeight));
    };
    const end = () => {
      if (!live || !claimed) return void (live = false);
      live = false;
      const v = last.t > prev.t ? (last.y - prev.y) / (last.t - prev.t) : 0;
      if (dy > node.offsetHeight * 0.35 || v > 0.5) dismiss(node, scrim);
      else {
        node.style.transition = `transform 0.3s ${OUT}`;
        node.style.transform = "";
        const sc = scrim;
        if (sc) ((sc.style.transition = `opacity 0.3s ${OUT}`), (sc.style.opacity = ""));
        setTimeout(() => ((node.style.transition = ""), sc && (sc.style.transition = "")), 320);
      }
    };

    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    };
  };
}

// `{@attach tip(...)}` in place of `title=`: one shared tooltip (TooltipHost.svelte) follows
// whatever element the pointer rests on. Content is a string (newlines kept) or a snippet for a
// richer card; `keys` appends that action's current shortcut.
import { untrack, type Snippet } from "svelte";
import type { Attachment } from "svelte/attachments";

export type TipSide = "top" | "bottom" | "left" | "right";
export interface TipOptions {
  /** A keybinds.svelte.ts action id. */
  keys?: string;
  side?: TipSide;
  /** Selector of an ancestor whose edges the tooltip clears instead of the element's own, so a
   * row's card sits outside its whole sidebar rather than over the neighbouring rows. */
  outside?: string;
}
export interface Tip extends TipOptions {
  el: HTMLElement;
  content: string | Snippet;
}

const OPEN_DELAY = 500;
// Moving straight from one tooltip to the next skips the delay, like a menu bar.
const SKIP_WINDOW = 400;

export const tooltip = $state<{ current: Tip | null }>({ current: null });

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Tip | null = null;
let lastHide = 0;

function show(t: Tip, instant = false) {
  clearTimeout(timer);
  pending = null;
  if (instant || tooltip.current || performance.now() - lastHide < SKIP_WINDOW) tooltip.current = t;
  else {
    pending = t;
    timer = setTimeout(() => {
      const p = pending;
      pending = null;
      if (p?.el.isConnected) tooltip.current = p;
    }, OPEN_DELAY);
  }
}

export function hideTip(el?: HTMLElement) {
  if (!el || pending?.el === el) {
    clearTimeout(timer);
    pending = null;
  }
  if (!tooltip.current || (el && tooltip.current.el !== el)) return;
  tooltip.current = null;
  lastHide = performance.now();
}

/** `keysOrOpts` as a string is shorthand for `{ keys }`. Falsy content attaches nothing. */
export function tip(content: string | Snippet | null | undefined | false, keysOrOpts?: string | TipOptions): Attachment<HTMLElement> {
  return (el) => {
    if (!content) return;
    const opts = typeof keysOrOpts === "string" ? { keys: keysOrOpts } : keysOrOpts;
    const t: Tip = { el, content, ...opts };
    // Icon-only controls used to get their accessible name from `title`.
    if (typeof content === "string" && !el.hasAttribute("aria-label") && !el.textContent?.trim()) {
      el.setAttribute("aria-label", content);
    }
    const enter = (e: PointerEvent) => e.pointerType !== "touch" && show(t);
    const leave = () => hideTip(el);
    const focus = () => el.matches(":focus-visible") && show(t, true);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", leave);
    el.addEventListener("focus", focus);
    el.addEventListener("blur", leave);
    // Re-attached with new content (e.g. "Show"/"Hide" flipping) while shown: swap it in place.
    // Untracked, or every show/hide would re-run every attachment.
    untrack(() => {
      if (tooltip.current?.el === el) tooltip.current = t;
      if (pending?.el === el) pending = t;
    });
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", leave);
      el.removeEventListener("focus", focus);
      el.removeEventListener("blur", leave);
      // Teardown runs before the node leaves the DOM; check once it has.
      queueMicrotask(() => !el.isConnected && hideTip(el));
    };
  };
}

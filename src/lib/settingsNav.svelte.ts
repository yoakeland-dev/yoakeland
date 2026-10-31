// Phone settings: a page stack. Root (the list of tabs) -> "tab" (one tab's page) -> sub-pages
// (a section carved out of a tab, see SubPage.svelte). Every push and pop goes through settle(), so the
// buttons, the swipe and the outer shell's back button all move pages the same way: the top page slides
// in from the right while the one beneath shifts -24% and dims.
import { getContext, setContext } from "svelte";
import type { Attachment } from "svelte/attachments";
import { commits, ownsHorizontalDrag, type SwipeOptions } from "./gestures";
import { viewport } from "./viewport.svelte";

const DRAWER = "cubic-bezier(.32,.72,0,1)";
const OUT = "cubic-bezier(.23,1,.32,1)";
const ROOT = "root";
const TAB = "tab";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** p: 0 = the top page is off to the right, 1 = fully in. */
const frame = (p: number) =>
  reduced()
    ? { top: { opacity: p, transform: "none" }, under: { transform: "none", filter: "none" } }
    : {
        top: { opacity: 1, transform: `translateX(${(1 - p) * 100}%)` },
        under: { transform: `translateX(${-24 * p}%)`, filter: `brightness(${1 - 0.4 * p})` },
      };

export class SettingsNav {
  /** Pages above the root, bottom to top. */
  stack = $state<string[]>([]);
  /** Sub-pages register their titles for the breadcrumb. */
  titles = $state<Record<string, string>>({});
  /** The tab page's title (it changes with the tab). */
  tabTitle = () => "";
  host: HTMLElement | null = null;
  private busy = false;

  get depth() {
    return this.stack.length;
  }
  has = (key: string) => this.stack.includes(key);
  private el = (key: string) =>
    key === ROOT
      ? this.host?.querySelector<HTMLElement>(".tabs-list")
      : key === TAB
        ? this.host?.querySelector<HTMLElement>(".settings-main")
        : this.host?.querySelector<HTMLElement>(`[data-sub="${CSS.escape(key)}"]`);
  private titleOf = (key: string) => (key === TAB ? this.tabTitle() : (this.titles[key] ?? ""));
  /** "Settings › Appearance": the pages above `key` in the stack. */
  crumb = (key: string) => {
    const i = this.stack.indexOf(key);
    return ["Settings", ...this.stack.slice(0, Math.max(0, i)).map(this.titleOf)].filter(Boolean).join(" › ");
  };

  /** Sets every page to where the stack says it rests, with no motion. */
  rest() {
    if (!this.host) return;
    if (!viewport.narrow) {
      // Not a phone: the tab list and the page sit side by side, nothing is stacked.
      for (const k of [ROOT, TAB]) this.el(k)?.removeAttribute("style");
      return;
    }
    const pages = [ROOT, ...this.stack];
    const top = pages.length - 1;
    for (const k of new Set([ROOT, TAB, ...pages, ...Object.keys(this.titles)])) {
      const el = this.el(k);
      if (!el) continue;
      const i = pages.indexOf(k);
      el.getAnimations().forEach((a) => a.cancel());
      const show = i >= top - 1 && i >= 0;
      el.style.display = show ? "flex" : "none";
      el.style.zIndex = String(Math.max(0, i));
      el.inert = i !== top;
      const under = i === top - 1 && !reduced();
      el.style.transform = under ? "translateX(-24%)" : "";
      el.style.filter = under ? "brightness(.6)" : "";
      el.style.opacity = "";
    }
  }

  /** Opens at a fixed depth without motion (the dialog opening onto a tab). */
  reset(stack: string[]) {
    this.stack = stack;
    this.rest();
  }

  private place(top: HTMLElement, under: HTMLElement | undefined, p: number) {
    const f = frame(p);
    top.style.display = "flex";
    top.style.transform = f.top.transform;
    top.style.opacity = String(f.top.opacity);
    if (under) (under.style.transform = f.under.transform), (under.style.filter = f.under.filter);
  }

  /** The one animation: top goes from progress `from` to `to`; resolves when it has landed. */
  private async settle(top: HTMLElement, under: HTMLElement | undefined, from: number, to: number, ms: number, ease: string) {
    this.place(top, under, from);
    const speed = Number(getComputedStyle(document.documentElement).getPropertyValue("--anim-speed"));
    const o = { duration: Math.max(1, ms * (Number.isFinite(speed) ? speed : 1)), easing: ease, fill: "forwards" as const };
    const a = frame(from);
    const b = frame(to);
    const anims = [top.animate([a.top, b.top], o), under?.animate([a.under, b.under], o)].filter(Boolean) as Animation[];
    await Promise.all(anims.map((x) => x.finished)).catch(() => {});
  }

  /** Slides `key` in over the current page. */
  async push(key: string) {
    if (this.busy || this.stack.at(-1) === key) return;
    const top = this.el(key);
    if (!top) return void this.stack.push(key);
    const under = this.el(this.stack.at(-1) ?? ROOT) ?? undefined;
    this.busy = true;
    this.stack.push(key);
    top.style.zIndex = String(this.stack.length);
    await this.settle(top, under, 0, 1, 340, DRAWER);
    this.rest();
    this.busy = false;
  }

  /** Slides the top page away. */
  async pop(): Promise<void> {
    if (this.busy || !this.stack.length) return;
    const top = this.el(this.stack.at(-1)!);
    const under = this.el(this.stack.at(-2) ?? ROOT) ?? undefined;
    if (!top) return void this.stack.pop();
    this.busy = true;
    if (under) under.inert = false;
    await this.settle(top, under, 1, 0, 300, DRAWER);
    this.stack.pop();
    this.rest();
    this.busy = false;
  }

  /** Swipe right to go back, following the finger. Only used while there is a page to pop. */
  gesture: SwipeOptions = (() => {
    let top: HTMLElement | undefined;
    let under: HTMLElement | undefined;
    let p = 1;
    return {
      axis: "x",
      start: (e: PointerEvent) => !this.busy && this.stack.length > 0 && !ownsHorizontalDrag(e.target),
      accept: (d: number) => d > 0,
      onMove: (d: number) => {
        if (!top) {
          top = this.el(this.stack.at(-1)!) ?? undefined;
          under = this.el(this.stack.at(-2) ?? ROOT) ?? undefined;
          if (under) under.inert = false;
        }
        if (!top) return;
        p = 1 - clamp01(d / innerWidth);
        this.place(top, under, p);
      },
      onEnd: async (d: number, v: number) => {
        const t = top;
        const u = under;
        top = under = undefined;
        if (!t) return;
        const go = commits(clamp01(d / innerWidth), v, 1);
        this.busy = true;
        const left = go ? p : 1 - p;
        await this.settle(t, u, p, go ? 0 : 1, Math.min(320, Math.max(160, left * 340)), OUT);
        if (go) this.stack.pop();
        this.rest();
        this.busy = false;
      },
      onCancel: () => {
        top = under = undefined;
        this.rest();
      },
    };
  })();
}

const KEY = Symbol("settings-nav");
export const provideNav = (nav: SettingsNav) => setContext(KEY, nav);
export const useNav = () => getContext<SettingsNav | undefined>(KEY);

/** A hairline under the page's bar once its content scrolls beneath it: sets `.scrolled` on the node. */
export const hairline: Attachment<HTMLElement> = (node) => {
  const on = (e: Event) => node.classList.toggle("scrolled", ((e.target as HTMLElement).scrollTop ?? 0) > 4);
  node.addEventListener("scroll", on, true);
  return () => node.removeEventListener("scroll", on, true);
};

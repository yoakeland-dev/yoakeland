// Layout class, picked by what the screen can do rather than what device it is (a tablet with a
// trackpad is still a touch screen; a narrow desktop window is still a desktop):
//   phone    <= 700px wide: one screen at a time (fleet home -> chat), tools and menus as sheets.
//   tablet   701-1180px with a coarse pointer: fleet list beside the chat, tools as a slide-over.
//   desktop  everything else: the full multi-column layout.
// Keep the 700px in step with the `max-width: 700px` media queries in the CSS (a query can't
// take a variable). Everything else keys off `:root[data-layout]`.
const PHONE_QUERY = "(max-width: 700px)";
const TABLET_QUERY = "(min-width: 701px) and (max-width: 1180px) and (pointer: coarse)";
const ready = typeof window !== "undefined";
const phoneMq = ready ? matchMedia(PHONE_QUERY) : null;
const tabletMq = ready ? matchMedia(TABLET_QUERY) : null;

export type LayoutKind = "phone" | "tablet" | "desktop";
const kindNow = (): LayoutKind => (phoneMq?.matches ? "phone" : tabletMq?.matches ? "tablet" : "desktop");

export const viewport = $state({
  kind: kindNow(),
  /** True on a phone: the name predates tablets and every existing `viewport.narrow` check means "one screen at a time". */
  narrow: phoneMq?.matches ?? false,
  /** Phone: which screen of the stack is on top. */
  screen: "home" as "home" | "chat",
  /** How far a finger has dragged the chat screen away (0..1) while going back, else null. */
  pop: null as number | null,
  /** A page showing a sub-screen sets this; the top bar's back button then closes it instead of the chat. */
  back: null as (() => void) | null,
  /** Small dim line under the phone top bar's title (breadcrumb, project · branch). Null = the default for the page. */
  sub: null as string | null,
});

/** Brings the chat screen up (a no-op off a phone, where chat is always on screen). */
export function showChat() {
  viewport.screen = "chat";
}
export function showHome() {
  viewport.screen = "home";
}

if (ready) {
  const sync = () => {
    viewport.kind = kindNow();
    viewport.narrow = viewport.kind === "phone";
    document.documentElement.dataset.layout = viewport.kind;
  };
  phoneMq!.addEventListener("change", sync);
  tabletMq!.addEventListener("change", sync);
  sync();
  // iOS keeps the layout viewport put when the keyboard opens, so follow the visual one.
  const vv = window.visualViewport;
  if (vv) {
    const follow = () => {
      const root = document.documentElement.style;
      root.setProperty("--vvh", `${vv.height}px`);
      root.setProperty("--vv-top", `${vv.offsetTop}px`);
    };
    vv.addEventListener("resize", follow);
    vv.addEventListener("scroll", follow);
    follow();
  }
}

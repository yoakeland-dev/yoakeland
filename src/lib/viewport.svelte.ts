// Phone layout switch. Keep NARROW_QUERY in step with the `max-width: 700px` media
// queries in the CSS (a query can't take a variable).
const NARROW_QUERY = "(max-width: 700px)";
const ready = typeof window !== "undefined";
const mq = ready ? matchMedia(NARROW_QUERY) : null;

export const viewport = $state({
  narrow: mq?.matches ?? false,
  /** How open the sidebar drawer is (0..1) while a finger is dragging it, else null. */
  drawer: null as number | null,
  /** A page showing a sub-screen sets this; the top-left toggle then becomes its back button. */
  back: null as (() => void) | null,
});

/** Drawer width in px: the gesture maths and the CSS agree on this one number. */
export function drawerWidth(): number {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  return Math.min(innerWidth * 0.86, 24 * rem);
}

if (mq) {
  mq.addEventListener("change", (e) => (viewport.narrow = e.matches));
  // iOS keeps the layout viewport put when the keyboard opens, so follow the visual one.
  const vv = window.visualViewport;
  if (vv) {
    const sync = () => {
      const root = document.documentElement.style;
      root.setProperty("--vvh", `${vv.height}px`);
      root.setProperty("--vv-top", `${vv.offsetTop}px`);
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
  }
}

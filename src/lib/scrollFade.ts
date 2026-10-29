// Attachment for a height-capped scroller: fades each edge only while there's more content past it.
// Applied as a CSS mask so it follows the text. Pair with the `.scroll-cap` class (ui.css).
const FADE = 24;

export function scrollFade(el: HTMLElement) {
  const update = () => {
    const top = el.scrollTop > 0 ? FADE : 0;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? FADE : 0;
    const mask =
      top || bottom
        ? `linear-gradient(to bottom, transparent 0, #000 ${top}px, #000 calc(100% - ${bottom}px), transparent 100%)`
        : "";
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  };
  update();
  el.addEventListener("scroll", update);
  // Size changes (resize, the accordion opening) and content changes (streaming text)
  // both move scrollHeight; a capped box's own size doesn't change for the latter.
  const ro = new ResizeObserver(update);
  ro.observe(el);
  const mo = new MutationObserver(update);
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  return () => {
    el.removeEventListener("scroll", update);
    ro.disconnect();
    mo.disconnect();
  };
}

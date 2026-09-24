/** Svelte action: sets `data-overflow` on a scroll container while its
 * content is taller than it, so CSS can make room for a scrollbar only when
 * one is showing. Rechecks on resize and when children come or go. */
export function markOverflow(node: HTMLElement) {
  const check = () => node.toggleAttribute("data-overflow", node.scrollHeight > node.clientHeight);
  const ro = new ResizeObserver(check);
  const mo = new MutationObserver(check);
  ro.observe(node);
  mo.observe(node, { childList: true, subtree: true });
  check();
  return {
    destroy() {
      ro.disconnect();
      mo.disconnect();
    },
  };
}

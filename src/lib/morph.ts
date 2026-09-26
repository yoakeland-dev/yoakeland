// Reconciles a live DOM subtree against freshly rendered markup, touching only what differs.
// A streamed markdown block keeps its nodes (selection, a collapsed code block) and only its
// new tail is inserted; with `fade`, inserted nodes carry `data-f` so CSS fades them in, and
// settleFade() folds them back once the animation ends.

const TEXT = 3;
const ELEMENT = 1;

/** Attributes the renderer never emits but the UI sets on live nodes; a morph leaves them be. */
const KEEP = new Set(["data-f", "data-collapsed", "data-streaming", "aria-expanded"]);

// A text node, or one of our fade wrappers around appended text: together they're one run.
const isTextish = (n: Node) =>
  n.nodeType === TEXT || (n.nodeType === ELEMENT && (n as Element).getAttribute("data-f") === "t");

function prep(n: Node, fade: boolean): Node {
  if (!fade) return n;
  if (n.nodeType === ELEMENT) {
    (n as Element).setAttribute("data-f", "");
    return n;
  }
  const span = document.createElement("span");
  span.setAttribute("data-f", "t");
  span.append(n);
  return span;
}

function syncAttrs(o: Element, n: Element) {
  for (const a of [...o.attributes]) if (!KEEP.has(a.name) && !n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of n.attributes) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
}

/** Makes `el`'s children match `next`'s. Consumes `next`. */
export function morph(el: Node, next: Node, fade: boolean) {
  let o = el.firstChild;
  for (let n = next.firstChild; n; ) {
    const after = n.nextSibling;
    if (o && n.nodeType === TEXT && isTextish(o)) {
      let have = "";
      let last: ChildNode = o;
      let end: ChildNode | null = o;
      while (end && isTextish(end)) {
        have += end.textContent;
        last = end;
        end = end.nextSibling;
      }
      const want = n.textContent ?? "";
      if (want !== have) {
        if (want.startsWith(have)) {
          const tail = want.slice(have.length);
          if (fade) el.insertBefore(prep(document.createTextNode(tail), true), end);
          else if (last.nodeType === TEXT) (last as Text).appendData(tail);
          else el.insertBefore(document.createTextNode(tail), end);
        } else {
          // Rewritten, not extended (markdown re-read `*foo` as emphasis): no fade for what was already shown.
          while (o && o !== end) {
            const x: ChildNode | null = o.nextSibling;
            o.remove();
            o = x;
          }
          el.insertBefore(n, end);
        }
      }
      o = end;
    } else if (o && o.nodeType === ELEMENT && o.nodeName === n.nodeName) {
      syncAttrs(o as Element, n as Element);
      // Code is hidden while it streams and re-highlights into new token spans every frame.
      morph(o, n, fade && o.nodeName !== "PRE");
      o = o.nextSibling;
    } else if (o) {
      let end = o.nextSibling;
      if (isTextish(o)) while (end && isTextish(end)) end = end.nextSibling;
      while (o && o !== end) {
        const x: ChildNode | null = o.nextSibling;
        o.remove();
        o = x;
      }
      el.insertBefore(prep(n, fade), end);
      o = end;
    } else {
      el.appendChild(prep(n, fade));
    }
    n = after;
  }
  while (o) {
    const x: ChildNode | null = o.nextSibling;
    o.remove();
    o = x;
  }
}

/** animationend handler: a faded element drops its marker, faded text rejoins the text before it. */
export function settleFade(e: AnimationEvent) {
  if (e.animationName !== "md-fade-in") return;
  const el = e.target as Element;
  if (el.getAttribute("data-f") !== "t") {
    el.removeAttribute("data-f");
    return;
  }
  const prev = el.previousSibling;
  const text = el.textContent ?? "";
  if (prev?.nodeType === TEXT) {
    (prev as Text).appendData(text);
    el.remove();
  } else {
    el.replaceWith(text);
  }
}

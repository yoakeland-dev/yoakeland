// Scripts the agent's browser tool runs inside the page (BrowserPanel's webview). Plain strings,
// not stringified functions, so no bundler transform can leave a helper reference behind.
//
// A snapshot is the page as text, in document order: headings, readable text, and every visible
// interactive element tagged [ref=N]. Actions then name a ref, like Playwright MCP's snapshots
// or Claude in Chrome's read_page, rather than guessing pixel positions. Refs live in a
// page-global map rebuilt by each snapshot, so they're only valid until the next one.

export const SNAPSHOT_JS = String.raw`(() => {
  const MAX = 14000;
  const refs = (window.__yoakeRefs = new Map());
  const out = [];
  let size = 0, cut = false;
  const push = (depth, line) => {
    if (cut) return;
    if (size + line.length > MAX) { cut = true; return; }
    out.push("  ".repeat(Math.min(depth, 8)) + line);
    size += line.length + 1;
  };
  const clip = (s, n) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const INTERACTIVE_ROLES = /^(button|link|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|textbox|searchbox|combobox|slider|spinbutton|treeitem)$/;
  const roleOf = (el) => {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button" || t === "summary") return "button";
    if (t === "select") return el.multiple ? "listbox" : "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") {
      const ty = (el.type || "text").toLowerCase();
      if (ty === "hidden") return "";
      if (["button", "submit", "reset", "image"].includes(ty)) return "button";
      if (ty === "checkbox" || ty === "radio") return ty;
      if (ty === "range") return "slider";
      if (ty === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable) return "textbox";
    return "";
  };
  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
    if (el.labels && el.labels.length) return el.labels[0].innerText;
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) return el.value;
    const text = el.innerText;
    if (text && text.trim()) return text;
    return el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || (el.querySelector("img[alt]")?.alt ?? "");
  };
  const interactive = (el, role) =>
    INTERACTIVE_ROLES.test(role) || role === "listbox" ||
    el.hasAttribute("onclick") || (el.tabIndex >= 0 && el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1");
  const TEXT_TAGS = /^(P|LI|TD|TH|LABEL|BLOCKQUOTE|PRE|CODE|DT|DD|FIGCAPTION|CAPTION|SPAN|DIV|STRONG|EM|SMALL)$/;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|HEAD|META|LINK|IFRAME)$/;
  const BLOCK_TEXT = /^(P|LI|TD|TH|LABEL|BLOCKQUOTE|PRE|DT|DD|FIGCAPTION|CAPTION)$/;
  const ACTIONABLE = "a[href],button,input,select,textarea,summary,[role],[onclick],[tabindex],[contenteditable]";

  const walk = (el, depth) => {
    if (cut || SKIP.test(el.tagName)) return;
    if (el.getAttribute("aria-hidden") === "true" || !visible(el)) return;
    const role = roleOf(el);
    if (interactive(el, role)) {
      const ref = String(refs.size + 1);
      refs.set(ref, el);
      let line = "- " + (role || el.tagName.toLowerCase()) + ' "' + clip(nameOf(el), 80) + '"';
      if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "slider") {
        const v = el.isContentEditable ? el.innerText : el.value;
        if (v) line += ' value="' + clip(el.type === "password" ? "••••" : v, 80) + '"';
      }
      if (el.checked) line += " checked";
      if (el.disabled || el.getAttribute("aria-disabled") === "true") line += " disabled";
      if (el.getAttribute("aria-expanded")) line += " expanded=" + el.getAttribute("aria-expanded");
      if (role === "link") {
        const href = el.getAttribute("href");
        if (href && !href.startsWith("javascript:")) line += " -> " + clip(href, 80);
      }
      push(depth, line + " [ref=" + ref + "]");
      if (role !== "listbox" && role !== "combobox") return; // its text is already its name
    }
    const h = /^H([1-6])$/.exec(el.tagName);
    if (h) { push(depth, "- heading" + h[1] + ' "' + clip(el.innerText, 120) + '"'); return; }
    if (el.tagName === "IMG" && el.alt) { push(depth, '- img "' + clip(el.alt, 80) + '"'); return; }
    // A block of plain text reads as one line, inline markup and all, unless something inside
    // it can be acted on and needs its own ref.
    if (BLOCK_TEXT.test(el.tagName) && !el.querySelector(ACTIONABLE)) {
      const t = clip(el.innerText, 300);
      if (t) push(depth, "- text: " + t);
      return;
    }
    // Text a child element won't report itself: only this element's own text nodes.
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = clip(own, 300);
    if (own && (TEXT_TAGS.test(el.tagName) || el.children.length === 0)) push(depth, "- text: " + own);
    const next = ["UL", "OL", "TABLE", "FORM", "NAV", "MAIN", "DIALOG", "SECTION", "ARTICLE"].includes(el.tagName) ? depth + 1 : depth;
    for (const child of el.children) walk(child, next);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) walk(child, next);
  };
  walk(document.body || document.documentElement, 0);

  const head = [
    "URL: " + location.href,
    "Title: " + document.title,
    "Viewport: " + innerWidth + "x" + innerHeight + ", scrolled " + Math.round(scrollY) + " of " + Math.max(0, document.documentElement.scrollHeight - innerHeight),
  ];
  const active = document.activeElement;
  for (const [ref, el] of refs) if (el === active) head.push("Focused: [ref=" + ref + "]");
  if (cut) out.push("[snapshot truncated; scroll or use evaluate to see more]");
  return head.join("\n") + "\n\n" + (out.length ? out.join("\n") : "(the page shows no text)");
})()`;

/** Finds ref's element, scrolls it into view, and reports where it is so a real click can land
 * there. Throws a readable error for a stale ref. */
export const locateJs = (ref: string) => String.raw`(() => {
  const el = window.__yoakeRefs && window.__yoakeRefs.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) throw new Error("ref ${ref.replace(/[^\w-]/g, "")} is not on the page any more; take a new snapshot");
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: innerWidth, h: innerHeight, visible: r.width > 0 && r.height > 0 };
})()`;

/** Focuses ref's field and selects its contents, so typed text replaces them. */
export const focusJs = (ref: string) => String.raw`(() => {
  const el = window.__yoakeRefs && window.__yoakeRefs.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) throw new Error("that ref is not on the page any more; take a new snapshot");
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus();
  if (typeof el.select === "function") el.select();
  else if (el.isContentEditable) document.execCommand("selectAll");
  return document.activeElement === el || el.contains(document.activeElement);
})()`;

/** A synthetic click, for when a real one can't be aimed (the pane is hidden or off screen). */
export const clickJs = (ref: string) => String.raw`(() => {
  const el = window.__yoakeRefs && window.__yoakeRefs.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) throw new Error("that ref is not on the page any more; take a new snapshot");
  el.click();
  return true;
})()`;

export const scrollJs = (ref: string | undefined, direction: string) =>
  ref
    ? String.raw`(() => {
  const el = window.__yoakeRefs && window.__yoakeRefs.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) throw new Error("that ref is not on the page any more; take a new snapshot");
  el.scrollIntoView({ block: "center", behavior: "instant" });
})()`
    : `window.scrollBy({ top: ${direction === "up" ? -1 : 1} * innerHeight * 0.8, behavior: "instant" })`;

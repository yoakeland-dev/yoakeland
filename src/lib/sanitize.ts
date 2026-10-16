// The one place untrusted markup (model output, KaTeX, Mermaid's SVG) is made safe to insert.
import DOMPurify from "dompurify";
import { allowedImgSrc, allowedInput, allowedSvgHref, cssIsSafe, isRemoteImgSrc } from "./sanitizeRules";

const SVG_NS = "http://www.w3.org/2000/svg";

// Remote images the reader has clicked open this session, by URL. Re-renders keep them.
const loadedImages = new Set<string>();

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.localName;
  if (el.hasAttribute("style") && !cssIsSafe(el.getAttribute("style")!)) el.removeAttribute("style");
  if (tag === "style" && !cssIsSafe(el.textContent ?? "")) el.textContent = "";
  if (el.namespaceURI === SVG_NS) {
    for (const name of ["href", "xlink:href"]) {
      const v = el.getAttribute(name);
      if (v !== null && !allowedSvgHref(v)) el.removeAttribute(name);
    }
  } else if (tag === "img") {
    // A blocked source leaves no src, and `img:not([src])` is hidden (Markdown.svelte).
    const src = (el.getAttribute("src") ?? "").trim();
    if (!allowedImgSrc(src)) el.removeAttribute("src");
    else if (isRemoteImgSrc(src) && !loadedImages.has(src)) {
      // Model output must not reach out on its own (a URL can carry data): sanitizeMarkdown
      // shows a button in its place, and loadRemoteImage swaps it for the image on click.
      el.setAttribute("data-remote", src);
      el.removeAttribute("src");
    }
    el.removeAttribute("srcset");
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
    el.setAttribute("referrerpolicy", "no-referrer");
  } else if (tag === "input" && !allowedInput(el.getAttribute("type"), el.hasAttribute("disabled"))) {
    // Only the GFM task-list checkbox survives: an <input type=image> would fetch its src.
    el.remove();
  } else if (tag === "a") {
    el.setAttribute("rel", "noopener noreferrer");
    el.removeAttribute("target");
  }
});

/** Rendered markdown -> nodes for morph(). HTML, inline SVG and MathML (KaTeX) survive; <style>
 * doesn't, since a message must not restyle the app, nor do forms or media, which would submit or
 * fetch. Tables get a scroll container. */
export function sanitizeMarkdown(html: string): DocumentFragment {
  const frag = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    // KaTeX's MathML carries the TeX source in <semantics><annotation encoding=...>.
    ADD_TAGS: ["semantics", "annotation"],
    ADD_ATTR: ["encoding"],
    // Form controls (input: see the hook) and attributes that fetch or act on page elements.
    FORBID_TAGS: ["style", "form", "video", "audio", "source", "track", "picture", "textarea", "select", "datalist"],
    FORBID_ATTR: ["background", "poster", "srcset", "ping", "popover", "popovertarget", "popovertargetaction", "command", "commandfor", "form", "formaction"],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const table of frag.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const img of frag.querySelectorAll("img[data-remote]")) {
    const src = img.getAttribute("data-remote")!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remote-img";
    btn.title = src;
    btn.dataset.src = src;
    btn.dataset.alt = img.getAttribute("alt") ?? "";
    btn.textContent = `Load image from ${src.replace(/^https:\/\//i, "").split(/[/?#]/)[0]}`;
    img.replaceWith(btn);
  }
  return frag;
}

/** Turns a placeholder from sanitizeMarkdown into its image, and keeps it loaded for later renders. */
export function loadRemoteImage(placeholder: HTMLElement) {
  const src = placeholder.dataset.src!;
  loadedImages.add(src);
  const img = document.createElement("img");
  img.src = src;
  img.alt = placeholder.dataset.alt ?? "";
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  placeholder.replaceWith(img);
}

/** Mermaid's SVG as a string. Its <style> (scoped to the diagram's id) stays, checked for
 * anything that would fetch. <foreignObject> (HTML embedded in SVG) doesn't; Mermaid runs with
 * htmlLabels off, and mermaidRender.ts refuses the odd diagram that uses it regardless. */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
  });
}

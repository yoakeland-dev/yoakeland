// The one place untrusted markup (model output, KaTeX, Mermaid's SVG) is made safe to insert.
import DOMPurify from "dompurify";
import { allowedImgSrc, allowedSvgHref, cssIsSafe } from "./sanitizeRules";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    if (!allowedImgSrc(el.getAttribute("src") ?? "")) el.removeAttribute("src");
    el.removeAttribute("srcset");
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
    el.setAttribute("referrerpolicy", "no-referrer");
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
    FORBID_TAGS: ["style", "form", "video", "audio", "source", "track", "picture"],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const table of frag.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  return frag;
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

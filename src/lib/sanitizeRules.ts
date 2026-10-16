// The pure checks behind sanitize.ts's DOMPurify hooks, apart from it so node --test can run them.

/** Where an <img> may load from: https, or an image inlined in the message. Not http (plain text
 * on the wire), not a relative path (which would resolve against the app itself). */
export const allowedImgSrc = (src: string) => /^(?:https:\/\/|data:image\/[a-z0-9.+-]+[;,])/i.test(src.trim());

/** An https image is fetched from its own host, so it waits for the reader's click (sanitize.ts). */
export const isRemoteImgSrc = (src: string) => /^https:\/\//i.test(src.trim());

/** The only <input> a message may keep: the disabled checkbox of a GFM task list. */
export const allowedInput = (type: string | null, disabled: boolean) => type === "checkbox" && disabled;

/** SVG references that stay inside the document (a marker, a gradient), or an inlined image. */
export const allowedSvgHref = (href: string) => /^(?:#|data:image\/)/i.test(href.trim());

/** CSS that can't fetch anything or pull in more CSS. Escapes are decoded first, so `\75rl(` doesn't
 * slip past; `url(#gradient)` stays (SVG paint servers), every other url(), and @import, do not. */
export function cssIsSafe(css: string): boolean {
  const flat = css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/\\(.)/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\(\s*["']?#[^)]*\)/gi, "");
  return !/url\s*\(|@import|image-set\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(flat);
}

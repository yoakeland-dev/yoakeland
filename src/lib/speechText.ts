/** Markdown to something worth hearing: code is announced, not spelled out. */
export function plainSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, "\n\ncode block\n\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/^[ \t|:-]*\|[ \t|:-]*$/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\.?\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

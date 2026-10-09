<script lang="ts">
  // The tile for an MCP server or skill. A server gets its brand's mark when we ship one (found in its
  // name or address), else the MCP logo; a skill gets its initials. Both sit on a soft tint of a hue
  // taken from the name, so the list stays calm but a row is still easy to find again.
  import LobeIcon from "../LobeIcon.svelte";

  const BRANDS = ["github", "notion", "figma", "vercel", "cloudflare", "brave", "exa", "firecrawl", "obsidian", "perplexity", "zapier", "google"];

  let { name, hint = "", kind, size = 36 }: { name: string; hint?: string; kind: "mcp" | "skill"; size?: number } = $props();

  const hue = $derived(([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % 12 * 30);
  const brand = $derived(kind === "mcp" ? BRANDS.find((b) => `${name} ${hint}`.toLowerCase().split(/[^a-z]+/).includes(b)) : undefined);
  const words = $derived(name.split(/[\s._-]+/).filter(Boolean));
  const initials = $derived((words.length > 1 ? words[0][0] + words[1][0] : (words[0]?.slice(0, 2) ?? "?")).toUpperCase());
</script>

<span class="tile" class:brand={!!brand} style="--hue: {hue}; width: {size}px; height: {size}px; font-size: {Math.round(size * 0.36)}px" aria-hidden="true">
  {#if kind === "mcp"}
    <LobeIcon name={brand ?? "mcp"} variant={brand ? "auto" : "mono"} size={Math.round(size * 0.55)} />
  {:else}
    {initials}
  {/if}
</span>

<style>
  .tile {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 24%;
    background: hsl(var(--hue) 45% 50% / 0.16);
    color: hsl(var(--hue) 70% 72%);
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
  .tile.brand {
    background: var(--sidebar-hover);
    color: var(--text);
  }
</style>

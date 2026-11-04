<script lang="ts">
  // The tile for an MCP server or skill. A server gets its brand's mark when we ship one (found in its
  // name or address), else its initials, tinted by a hue from its name so a long list is easy to tell apart.
  import LobeIcon from "../LobeIcon.svelte";

  const BRANDS = ["github", "notion", "figma", "vercel", "cloudflare", "brave", "exa", "firecrawl", "obsidian", "perplexity", "zapier", "google"];

  let { name, hint = "", kind, size = 36 }: { name: string; hint?: string; kind: "mcp" | "skill"; size?: number } = $props();

  const brand = $derived(kind === "mcp" ? BRANDS.find((b) => `${name} ${hint}`.toLowerCase().split(/[^a-z]+/).includes(b)) : undefined);
  const words = $derived(name.split(/[\s._-]+/).filter(Boolean));
  const initials = $derived((words.length > 1 ? words[0][0] + words[1][0] : (words[0]?.slice(0, 2) ?? "?")).toUpperCase());
  // Same name, same hue, on every machine.
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span class="tile" class:brand={!!brand} style="--hue: {hue}; width: {size}px; height: {size}px; font-size: {Math.round(size * 0.36)}px" aria-hidden="true">
  {#if brand}
    <LobeIcon name={brand} variant="auto" size={Math.round(size * 0.55)} />
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
    background: oklch(from var(--panel-bg) calc(l + 0.08) 0.06 var(--hue));
    color: oklch(from var(--text) l 0.09 var(--hue));
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
  .tile.brand {
    background: var(--sidebar-hover);
    color: var(--text);
  }
</style>

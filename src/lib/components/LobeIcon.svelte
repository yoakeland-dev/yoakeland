<script module lang="ts">
  // Deliberately not using @lobehub's CDN option: Vite resolves this glob at
  // build time into one lazy chunk per icon, bundled locally, nothing fetched at runtime.
  const svgLoaders = import.meta.glob("/node_modules/@lobehub/icons-static-svg/icons/*.svg", {
    query: "?raw",
    import: "default",
  }) as Record<string, () => Promise<string>>;

  // "" marks a cached miss (no such file), distinct from "not yet requested".
  const cache = new Map<string, string>();

  let nextUid = 0;

  // Many of Lobe's colored marks embed a gradient with a *fixed* id; with the
  // same icon rendered many times at once, duplicate IDs make SVG paint-server
  // references undefined (one instance unmounting can blank another's fill).
  // Namespacing every id with a per-instance suffix keeps each icon self-contained.
  function namespaceIds(raw: string, uid: number): string {
    const ids = new Set<string>();
    const idRe = /\bid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(raw))) ids.add(m[1]);
    if (ids.size === 0) return raw;
    let out = raw;
    for (const id of ids) {
      const unique = `${id}-${uid}`;
      out = out.split(`id="${id}"`).join(`id="${unique}"`);
      out = out.split(`"#${id}"`).join(`"#${unique}"`);
      out = out.split(`url(#${id})`).join(`url(#${unique})`);
    }
    return out;
  }
</script>

<script lang="ts">
  let {
    name,
    variant = "auto",
    size = 16,
    fallback,
  }: {
    /** Icon slug from @lobehub/icons-static-svg, e.g. "openai", "claude",
     * "deepseek", "gemini", "ollama", see node_modules/@lobehub/icons-static-svg/icons
     * for the full list. */
    name: string;
    /** "auto" (default) prefers the brand-color mark and falls back to the
     * mono `currentColor` glyph for vendors that only ship one (Anthropic,
     * OpenAI). "color" / "mono" pin to one variant with no fallback. */
    variant?: "auto" | "color" | "mono";
    size?: number;
    /** Slug tried after `name` (and its own color/mono variants) come up
     * empty, e.g. an aggregator's own mark as a safety net for a vendor
     * this icon set doesn't ship. */
    fallback?: string;
  } = $props();

  function variantsOf(slug: string): string[] {
    return variant === "mono" ? [slug] : variant === "color" ? [`${slug}-color`] : [`${slug}-color`, slug];
  }

  const candidates = $derived(fallback ? [...variantsOf(name), ...variantsOf(fallback)] : variantsOf(name));

  // Stable for this component instance's whole lifetime, so re-running the
  // effect (e.g. `name` changing) doesn't leave two different id suffixes
  // fighting over the same rendered <span>.
  const uid = nextUid++;

  let svg = $state<string | null>(null);

  $effect(() => {
    const wanted = candidates;
    let cancelled = false;
    (async () => {
      for (const slug of wanted) {
        let raw = cache.get(slug);
        if (raw === undefined) {
          const load = svgLoaders[`/node_modules/@lobehub/icons-static-svg/icons/${slug}.svg`];
          if (!load) {
            cache.set(slug, ""); // no such file, cache the miss too
            continue;
          }
          raw = await load();
          if (cancelled) return;
          cache.set(slug, raw);
        }
        if (!raw) continue; // cached miss for this slug, try the next candidate
        svg = namespaceIds(raw, uid);
        return;
      }
      if (!cancelled) svg = null;
    })();
    return () => {
      cancelled = true;
    };
  });

  // rem, not px, matches Icon.svelte's scaling with UI font size.
  const REM_BASE = 14;
</script>

<span class="lobe-icon" style="width: {size / REM_BASE}rem; height: {size / REM_BASE}rem;">
  {#if svg}{@html svg}{/if}
</span>

<style>
  .lobe-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 0;
  }
  .lobe-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>

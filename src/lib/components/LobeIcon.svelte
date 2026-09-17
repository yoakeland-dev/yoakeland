<script module lang="ts">
  // @lobehub/icons-static-svg ships every vendor/model mark as a plain .svg
  // file in node_modules (no CDN, no network at runtime — see its README's
  // "CDN Usage" section, which we deliberately don't use instead). The glob
  // below is resolved by Vite at build time into one lazy-loadable chunk per
  // icon, bundled locally into the app — nothing is fetched over the network
  // at runtime, just loaded from disk on first use and cached after that.
  const svgLoaders = import.meta.glob("/node_modules/@lobehub/icons-static-svg/icons/*.svg", {
    query: "?raw",
    import: "default",
  }) as Record<string, () => Promise<string>>;

  // Raw file content, cached per slug (not per candidate list — see below).
  // "" is a cached miss (no such file), distinct from "not yet requested".
  const cache = new Map<string, string>();

  let nextUid = 0;

  // Many of Lobe's colored marks embed a gradient in <defs> with a *fixed*
  // id (e.g. `fill="url(#lobe-icons-qwen-_R_0_)"`) — fine for one copy, but
  // this app renders the same icon many times at once (a vendor tab plus one
  // row per model of that vendor). Duplicate IDs in one document make SVG
  // paint-server references undefined: some copies pick up the first
  // instance's gradient, and it goes blank/wrong the moment that first
  // instance unmounts (a tab switch, a filtered list). Namespacing every id
  // (and everything that points at it) with a per-instance suffix keeps each
  // rendered icon self-contained.
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
     * "deepseek", "gemini", "ollama" — see node_modules/@lobehub/icons-static-svg/icons
     * for the full list. */
    name: string;
    /** "auto" (default) prefers the brand-color mark and falls back to the
     * mono `currentColor` glyph for vendors that only ship one (Anthropic,
     * OpenAI). "color" / "mono" pin to one variant with no fallback. */
    variant?: "auto" | "color" | "mono";
    size?: number;
    /** Slug tried after `name` (and its own color/mono variants) come up
     * empty — e.g. an aggregator's own mark as a safety net for a vendor
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
            cache.set(slug, ""); // no such file — cache the miss too
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

  // In rem, not px — matches Icon.svelte, so these scale with Settings >
  // Appearance > UI font size instead of staying pixel-fixed.
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

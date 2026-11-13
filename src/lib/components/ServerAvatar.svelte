<script lang="ts">
  import { tip } from "../tooltip.svelte";
  import { app } from "../state.svelte";
  import { serverIconSvg } from "../serverIcons";
  import Icon from "./Icon.svelte";
  // Color hashed from serverId, not name, so renaming a server keeps its color
  // and two same-named servers still look different. Rounded square avoids
  // reading as a person's avatar.
  // `plain` leaves out the name tooltip, for a spot that already has one.
  // `bare` drops the tile for inline chrome (the composer's pills): just the icon, tinted with the
  // server's colour, or the plain computer/cloud glyph when no icon was chosen.
  let { name, seed, size = 16, bare = false, plain = false }: { name: string; seed?: string | null; size?: number; bare?: boolean; plain?: boolean } = $props();

  // FNV-1a plus murmur3's finalizer: FNV alone barely moves low bits on short, similar strings.
  function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // The operator's choice lives on the server, so every call site gets it just by passing the seed.
  const live = $derived(seed ? Object.values(app.servers).find((v) => v.serverId === seed) : undefined);
  const icon = $derived(live?.serverIcon);

  const initials = $derived.by(() => {
    const words = name.split(/[\s._-]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? "?")).toUpperCase();
  });
  const svg = $derived(serverIconSvg(icon?.name));
  // 12 evenly spaced hues rather than 360, so no two land close enough to look the same.
  const hue = $derived(icon?.hue ?? (hash(seed || name) % 12) * 30);
</script>

{#if bare}
  <span class="server-mark" class:tinted={!!svg} style="--hue: {hue}; width: {size}px; height: {size}px" {@attach plain ? undefined : tip(name)} aria-hidden="true">
    {#if svg}{@html svg}{:else}<Icon name={live?.connectionMode === "local" ? "computer" : "cloud"} {size} />{/if}
  </span>
{:else}
<span
  class="server-avatar"
  style="--hue: {hue}; width: {size}px; height: {size}px; font-size: {Math.round(size * (initials.length > 1 ? 0.45 : 0.56))}px"
  {@attach plain ? undefined : tip(name)}
  aria-hidden="true">{#if svg}{@html svg}{:else}{initials}{/if}</span
>
{/if}

<style>
  .server-mark {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Only a chosen icon is tinted (.tinted); the fallback glyph keeps the pill's own colour. */
  }
  .server-mark.tinted :global(svg) {
    width: 100%;
    height: 100%;
    color: hsl(var(--hue) 70% 66%);
  }
  .server-avatar {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 28%;
    /* Light pooling up from the bottom edge, deeper at the top: reads as a lit tile, not a flat chip. */
    background: radial-gradient(120% 110% at 50% 115%, hsl(calc(var(--hue) + 20) 75% 62%), hsl(var(--hue) 60% 42%) 55%, hsl(calc(var(--hue) - 8) 55% 28%));
    box-shadow:
      inset 0 1px 0 hsl(var(--hue) 80% 85% / 0.35),
      inset 0 0 0 1px hsl(var(--hue) 60% 20% / 0.25);
    text-shadow: 0 1px 1px hsl(var(--hue) 60% 15% / 0.4);
    color: hsl(var(--hue) 70% 96%);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    user-select: none;
  }
  /* The icon fills 60% of the tile; fill is currentColor, so it takes the tile's light text colour. */
  .server-avatar :global(svg) {
    width: 60%;
    height: 60%;
    filter: drop-shadow(0 1px 1px hsl(var(--hue) 60% 15% / 0.4));
  }
</style>

<script lang="ts">
  import { tip } from "../tooltip.svelte";
  // Color hashed from serverId, not name, so renaming a server keeps its color
  // and two same-named servers still look different. Rounded square avoids
  // reading as a person's avatar.
  let { name, seed, size = 16 }: { name: string; seed?: string | null; size?: number } = $props();

  // FNV-1a plus murmur3's finalizer: FNV alone barely moves low bits on short, similar strings.
  function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  const initials = $derived.by(() => {
    const words = name.split(/[\s._-]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? "?")).toUpperCase();
  });
  // 12 evenly spaced hues rather than 360, so no two land close enough to look the same.
  const hue = $derived((hash(seed || name) % 12) * 30);
</script>

<span
  class="server-avatar"
  style="--hue: {hue}; width: {size}px; height: {size}px; font-size: {Math.round(size * (initials.length > 1 ? 0.45 : 0.56))}px"
  {@attach tip(name)}
  aria-hidden="true">{initials}</span
>

<style>
  .server-avatar {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 28%;
    background: hsl(var(--hue) 50% 42%);
    color: hsl(var(--hue) 60% 94%);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    user-select: none;
  }
</style>

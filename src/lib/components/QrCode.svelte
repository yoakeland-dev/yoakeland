<script lang="ts">
  // Rounded-dot QR with accent-coloured eyes. Always dark on white with a quiet zone, whatever the
  // theme: scanners need the contrast. ecc "M" like the rest of the app, so keep the dots plain.
  import { encode } from "uqr";

  let { text, label }: { text: string; label: string } = $props();

  const grid = $derived(encode(text, { ecc: "M", border: 0 }).data);
  const n = $derived(grid.length);
  const inEye = (x: number, y: number, size: number) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const dots = $derived.by(() => {
    const out: [number, number][] = [];
    grid.forEach((row, y) => row.forEach((on, x) => on && !inEye(x, y, n) && out.push([x, y])));
    return out;
  });
  const eyes = $derived([[0, 0], [n - 7, 0], [0, n - 7]]);
</script>

<svg class="qr" viewBox="-2 -2 {n + 4} {n + 4}" role="img" aria-label={label} shape-rendering="geometricPrecision">
  <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
  {#each dots as [x, y] (`${x},${y}`)}
    <rect {x} {y} width="1" height="1" rx=".3" fill="#14161c" />
  {/each}
  {#each eyes as [x, y] (`${x},${y}`)}
    <rect x={x + 0.5} y={y + 0.5} width="6" height="6" rx="1.8" fill="none" stroke="var(--qr-eye)" stroke-width="1" />
    <rect x={x + 2} y={y + 2} width="3" height="3" rx="1" fill="var(--qr-eye)" />
  {/each}
</svg>

<style>
  .qr {
    --qr-eye: color-mix(in srgb, var(--accent) 60%, #000);
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-md, 0.5rem);
  }
</style>

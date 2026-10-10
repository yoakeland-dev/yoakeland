<script lang="ts">
  // Always near-black on white with a quiet zone, whatever the theme: scanners need the contrast.
  // Dots that touch a neighbour join up and only the outer corners of a run are rounded, so the
  // code reads as smooth strokes instead of a grid of separate squares. ecc "L": it's shown on a
  // screen, not printed, and a lower level means fewer, larger modules that are easier to scan.
  import { encode } from "uqr";

  let { text, label }: { text: string; label: string } = $props();

  const INK = "#111318";
  const R = 0.5;
  const grid = $derived(encode(text, { ecc: "L", border: 0 }).data);
  const n = $derived(grid.length);
  const inEye = (x: number, y: number, size: number) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const on = (x: number, y: number) => !!grid[y]?.[x] && !inEye(x, y, n);

  // One rounded square per dot; a corner is round only when both neighbours on that corner are empty.
  const body = $derived.by(() => {
    let d = "";
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!on(x, y)) continue;
        const [u, r, b, l] = [on(x, y - 1), on(x + 1, y), on(x, y + 1), on(x - 1, y)];
        const tl = u || l ? 0 : R, tr = u || r ? 0 : R, br = b || r ? 0 : R, bl = b || l ? 0 : R;
        d += `M${x + tl} ${y}H${x + 1 - tr}a${tr} ${tr} 0 0 1 ${tr} ${tr}V${y + 1 - br}a${br} ${br} 0 0 1 ${-br} ${br}H${x + bl}a${bl} ${bl} 0 0 1 ${-bl} ${-bl}V${y + tl}a${tl} ${tl} 0 0 1 ${tl} ${-tl}Z`;
      }
    return d;
  });

  const box = (x: number, y: number, s: number, r: number) =>
    `M${x + r} ${y}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(s - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(s - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  // Ring (7 across, 1 thick) plus the 3-wide pupil, in three corners.
  const eyes = $derived(
    [[0, 0], [n - 7, 0], [0, n - 7]].map(([x, y]) => box(x, y, 7, 2) + box(x + 1, y + 1, 5, 1.2) + box(x + 2, y + 2, 3, 0.9)).join(""),
  );
</script>

<svg class="qr" viewBox="-3 -3 {n + 6} {n + 6}" role="img" aria-label={label} shape-rendering="geometricPrecision">
  <rect x="-3" y="-3" width={n + 6} height={n + 6} fill="#fff" />
  <!-- the hairline stroke hides anti-aliasing seams between touching dots -->
  <path d={body} fill={INK} stroke={INK} stroke-width=".03" />
  <path d={eyes} fill={INK} fill-rule="evenodd" />
</svg>

<style>
  .qr {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-md, 0.5rem);
  }
</style>

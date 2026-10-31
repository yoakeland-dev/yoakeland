<script lang="ts">
  // Phone-only profile picture editor: drag to reposition, slide to zoom, or pick an emoji. Saves the
  // same thing the desktop upload does (a 96x96 JPEG data URL, or the emoji text), so nothing else changes.
  import { isPhotoAvatar } from "../avatar";
  import Button from "./ui/Button.svelte";
  import Icon from "./Icon.svelte";

  let { current, emojis, onsave, oncancel, bare = false }: { current: string; emojis: string[]; onsave: (avatar: string) => void; oncancel: () => void; bare?: boolean } = $props();

  const OUT = 96; // keep in step with AVATAR_SIZE in avatar.ts
  // svelte-ignore state_referenced_locally
  const startsAsPhoto = isPhotoAvatar(current);
  // svelte-ignore state_referenced_locally
  let src = $state(startsAsPhoto ? current : "");
  // svelte-ignore state_referenced_locally
  let emoji = $state(startsAsPhoto ? emojis[0] : current || emojis[0]);
  let x = $state(0);
  let y = $state(0);
  let z = $state(1);
  let img: HTMLImageElement | undefined = $state();
  let box: HTMLDivElement;
  let saving = $state(false);

  // How much bigger than the circle the photo is at zoom 1 ("cover"), per axis. A wide photo can
  // be slid sideways even unzoomed.
  let nat = $state([1, 1]);
  const over = $derived([Math.max(1, nat[0] / nat[1]), Math.max(1, nat[1] / nat[0])]);
  const limX = $derived((over[0] * z - 1) / 2);
  const limY = $derived((over[1] * z - 1) / 2);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  $effect(() => {
    x = clamp(x, limX);
    y = clamp(y, limY);
  });

  let drag: { id: number; px: number; py: number; ox: number; oy: number } | null = null;
  function down(e: PointerEvent) {
    if (!src) return;
    try {
      box.setPointerCapture(e.pointerId);
    } catch {}
    drag = { id: e.pointerId, px: e.clientX, py: e.clientY, ox: x, oy: y };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const side = box.offsetWidth;
    x = clamp(drag.ox + (e.clientX - drag.px) / side, limX);
    y = clamp(drag.oy + (e.clientY - drag.py) / side, limY);
  }

  function upload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      src = r.result as string;
      x = y = 0;
      z = 1;
    };
    r.readAsDataURL(file);
  }

  export function save() {
    if (!src || !img) return onsave(emoji);
    saving = true;
    // The same transform the preview applies (cover-fit, then translate and scale about the centre), on a 96px canvas.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return oncancel();
    const s = OUT / Math.min(img.naturalWidth, img.naturalHeight);
    ctx.translate(OUT / 2 + x * OUT, OUT / 2 + y * OUT);
    ctx.scale(z, z);
    ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    onsave(canvas.toDataURL("image/jpeg", 0.85));
  }
</script>

<section class="editor avatar-editor">
  <div
    class="crop"
    class:grab={!!src}
    bind:this={box}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
    role="img"
    aria-label="Picture preview"
  >
    {#if src}
      <img bind:this={img} {src} alt="" onload={() => (nat = [img!.naturalWidth, img!.naturalHeight])} draggable="false" style="transform: translate({x * 100}%, {y * 100}%) scale({z})" />
    {:else}
      <span class="glyph">{emoji}</span>
    {/if}
  </div>
  <input class="zoom" type="range" min="1" max="3" step="0.01" bind:value={z} disabled={!src} aria-label="Zoom" />
  <p class="hint">{src ? "Drag to reposition, slide to zoom." : "Pick a preset or upload a picture."}</p>
  <div class="presets">
    {#each emojis as e (e)}
      <button type="button" class:active={!src && emoji === e} aria-label="Use {e}" onclick={() => ((src = ""), (emoji = e))}>{e}</button>
    {/each}
  </div>
  <label class="upload">
    <Icon name="media-image" size={16} /> Upload picture
    <input type="file" accept="image/*" hidden onchange={upload} />
  </label>
  {#if !bare}
    <div class="actions">
      <Button type="button" onclick={oncancel}>Cancel</Button>
      <Button type="button" variant="primary" onclick={save} disabled={saving}>Save</Button>
    </div>
  {/if}
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.9rem;
    padding-top: 0.5rem;
  }
  .crop {
    position: relative;
    align-self: center;
    width: 184px;
    height: 184px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--accent-dim);
    border: 1px solid var(--panel-border);
    display: grid;
    place-items: center;
    touch-action: none;
    user-select: none;
  }
  .crop.grab {
    cursor: grab;
  }
  .crop img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .glyph {
    font-size: 92px;
    line-height: 1;
  }
  .zoom {
    height: 44px;
    margin: 0 1.5rem;
    accent-color: var(--accent);
  }
  .hint {
    margin: -0.6rem 0 0;
    text-align: center;
    font-size: max(12px, 0.85rem);
    color: var(--text-dim);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }
  .presets button {
    aspect-ratio: 1;
    min-height: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    font-size: 24px;
    border-radius: 50%;
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
  }
  .presets button.active {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .upload {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 52px;
    border-radius: var(--radius-lg);
    background: var(--wash-2);
    border: 1px solid var(--panel-border);
  }
  .upload:active {
    background: var(--wash-3);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
  }
  .actions > :global(*) {
    flex: 1;
    min-height: 48px;
  }
</style>

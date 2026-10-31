<script lang="ts">
  // On/off. A sunk well with a flat bead; on, the well fills with the accent. Held, the bead
  // stretches into a pill (no spring while held, so it doesn't bounce), and springs on release.
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    id,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    id?: string;
    onchange?: (checked: boolean) => void;
  } = $props();

  function set(v: boolean) {
    if (v === checked) return;
    checked = v;
    onchange?.(v);
  }

  // The bead follows a finger (or mouse) dragged along the well and settles on the nearer end; a
  // press without a drag is a click, which toggles.
  let el: HTMLButtonElement;
  let bead: HTMLSpanElement;
  let drag = $state<number | null>(null); // 0..1 while dragging
  let from = { x: 0, travel: 1, start: false, moved: false, id: -1, t: 0, p: 0, v: 0 };
  function down(e: PointerEvent) {
    if (disabled || e.button > 0) return;
    from = { x: e.clientX, travel: el.clientWidth - 2 * bead.offsetLeft - bead.offsetWidth, start: checked, moved: false, id: e.pointerId, t: e.timeStamp, p: checked ? 1 : 0, v: 0 };
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== from.id) return;
    const dx = e.clientX - from.x;
    if (!from.moved) {
      if (Math.abs(dx) < 4) return;
      from.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    const p = Math.min(1, Math.max(0, (from.start ? 1 : 0) + dx / from.travel));
    from.v = (p - from.p) / Math.max(1, e.timeStamp - from.t);
    from.p = p;
    from.t = e.timeStamp;
    drag = p;
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== from.id) return;
    from.id = -1;
    if (!from.moved) return;
    // A flick counts for its momentum, like a thrown switch.
    set(from.p + from.v * 80 > 0.5);
    drag = null;
    const eat = (c: Event) => c.stopPropagation();
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 120);
  }
</script>

<button
  bind:this={el}
  type="button"
  role="switch"
  class="switch"
  class:dragging={drag !== null}
  data-no-swipe
  aria-checked={checked}
  aria-label={label}
  {id}
  {disabled}
  style:--p={drag}
  onclick={() => set(!checked)}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => ((from.id = -1), (drag = null))}
>
  <span class="bead" bind:this={bead}></span>
</button>

<style>
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 2.86rem;
    height: 1.57rem;
    padding: 0;
    border-radius: var(--radius-pill);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    background: var(--well);
    cursor: pointer;
    outline: none;
    touch-action: pan-y;
    transition:
      background calc(0.2s * var(--anim-speed, 1)) ease,
      border-color calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .switch:not(:disabled):hover {
    background: var(--sidebar-active);
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .switch:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .bead {
    position: absolute;
    top: 0.14rem;
    left: 0.14rem;
    width: 1.14rem;
    height: 1.14rem;
    /* Half the height rather than 50%, so stretching it makes a pill, not an ellipse. */
    border-radius: 0.57rem;
    background: color-mix(in srgb, var(--bead) 70%, var(--text-dim));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    transition:
      transform calc(0.3s * var(--anim-speed, 1)) var(--ui-spring),
      width calc(0.12s * var(--anim-speed, 1)) ease,
      background calc(0.2s * var(--anim-speed, 1)) ease;
  }
  .switch:not(:disabled):active .bead {
    width: 1.43rem;
    transition:
      transform calc(0.12s * var(--anim-speed, 1)) ease,
      width calc(0.12s * var(--anim-speed, 1)) ease;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked="true"]:not(:disabled):hover {
    background: color-mix(in srgb, var(--accent) 88%, #fff);
  }
  .switch[aria-checked="true"] .bead {
    transform: translateX(1.29rem);
    background: var(--bead);
  }
  /* Dragged: the bead and the well follow --p (0..1) with no transition, so they stay under the finger. */
  .switch.dragging.dragging {
    background: color-mix(in srgb, var(--accent) calc(var(--p) * 100%), var(--well));
    border-color: color-mix(in srgb, var(--accent) calc(var(--p) * 100%), var(--panel-border));
  }
  .switch.dragging.dragging .bead {
    width: 1.43rem;
    transform: translateX(calc(var(--p) * 1.0rem));
    background: var(--bead);
    transition: none;
  }
  /* Held while on: grow leftward so the right edge stays put. */
  .switch[aria-checked="true"]:not(:disabled):active .bead {
    transform: translateX(1rem);
  }
</style>

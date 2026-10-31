<script lang="ts">
  // Pick one of a few. The selected option is a raised pill that slides between them. Columns are
  // equal width so the pill can be moved with a single translate.
  let {
    options,
    value = $bindable(),
    label,
    disabled = false,
    onchange,
  }: {
    options: { value: string; label: string }[];
    value?: string;
    label?: string;
    disabled?: boolean;
    onchange?: (v: string) => void;
  } = $props();

  const index = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

  // The pill can be grabbed and dragged: it follows the finger as a fractional index and settles
  // on the nearest option (momentum included). A press without a drag is a plain click.
  let root: HTMLElement;
  let dragI = $state<number | null>(null);
  let g = { x: 0, w: 1, i: 0, moved: false, id: -1, t: 0, v: 0 };
  function down(e: PointerEvent) {
    if (disabled || e.button > 0 || !(e.target as HTMLElement).closest(".pill, button[aria-checked='true']")) return;
    g = { x: e.clientX, w: (root.clientWidth - 4) / options.length, i: index, moved: false, id: e.pointerId, t: e.timeStamp, v: 0 };
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    if (!g.moved) {
      if (Math.abs(dx) < 4) return;
      g.moved = true;
      root.setPointerCapture(e.pointerId);
    }
    const i = Math.min(options.length - 1, Math.max(0, index + dx / g.w));
    g.v = (i - (dragI ?? index)) / Math.max(1, e.timeStamp - g.t);
    g.t = e.timeStamp;
    dragI = i;
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== g.id) return;
    g.id = -1;
    if (!g.moved || dragI === null) return;
    const to = Math.round(Math.min(options.length - 1, Math.max(0, dragI + g.v * 90)));
    dragI = null;
    pick(options[to].value);
    const eat = (c: Event) => c.stopPropagation();
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 120);
  }

  function pick(v: string) {
    if (disabled || v === value) return;
    value = v;
    onchange?.(v);
  }
  function key(e: KeyboardEvent) {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[Math.min(options.length - 1, Math.max(0, index + d))];
    pick(next.value);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")[options.indexOf(next)]?.focus();
  }
</script>

<div
  bind:this={root}
  class="segmented"
  class:disabled
  class:dragging={dragI !== null}
  data-no-swipe
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  style:--n={options.length}
  style:--i={dragI ?? index}
  onkeydown={key}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => ((g.id = -1), (dragI = null))}
>
  <span class="pill"></span>
  {#each options as o (o.value)}
    <button type="button" role="radio" aria-checked={o.value === value} tabindex={o.value === value ? 0 : -1} {disabled} onclick={() => pick(o.value)}>
      {o.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    box-sizing: border-box;
    height: var(--ctrl-h, 2rem);
    padding: 2px;
    background: var(--field-bg);
    border: 1px solid var(--panel-border);
    border-block-color: var(--panel-border-top) var(--panel-border-bottom);
    border-radius: var(--radius-sm);
  }
  .segmented {
    touch-action: pan-y;
    user-select: none;
  }
  .segmented.dragging .pill {
    transition: none;
  }
  .segmented.disabled {
    opacity: 0.5;
  }
  /* Radius 4: the control's 7 less the 2px padding and 1px border, so the curves stay concentric. */
  .pill {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--n));
    border-radius: var(--radius-xs);
    background: var(--sidebar-active);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    translate: calc(var(--i) * 100%) 0;
    transition: translate calc(0.26s * var(--anim-speed, 1)) var(--ui-ease);
  }
  button {
    position: relative;
    padding: 0 0.78rem;
    background: none;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    font: inherit;
    font-size: var(--text-label-size);
    cursor: pointer;
    outline: none;
    transition: color calc(0.15s * var(--anim-speed, 1)) ease;
  }
  button:hover:not(:disabled),
  button[aria-checked="true"] {
    color: var(--text);
  }
  button:disabled {
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
</style>

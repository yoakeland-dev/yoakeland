<script lang="ts">
  // A number in a field, with minus and plus inside it. Hold a button to repeat; the arrow keys
  // step too. Typing is free until it is committed (Enter or blur), then clamped to min and max.
  import Icon from "../Icon.svelte";

  let {
    value = $bindable(0),
    min = -Infinity,
    max = Infinity,
    step = 1,
    unit,
    disabled = false,
    invalid = false,
    label,
    id,
    class: cls = "",
    oninput,
    onchange,
  }: {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    /** Text after the number inside the field: px, tok. */
    unit?: string;
    disabled?: boolean;
    invalid?: boolean;
    label?: string;
    id?: string;
    class?: string;
    oninput?: (v: number) => void;
    onchange?: (v: number) => void;
  } = $props();

  const dec = $derived(String(step).split(".")[1]?.length ?? 0);
  let text = $state<string | null>(null);
  let timer = 0;
  let repeat = 0;

  const clamp = (v: number) => +Math.min(max, Math.max(min, v)).toFixed(dec);
  function set(v: number) {
    const next = clamp(v);
    text = null;
    if (next === value) return;
    value = next;
    oninput?.(next);
  }
  function bump(d: number) {
    set((Number.isFinite(value) ? value : 0) + d * step);
  }
  function stop() {
    clearTimeout(timer);
    clearInterval(repeat);
  }
  function hold(d: number, e: PointerEvent) {
    if (e.button) return;
    stop();
    bump(d);
    timer = window.setTimeout(() => (repeat = window.setInterval(() => bump(d), 70)), 380);
  }
  function release() {
    stop();
    onchange?.(value);
  }
  function commit() {
    if (text === null) return;
    const v = parseFloat(text);
    set(Number.isNaN(v) ? value : v);
    onchange?.(value);
  }
  $effect(() => () => stop());
</script>

<div class="ui-field num {cls}" class:invalid class:disabled>
  <button type="button" class="ui-mini" aria-label="Decrease" tabindex="-1" disabled={disabled || value <= min} onpointerdown={(e) => hold(-1, e)} onpointerup={release} onpointerleave={stop} onpointercancel={stop}>
    <Icon name="minus" size={13} />
  </button>
  <span class="mid">
    <input
      {id}
      type="text"
      inputmode={dec ? "decimal" : "numeric"}
      aria-label={label}
      {disabled}
      value={text ?? value.toFixed(dec)}
      oninput={(e) => (text = e.currentTarget.value)}
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          bump(e.key === "ArrowUp" ? 1 : -1);
          onchange?.(value);
        } else if (e.key === "Enter") commit();
      }}
    />
    {#if unit}<span class="affix">{unit}</span>{/if}
  </span>
  <button type="button" class="ui-mini" aria-label="Increase" tabindex="-1" disabled={disabled || value >= max} onpointerdown={(e) => hold(1, e)} onpointerup={release} onpointerleave={stop} onpointercancel={stop}>
    <Icon name="plus" size={13} />
  </button>
</div>

<style>
  .num {
    padding: 0 0.21rem;
    width: auto;
  }
  .mid {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.29rem;
    min-width: 0;
  }
  .mid input {
    flex: none;
    width: 4em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>

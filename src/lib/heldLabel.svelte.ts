/** Backs a collapsed group header's sliding label (ToolCallGroup, WorkGroup)
 * so a finished step's label doesn't slide away in the same instant its
 * spinner turns into a checkmark — the checkmark gets a moment on screen
 * first, then the label slides to whatever's next. `get()` returns the
 * "real" (key, label) pair the header would show with no delay at all, plus
 * whether the run ended in error. Skipped entirely on an error transition —
 * there's nothing to hold a beat for, so it jumps straight to the new
 * (tinted) state. */
export function heldLabel(get: () => { key: string; label: string; hasError: boolean }, delayMs = 450) {
  const initial = get();
  let displayKey = $state(initial.key);
  let displayLabel = $state(initial.label);
  let flashing = $state(false);

  $effect(() => {
    const { key, label, hasError } = get();
    if (key === displayKey) return;
    if (hasError) {
      displayKey = key;
      displayLabel = label;
      return;
    }
    flashing = true;
    const timer = setTimeout(() => {
      flashing = false;
      displayKey = key;
      displayLabel = label;
    }, delayMs);
    return () => clearTimeout(timer);
  });

  return {
    get key() {
      return displayKey;
    },
    get label() {
      return displayLabel;
    },
    get flashing() {
      return flashing;
    },
  };
}

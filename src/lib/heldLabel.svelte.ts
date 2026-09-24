/** Delays a collapsed group header's label change so the checkmark gets a moment on screen
 * before the label slides to the next step. Skipped on an error transition (jumps straight there). */
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

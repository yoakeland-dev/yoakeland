import { untrack } from "svelte";

/** Runs `run`, debounced, whenever `key()` changes, but only while `visible()`: a change that
 * happens while hidden runs once it's shown again, instead of refetching for nobody. Call during
 * component init. `skipFirst` treats the key at mount as already handled. */
export function refreshWhenVisible(
  key: () => unknown,
  visible: () => boolean,
  run: () => void,
  { delay = 250, skipFirst = false } = {},
) {
  let done: unknown = skipFirst ? untrack(key) : {};
  $effect(() => {
    const k = key();
    if (!visible() || k === done) return;
    const timer = setTimeout(() => {
      done = k;
      untrack(run);
    }, delay);
    return () => clearTimeout(timer);
  });
}

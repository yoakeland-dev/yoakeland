/** A short tick when a gesture commits. Android only: iOS Safari has no vibration API, so there it does nothing. */
export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Blocked without a recent touch; the gesture itself is feedback enough.
  }
}

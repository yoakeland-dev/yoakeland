// Per-reply view state for the tool/thinking dropdown (SimpleWork.svelte). Kept here rather than in
// the component: MessageList tears far rows down to a placeholder, which would forget what was open.
import { app } from "./state.svelte";

export const workView = $state({
  /** Reply id -> its dropdown is open. Absent means the default for that reply. */
  open: {} as Record<string, boolean>,
  /** Reply id -> true shows every block inline (verbose) in a simple setup, false the opposite. */
  full: {} as Record<string, boolean>,
  /** Set by chat find to the reply it just landed on and the term, so a match inside a dropdown opens it. */
  reveal: { id: "", q: "" },
});

/** Whether this reply renders every block inline: its own override, else the Settings choice. */
export function showsAll(id: string): boolean {
  return workView.full[id] ?? app.settings.toolView === "verbose";
}

export function toggleFull(id: string) {
  workView.full[id] = !showsAll(id);
}

/** Opens or closes the newest reply's dropdown in the current chat (keyboard shortcut). */
export function toggleLatestWork(sessionId: string) {
  const msgs = app.active?.messagesBySession[sessionId] ?? [];
  const last = msgs.findLast((m) => m.role === "assistant");
  if (!last || showsAll(last.id)) return;
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(last.id)}"] [data-work]`);
  if (el) el.dispatchEvent(new CustomEvent("togglework"));
}

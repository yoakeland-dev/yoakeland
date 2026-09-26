import { untrack } from "svelte";
import type { ChatMessage } from "./types";
import { activityFor, dotModeFor } from "./toolMeta";

type Activity = { mode: ReturnType<typeof dotModeFor>; label: string };

const IN_FLIGHT = new Set(["requested", "awaiting_permission", "awaiting_answer", "running"]);
// Claude Code only reports a tool call once it's about to run, and a read or an edit is over
// in milliseconds, so a tool's pattern stays up at least this long (about one cycle plus the
// crossfade) or it would never visibly replace "thinking".
const HOLD_MS = 1600;

function current(m: ChatMessage | undefined): Activity {
  if (!m?.streaming) return { mode: "thinking", label: "" };
  const call = m.toolCalls.findLast((c) => IN_FLIGHT.has(c.status));
  if (call?.status === "awaiting_permission") return { mode: dotModeFor(call), label: "Waiting for your approval" };
  if (call?.status === "awaiting_answer") return { mode: "thinking", label: "Waiting for your answer" };
  if (call) return { mode: dotModeFor(call), label: activityFor(call) };
  const lastOffset = m.toolCalls.reduce((n, c) => Math.max(n, c.textOffset ?? 0), 0);
  return { mode: "thinking", label: m.text.length > lastOffset ? "Writing" : "Thinking" };
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** What a streaming reply is doing right now, for the dot-matrix spinner and its label, plus
 * a once-a-second elapsed time. Call during component init. */
export function liveActivity(get: () => ChatMessage | undefined) {
  const raw = $derived(current(get()));
  let shown = $state(untrack(() => raw));
  let since = Date.now();
  $effect(() => {
    const next = raw;
    const prev = untrack(() => shown);
    const wait = next.mode === prev.mode || prev.mode === "thinking" ? 0 : since + HOLD_MS - Date.now();
    const apply = () => {
      if (next.mode !== prev.mode) since = Date.now();
      shown = next;
    };
    if (wait <= 0) return apply();
    const t = setTimeout(apply, wait);
    return () => clearTimeout(t);
  });

  let now = $state(Date.now());
  $effect(() => {
    if (!get()?.streaming) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  return {
    get mode() {
      return shown.mode;
    },
    get label() {
      return shown.label;
    },
    get elapsed() {
      return formatElapsed(now - (get()?.createdAt ?? now));
    },
  };
}

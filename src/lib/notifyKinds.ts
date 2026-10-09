// The kinds of notification the server raises (yoakeland cmd/yoakeland/notify.go), with the
// wording Settings and the notification center use for them.
export interface NotifyKind {
  kind: string;
  label: string;
  priority: "urgent" | "normal" | "quiet";
}

export const NOTIFY_KINDS: NotifyKind[] = [
  { kind: "permission_request", label: "Permission needed", priority: "urgent" },
  { kind: "ask_user_question_requested", label: "The agent has a question", priority: "urgent" },
  { kind: "turn_error", label: "A turn failed", priority: "urgent" },
  { kind: "budget_exceeded", label: "Session spend cap reached", priority: "urgent" },
  { kind: "no_provider", label: "No provider configured", priority: "urgent" },
  { kind: "turn_done", label: "A long response finished", priority: "normal" },
  { kind: "turn_cut_off", label: "A response hit the output limit", priority: "normal" },
  { kind: "peer_joined", label: "A remote device connected", priority: "quiet" },
  { kind: "peer_left", label: "A remote device disconnected", priority: "quiet" },
];

export const DEFAULT_NOTIFY_PREFS = { urgent: true, normal: true, quiet: false, minTurnSec: 30, muted: [] as string[] };

export const kindLabel = (kind: string) => NOTIFY_KINDS.find((k) => k.kind === kind)?.label ?? kind;

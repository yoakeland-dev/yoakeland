// Terminal output (SPEC.md §3.2 terminal_output) is high-frequency binary
// data — routed here instead of through a $state field so a busy pty doesn't
// force a Svelte render on every chunk. state.svelte.ts publishes; each
// TerminalView.svelte subscribes once for the life of its xterm instance,
// synchronously before it asks ipc.ts to open/attach the terminal, so it
// never misses the snapshot that request triggers.
//
// "snapshot" (terminal_snapshot's `history`) means "repaint from scratch" —
// the subscriber resets its buffer before writing it, rather than appending,
// since it can also arrive mid-life (a re-attach after `restartIfExited`).
// "chunk" (terminal_output) always appends.
export type TerminalMessage = { kind: "snapshot" | "chunk"; bytes: Uint8Array };
type Sink = (msg: TerminalMessage) => void;

const sinks = new Map<string, Set<Sink>>();

export function subscribeTerminal(terminalId: string, sink: Sink): () => void {
  let set = sinks.get(terminalId);
  if (!set) {
    set = new Set();
    sinks.set(terminalId, set);
  }
  set.add(sink);
  return () => {
    set!.delete(sink);
    if (set!.size === 0) sinks.delete(terminalId);
  };
}

export function publishTerminalSnapshot(terminalId: string, bytes: Uint8Array) {
  for (const sink of sinks.get(terminalId) ?? []) sink({ kind: "snapshot", bytes });
}

export function publishTerminalChunk(terminalId: string, bytes: Uint8Array) {
  for (const sink of sinks.get(terminalId) ?? []) sink({ kind: "chunk", bytes });
}

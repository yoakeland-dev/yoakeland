// Routed outside $state so a busy pty doesn't force a Svelte render on every chunk. Each
// TerminalView subscribes before asking ipc.ts to open/attach, so it never misses the initial snapshot.
// "snapshot" resets the subscriber's buffer (can arrive mid-life on a re-attach); "chunk" appends.
// `sequence` is the server's output counter (§3.2): a snapshot includes output up to it, a chunk is it.
export type TerminalMessage = { kind: "snapshot" | "chunk"; bytes: Uint8Array; sequence: number };
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

export function publishTerminalSnapshot(terminalId: string, bytes: Uint8Array, sequence: number) {
  for (const sink of sinks.get(terminalId) ?? []) sink({ kind: "snapshot", bytes, sequence });
}

export function publishTerminalChunk(terminalId: string, bytes: Uint8Array, sequence: number) {
  for (const sink of sinks.get(terminalId) ?? []) sink({ kind: "chunk", bytes, sequence });
}

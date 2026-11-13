import type { Envelope } from "./types";
import { relayable, type RelayCandidate } from "./serverKey.ts";

type ConnectionId = string;

type Send = (connectionId: ConnectionId, envelope: Envelope) => unknown;
interface Hop {
  /** The server the chat is on (B) and the one with the provider (A). */
  from: ConnectionId;
  to: ConnectionId;
  sessionId?: string;
  turnId?: string;
}

/** Model forwarding's device side: relays `forward_*` frames between two connected servers and tells
 * each server which others this device reaches. Plain Maps, no reactive state, and `data` and `chunk`
 * are never read: one chunk costs one small envelope. */
export function createRelay(send: Send, servers: () => Record<ConnectionId, RelayCandidate>) {
  const canRelay = (s: RelayCandidate) => relayable(s, Object.values(servers()));
  const hops = new Map<string, Hop>(); // requestId -> who talks to whom
  const offered = new Map<ConnectionId, string>(); // what each server was last told

  const pass = (to: ConnectionId, env: Envelope, fallback?: Hop, data = env.data) =>
    send(to, { type: env.type, sessionId: env.sessionId ?? fallback?.sessionId, turnId: env.turnId ?? fallback?.turnId, data });
  const fail = (h: Hop, requestId: string, error: string) =>
    send(h.from, { type: "forward_end", sessionId: h.sessionId, turnId: h.turnId, data: { requestId, error } });

  /** True when the envelope was a forwarding frame and has been dealt with. */
  function handle(connectionId: ConnectionId, env: Envelope): boolean {
    const d = env.data as { requestId?: string; serverId?: string; seq?: number } | undefined;
    switch (env.type) {
      case "forward_request": {
        if (!d?.requestId) return true;
        // The lending server decides on who is asking, so the fields written here are the sender's own
        // serverId and what this device verified about it, over anything the frame already said. Every
        // piece, since A reassembles by id. A sender that can't relay (no key yet, a clashing id) gets none.
        const b = servers()[connectionId];
        const mine = b && canRelay(b) ? b.serverId : null;
        let h = hops.get(d.requestId);
        if (h) {
          // A second request under a live id, or one from someone else: not the same stream, drop it.
          if (h.from !== connectionId || d.seq === 0) return true;
        } else {
          // A later piece of a request that already ended: B has been told.
          if (d.seq !== 0) return true;
          const a = Object.values(servers()).find((s) => s.serverId === d.serverId && s.connectionId !== connectionId && canRelay(s));
          h = { from: connectionId, to: a?.connectionId ?? "", sessionId: env.sessionId, turnId: env.turnId };
          if (!mine || !a) {
            void fail(h, d.requestId, mine ? "this device is not connected to the server that has that provider" : "this device does not know this server's id yet");
            return true;
          }
          hops.set(d.requestId, h);
        }
        if (!mine) return true;
        void pass(h.to, env, undefined, { ...env.data, from: mine, fromKey: b!.relayKey });
        return true;
      }
      case "forward_cancel": {
        const h = d?.requestId ? hops.get(d.requestId) : undefined;
        if (h && h.from === connectionId) {
          void pass(h.to, env);
          hops.delete(d!.requestId!); // whatever A still sends is dropped
        }
        return true;
      }
      case "forward_chunk":
      case "forward_end": {
        const h = d?.requestId ? hops.get(d.requestId) : undefined;
        if (!h || h.to !== connectionId) return true;
        void pass(h.from, env, h);
        if (env.type === "forward_end") hops.delete(d!.requestId!);
        return true;
      }
    }
    return false;
  }

  /** A connection is gone: end what ran through it, telling the other side. */
  function dropConnection(connectionId: ConnectionId) {
    offered.delete(connectionId);
    for (const [id, h] of hops) {
      if (h.to === connectionId) {
        void fail(h, id, "the server with that provider disconnected");
      } else if (h.from === connectionId) {
        void send(h.to, { type: "forward_cancel", data: { requestId: id } });
      } else continue;
      hops.delete(id);
    }
  }

  /** Tells each forwarding-capable server which others this device reaches; only when that changed. */
  function syncOffers() {
    const capable = Object.values(servers()).filter(canRelay);
    for (const id of offered.keys()) if (!capable.some((s) => s.connectionId === id)) offered.delete(id);
    for (const s of capable) {
      const servers = [...new Set(capable.filter((o) => o.serverId !== s.serverId).map((o) => o.serverId!))].sort();
      const key = servers.join(",");
      if (offered.get(s.connectionId) === key) continue;
      offered.set(s.connectionId, key);
      void send(s.connectionId, { type: "relay_offer", data: { servers } });
    }
  }

  return { handle, dropConnection, syncOffers };
}

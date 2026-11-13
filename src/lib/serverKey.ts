/** What this device itself verified about its connection to a server, for model forwarding (SPEC.md
 * "Lending is a grant"). A server's id is only what it says about itself; this a server can't fake,
 * since the connection only opens if the server holds the matching key. Lending servers match a
 * request's `fromKey` against the keys a grant was made for. */
import { canUseRtc } from "./rtc.ts";

/** What `relayable` reads of a connection (ServerState has it all). */
export interface RelayCandidate {
  connectionId: string;
  connectionStatus: string;
  serverId: string | null;
  relayKey: string | null;
  idConflict: boolean;
  features: string[];
}

/** Connected, identified by a key this device verified, listing the `forwarding` feature, and the only
 * connected server in `all` with its id: may offer, relay and lend. Two servers with one id would let
 * either take the other's requests, so neither does. */
export const relayable = (s: RelayCandidate, all: RelayCandidate[]) =>
  s.connectionStatus === "connected" &&
  !!s.serverId &&
  !!s.relayKey &&
  !s.idConflict &&
  s.features.includes("forwarding") &&
  !all.some((o) => o.connectionId !== s.connectionId && o.connectionStatus === "connected" && o.serverId === s.serverId);

export type KeyedParams =
  | { mode: "local" }
  | { mode: "remote"; host: string; caPem?: string; rtcFp?: string };

/** Follows how each app connects (platform.ts `connect_tcp`): the web app over WebRTC pinned to the
 * fingerprint when it has one and an IP address, else over the browser's TLS; the desktop over TLS with
 * the paired CA, else the system's trust store. */
export async function connectionKey(p: KeyedParams, web: boolean): Promise<string> {
  if (p.mode === "local") return "local"; // ponytail: this machine's own socket; nothing else to pin
  if (web && p.rtcFp && canUseRtc(p.host)) return `dtls:${p.rtcFp.replace(/:/g, "").toLowerCase()}`;
  const blocks = !web && p.caPem ? [...p.caPem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)] : [];
  if (blocks.length) {
    const der = Uint8Array.from(blocks.map((m) => atob(m[1].replace(/\s+/g, ""))).join(""), (c) => c.charCodeAt(0));
    const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
    return `ca:${Array.from(sum, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `host:${p.host.toLowerCase()}`;
}

import { loadKnownServers, type ServerState, type app } from "./state.svelte";
import type { ModelInfo, ProviderInfo } from "./types";
import { providerLabel } from "./modelVendor";

type App = typeof app;

/** The provider kinds another server may lend. Phase 3 adds the CLI kinds here and nowhere else. */
export const FORWARDABLE_KINDS: ReadonlySet<string> = new Set(["api_key"]);
export const isForwardable = (p: ProviderInfo) => FORWARDABLE_KINDS.has(p.kind);

export const viaName = (serverId: string, name: string) => `via:${serverId}:${name}`;

/** `via:<serverId>:<name>` taken apart; null for an ordinary provider name. */
export function parseVia(name?: string | null): { serverId: string; name: string } | null {
  if (!name?.startsWith("via:")) return null;
  const i = name.indexOf(":", 4);
  return i > 4 ? { serverId: name.slice(4, i), name: name.slice(i + 1) } : null;
}

/** Connected, identified, and listing the `forwarding` feature: may offer, relay and lend. */
export const canRelay = (s: ServerState) => s.connectionStatus === "connected" && !!s.serverId && s.features.includes("forwarding");

const lenderOf = (app: App, serverId: string) => Object.values(app.servers).find((s) => s.serverId === serverId && canRelay(s));

/** What to call a server by its id: the live connection's name, else the remembered one. */
export function serverNameOf(app: App, serverId: string): string {
  const live = Object.values(app.servers).find((s) => s.serverId === serverId);
  return live?.label ?? loadKnownServers().find((k) => k.serverId === serverId)?.label ?? "another server";
}

export interface Lender {
  server: ServerState;
  /** The lender's providers as `b` would name them (`via:` names). */
  providers: ProviderInfo[];
}

/** Other servers' providers that `b` can borrow: forwardable kind, allowed on the lender, not a key `b`
 * already has, and a key several servers share listed once. A provider with no keyId is never a duplicate. */
export function borrowable(app: App, b: ServerState): Lender[] {
  if (!canRelay(b)) return [];
  const seen = new Set(b.providers.map((p) => p.keyId).filter(Boolean));
  const out: Lender[] = [];
  for (const s of Object.values(app.servers)) {
    if (s === b || s.serverId === b.serverId || !canRelay(s)) continue;
    const providers: ProviderInfo[] = [];
    for (const p of s.providers) {
      if (!isForwardable(p) || !s.canUseProvider(p)) continue;
      if (p.keyId) {
        if (seen.has(p.keyId)) continue;
        seen.add(p.keyId);
      }
      providers.push({ ...p, name: viaName(s.serverId!, p.name) });
    }
    if (providers.length) out.push({ server: s, providers });
  }
  return out;
}

/** The one place a chat's provider name turns into what to show and what to look up. A `via:` name
 * resolves on the lending server; offline there, `info` is a stand-in so the chat still shows a label. */
export function describeProvider(
  app: App,
  server: ServerState | null | undefined,
  providerName: string | undefined,
): { label: string; serverName?: string; offline?: boolean; info?: ProviderInfo; lender?: ServerState; models: ModelInfo[] } {
  const via = parseVia(providerName);
  if (!via) {
    const info = server?.providers.find((p) => p.name === providerName);
    return { label: info ? providerLabel(info) : (providerName ?? ""), info, lender: server ?? undefined, models: info ? (server?.modelsByProvider[info.name] ?? []) : [] };
  }
  const lender = lenderOf(app, via.serverId);
  const own = lender?.providers.find((p) => p.name === via.name);
  const info: ProviderInfo = { ...(own ?? { kind: "api_key" as const, label: via.name }), name: providerName! };
  return {
    label: own ? providerLabel(own) : via.name,
    serverName: serverNameOf(app, via.serverId),
    offline: !lender,
    lender,
    info,
    models: lender?.modelsByProvider[via.name] ?? [],
  };
}

/** The line shown in a chat's working indicator while B waits for a device that reaches A. */
export function forwardWaitLabel(app: App, server: ServerState | null | undefined, sessionId: string): string | undefined {
  const id = server?.forwardingTo(sessionId);
  return id ? `Waiting for a device connected to ${serverNameOf(app, id)}` : undefined;
}

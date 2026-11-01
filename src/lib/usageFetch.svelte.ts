// Usage reports per server, fetched in the background from startup so the usage page (which can
// be slow to load) is ready when opened. Kept across visits; reopening shows the last numbers.
import { app, type ServerState } from "./state.svelte";
import { getUsage } from "./ipc";
import type { UsageReport } from "./usage";

export interface Fetched {
  report?: UsageReport;
  error?: string;
  loading: boolean;
}
export const fetched = $state<Record<string, Fetched>>({});

export const usageKey = (s: ServerState) => s.serverId ?? s.connectionId;

export async function loadUsage(srv: ServerState) {
  const k = usageKey(srv);
  const cur = fetched[k];
  if (cur?.loading) return;
  fetched[k] = { ...cur, loading: true };
  try {
    const r = await getUsage(srv.connectionId);
    fetched[k] = r.error ? { ...fetched[k], error: r.error, loading: false } : { report: r, loading: false };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    fetched[k] = {
      ...fetched[k],
      loading: false,
      error: msg.includes("no reply") ? "Not reporting usage yet. Update yoakeland there." : msg,
    };
  }
}

/** Refetch a server when it (re)connects or its status ping says a turn finished (activeTurns/spend
 * moved). The server caches parsed files, so a repeat scan is cheap. Returns a stop function. */
export function startUsagePrefetch() {
  const seen = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const stop = $effect.root(() => {
    $effect(() => {
      for (const s of Object.values(app.servers).filter((s) => s.connectionStatus === "connected")) {
        const k = usageKey(s);
        const sig = `${s.connectionId}|${s.serverStatus?.activeTurns ?? ""}|${s.serverStatus?.spend?.todayUsd ?? ""}`;
        const prev = seen.get(k);
        seen.set(k, sig);
        if (prev === sig) continue;
        clearTimeout(timers.get(k));
        timers.set(k, setTimeout(() => void loadUsage(s), prev === undefined ? 0 : 1500));
      }
    });
  });
  return () => (stop(), timers.forEach(clearTimeout));
}

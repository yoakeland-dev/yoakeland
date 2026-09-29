// Subscription limits (SPEC.md §2a status.rateLimits), one card per CLI login per server;
// read by the status bar's UsageWidget and the usage page.
import type { ConnectionId, ServerState } from "./state.svelte";
import { relTime } from "./format";
import { CLI_AGENTS } from "./modelVendor";
import type { CliKind, ProviderRateLimits, RateWindow } from "./types";

export interface Win {
  label: string;
  short: string;
  pct: number;
  resetsAt?: string;
}
export interface Card {
  id: string;
  cid: ConnectionId;
  srv: ServerState;
  title: string;
  icon: string;
  plan?: string;
  updatedAt?: string;
  windows: Win[];
  peak?: Win;
}

function span(mins: number | undefined): { label: string; short: string } {
  if (!mins) return { label: "Limit", short: "" };
  if (mins === 7 * 1440) return { label: "Weekly", short: "7d" };
  if (mins % 1440 === 0) return { label: `${mins / 1440}-day`, short: `${mins / 1440}d` };
  if (mins % 60 === 0) return { label: `${mins / 60}-hour`, short: `${mins / 60}h` };
  return { label: `${mins}-min`, short: `${mins}m` };
}
function toWin(w: RateWindow, mins: number | undefined): Win {
  const s = span(mins);
  return {
    label: w.label ? `${s.label} · ${w.label}` : s.label,
    short: w.label ? `${w.label} ${s.short}` : s.short,
    pct: Math.round(w.usedPct),
    resetsAt: w.resetsAt || undefined,
  };
}
function windows(rl: ProviderRateLimits): Win[] {
  return [
    ...(rl.fiveHour ? [toWin(rl.fiveHour, 300)] : []),
    ...(rl.sevenDay ? [toWin(rl.sevenDay, 7 * 1440)] : []),
    ...(rl.other ?? []).map((w) => toWin(w, w.windowMins)),
  ];
}

export function limitCards(servers: ServerState[]): Card[] {
  const out: Card[] = [];
  for (const srv of servers) {
    for (const [name, rl] of Object.entries(srv.serverStatus?.rateLimits ?? {})) {
      const agent = CLI_AGENTS[rl.kind as CliKind];
      // Older servers don't send `kind`; fall back to one card per name.
      const id = `${srv.serverId ?? srv.connectionId}:${rl.kind ?? name}`;
      if (out.some((c) => c.id === id)) continue;
      const ws = windows(rl);
      out.push({
        id,
        cid: srv.connectionId,
        srv,
        title: agent?.title ?? name,
        icon: agent?.icon ?? "",
        plan: rl.plan,
        updatedAt: rl.updatedAt,
        windows: ws,
        peak: ws.reduce<Win | undefined>((a, w) => (!a || w.pct > a.pct ? w : a), undefined),
      });
    }
  }
  return out;
}

export const level = (pct: number) => (pct >= 100 ? "full" : pct >= 80 ? "hot" : "");

// Short enough to share a line with the window's name: "in 2h 14m", "in 3d 4h".
export function resetText(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) return "resetting";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}
export const resetTitle = (iso: string) =>
  `Resets ${new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
export function updated(iso: string, now: number): string {
  const r = relTime(iso, now);
  return r === "now" ? "just now" : `${r} ago`;
}

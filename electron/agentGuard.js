// Per-webview navigation guard for the agent's browser (see main.js lockDownWebviews): while the
// agent drives a page, page-initiated navigation is limited to a set of hosts, and what was
// stopped is remembered until the guard is released.
export function createGuards() {
  const guards = new Map(); // webContents id -> { hosts: Set<string>, blocked: string[] }
  return {
    guard(id, hosts) {
      guards.set(id, { hosts: new Set((hosts ?? []).map((h) => String(h).toLowerCase())), blocked: [] });
    },
    /** Releases the guard; returns the URLs it stopped. */
    unguard(id) {
      const g = guards.get(id);
      guards.delete(id);
      return g?.blocked ?? [];
    },
    /** True when url may load in webContents id; otherwise records it as blocked. */
    allows(id, url) {
      const g = guards.get(id);
      if (!g) return true;
      try {
        const u = new URL(url);
        if (u.protocol === "about:") return true;
        if (g.hosts.has(u.hostname.toLowerCase().replace(/^\[|\]$/g, ""))) return true;
      } catch {}
      g.blocked.push(url);
      return false;
    },
  };
}

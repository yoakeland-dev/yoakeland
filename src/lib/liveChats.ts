// Which chats belong in the header's live tabs: the ones that want you (asking, running, or
// finished and unseen) that aren't already on screen. Kept free of app state so it can run
// under `node --test src/lib/`.
import type { SessionSummary } from "./types";

export const STATUS_ICON = {
  working: "loader-2",
  action: "alert-circle",
  finished: "circle-check",
  idle: "message-circle",
} as const;

export type LiveStatus = "action" | "working" | "finished";

export interface LiveTab {
  key: string;
  cid: string;
  sessionId: string;
  session: SessionSummary;
  status: LiveStatus;
}

/** The slice of ServerState this reads. */
export interface LiveSource {
  pendingAsks: { sessionId: string; createdAt?: string }[];
  activeTurnBySession: Record<string, string | undefined>;
  finishedSessions: Record<string, boolean>;
  sessionById: Map<string, SessionSummary>;
  messagesBySession: Record<string, { role: string; createdAt: number }[] | undefined>;
  sessionStatus(sessionId: string): "working" | "action" | "finished" | "idle";
}

// A needs-you chat sorts ahead of everything else so it's first in view.
const RANK = { action: 0, working: 1, finished: 1 } as const;

export function liveTabsFor(cid: string, srv: LiveSource, shown: (string | null)[]): LiveTab[] {
  // A saved split renders as one entry under its anchor, so a partner's state counts toward it.
  const anchorOf = new Map<string, string>();
  for (const s of srv.sessionById.values()) {
    if (s.linkedSessionId && srv.sessionById.has(s.linkedSessionId)) anchorOf.set(s.linkedSessionId, s.sessionId);
  }

  const ids = new Set<string>([
    ...srv.pendingAsks.map((a) => a.sessionId),
    ...Object.keys(srv.activeTurnBySession).filter((id) => srv.activeTurnBySession[id]),
    ...Object.keys(srv.finishedSessions).filter((id) => srv.finishedSessions[id]),
  ]);

  const groups = new Map<string, LiveStatus>();
  for (const id of ids) {
    if (shown.includes(id)) continue;
    const status = srv.sessionStatus(id);
    if (status === "idle") continue;
    const anchor = anchorOf.get(id) ?? id;
    if (shown.includes(anchor)) continue;
    const prev = groups.get(anchor);
    if (!prev || RANK[status] < RANK[prev]) groups.set(anchor, status);
  }

  const rows = [...groups].map(([sessionId, status]) => {
    // From pending_asks, so a chat this client never listed still gets a tab.
    const ask = srv.pendingAsks.find((a) => a.sessionId === sessionId);
    const session = srv.sessionById.get(sessionId) ?? {
      sessionId,
      updatedAt: ask?.createdAt ?? new Date().toISOString(),
      messageCount: 1,
    };
    // The last user message is when this run started, so it doesn't move as the chat updates.
    const since = srv.messagesBySession[sessionId]?.findLast((m) => m.role === "user")?.createdAt ?? Date.parse(session.updatedAt);
    return { tab: { key: `${cid}:${sessionId}`, cid, sessionId, session, status } satisfies LiveTab, since };
  });
  return rows.sort((a, b) => RANK[a.tab.status] - RANK[b.tab.status] || a.since - b.since).map((r) => r.tab);
}

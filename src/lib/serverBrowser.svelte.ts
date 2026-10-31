// The server-side browser's half of the client (PARITY_CHECKLIST B11): `browser_state` lands in
// a store the panel reads, and `browser_frame` JPEGs go straight to whichever panel is watching.
import { send } from "./ipc";
import { app, type ConnectionId } from "./state.svelte";

export interface ServerBrowserTab {
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
}
export interface ServerBrowserState {
  available: boolean;
  error?: string;
  tabs: ServerBrowserTab[];
  controller: "" | "agent" | "human";
  youControl: boolean;
  canOperate: boolean;
}
export interface ServerBrowserFrame {
  seq: number;
  data: string;
  width: number;
  height: number;
}

export const serverBrowsers = $state<Record<ConnectionId, ServerBrowserState>>({});

const sinks = new Map<ConnectionId, (f: ServerBrowserFrame) => void>();

/** A mounted panel takes this connection's frames; returns its unwatch. */
export function watchServerFrames(connectionId: ConnectionId, sink: (f: ServerBrowserFrame) => void): () => void {
  sinks.set(connectionId, sink);
  return () => {
    if (sinks.get(connectionId) === sink) sinks.delete(connectionId);
  };
}

/** Handles `browser_frame` / `browser_state`; false for any other event. */
export function handleServerBrowserEvent(connectionId: ConnectionId, type: string, data: unknown): boolean {
  if (type === "browser_frame") {
    const sink = sinks.get(connectionId);
    if (sink) sink(data as ServerBrowserFrame);
    else void send(connectionId, { type: "browser_frame_ack", data: { seq: (data as ServerBrowserFrame).seq } }); // else a frame crossing view-off would stall the screencast
    return true;
  }
  if (type !== "browser_state") return false;
  const next = data as ServerBrowserState;
  const was = serverBrowsers[connectionId]?.controller;
  serverBrowsers[connectionId] = { ...next, tabs: next.tabs ?? [] };
  // The agent just took the browser: show the user, like browserAgent.svelte.ts does for the desktop's.
  const server = app.servers[connectionId];
  const sid = server?.currentSessionId;
  if (next.controller === "agent" && was !== "agent" && app.activeConnectionId === connectionId && server && sid) {
    if (!(server.chatSidebarOpenBySession[sid] && server.chatSidebarPanelBySession[sid] === "browser")) server.openSidebarPanel(sid, "browser");
  }
  return true;
}

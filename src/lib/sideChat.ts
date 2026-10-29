// Side questions: a /btw beside the chat, and replies in the thread on a message. Both go out as
// side_question and stream back as side_answer (state.svelte.ts keeps the runs).
import { app, type ConnectionId, type SideRun } from "./state.svelte";
import { sideQuestion } from "./ipc";

/** A /btw: answered in the card over the composer, kept nowhere. */
export function askBtw(cid: ConnectionId, sessionId: string, question: string) {
  const server = app.servers[cid];
  if (!server) return;
  closeBtw(server, sessionId);
  const requestId = crypto.randomUUID();
  server.sideRuns[requestId] = { sessionId, anchor: "", question, text: "", done: false };
  server.btwBySession[sessionId] = requestId;
  sideQuestion(cid, sessionId, requestId, question);
}

export function closeBtw(server: { sideRuns: Record<string, SideRun>; btwBySession: Record<string, string> }, sessionId: string) {
  const id = server.btwBySession[sessionId];
  if (id) delete server.sideRuns[id];
  delete server.btwBySession[sessionId];
}

/** A reply in the side thread on `messageId`; the exchange lands on the message once answered. */
export function askThread(cid: ConnectionId, sessionId: string, messageId: string, question: string) {
  const server = app.servers[cid];
  if (!server) return;
  const requestId = crypto.randomUUID();
  server.sideRuns[requestId] = { sessionId, anchor: messageId, question, text: "", done: false };
  sideQuestion(cid, sessionId, requestId, question, messageId);
}

/** The reply in flight (or failed) on this message's thread. */
export function threadRun(server: { sideRuns: Record<string, SideRun> } | null | undefined, messageId: string): SideRun | undefined {
  return Object.values(server?.sideRuns ?? {}).find((r) => r.anchor === messageId);
}

// Which file the active session's editor is showing, and which pane the user last focused.
// Kept tiny and outside state.svelte so Discord presence and Settings can read it without
// threading props through the sidebar; the explorer/editor report into it, nothing reads back.
import { app, CHAT_PROJECT } from "./state.svelte";
import { basename } from "./format";

export const editorPresence = $state({
  sessionId: "",
  projectPath: "",
  /** Display names, already resolved for the card. */
  project: "",
  path: "",
  file: "",
  language: "",
  /** "editor" once the editor gains focus, "chat" once the composer or feed is touched. */
  surface: "chat" as "chat" | "editor",
});

const active = (sessionId: string) => !!sessionId && sessionId === app.active?.currentSessionId;

/** Called by every mounted explorer; only the active session's editor counts. */
export function reportEditorFile(sessionId: string, projectPath: string, path: string | null) {
  if (!active(sessionId)) return;
  const next = path ?? "";
  editorPresence.sessionId = sessionId;
  editorPresence.projectPath = projectPath;
  editorPresence.project = !projectPath || projectPath === CHAT_PROJECT ? "Chat" : basename(projectPath);
  if (editorPresence.path !== next) {
    editorPresence.path = next;
    editorPresence.file = next ? (next.split("/").pop() ?? next) : "";
    editorPresence.language = "";
  }
}

/** FileEditor knows CodeMirror's resolved language, which is more accurate than the extension. */
export function reportEditorLanguage(sessionId: string, path: string, language: string) {
  if (!active(sessionId) || editorPresence.path !== path) return;
  editorPresence.language = language;
}

export function setEditorFocus(sessionId: string, focused: boolean) {
  if (!active(sessionId)) return;
  if (focused) editorPresence.surface = "editor";
}

export function setChatFocus(sessionId: string) {
  if (!active(sessionId)) return;
  editorPresence.surface = "chat";
}

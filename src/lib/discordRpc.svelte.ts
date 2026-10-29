// Desktop-only Discord Rich Presence bridge: turns the app's current chat into a Discord activity
// and keeps the main-process IPC client configured. The settings and template rendering themselves
// are pure (discordRpcSettings.ts).
import { app, CHAT_PROJECT, type ServerState } from "./state.svelte";
import { basename, sessionTitle } from "./format";
import {
  buildDiscordActivity,
  buildDiscordEditorActivity,
  resolveDiscordClientId,
  type DiscordActivity,
  type DiscordEditorContext,
  type DiscordPresenceContext,
  type DiscordRpcSettings,
} from "./discordRpcSettings";
import { editorPresence } from "./editorPresence.svelte";
import { discordConfigure, discordPresence, discordStatus, isDesktop, type DiscordRpcStatus } from "./platform";

export const rpcStatus = $state<DiscordRpcStatus>({ enabled: false, connected: false, clientId: "", error: null });

export function setDiscordRpcStatus(status: DiscordRpcStatus) {
  Object.assign(rpcStatus, status);
}

const STATUS_LABELS = {
  working: "Working",
  action: "Waiting for you",
  finished: "Ready",
  /** An open chat between turns: the user is (or may be) typing. */
  idle: "Composing",
} as const;

function activeContext(server: ServerState | null): DiscordPresenceContext {
  const sessionId = server?.currentSessionId;
  const summary = sessionId ? server?.sessionById.get(sessionId) : undefined;
  const projectPath = server?.currentProjectPath ?? summary?.projectPath ?? "";
  const project = !projectPath
    ? ""
    : projectPath === CHAT_PROJECT
      ? "Chat"
      : basename(projectPath);
  // A chat with no messages yet counts as "no chat open" so the idle card and the
  // "No chat open" state work, even with a project selected.
  const blank = sessionId && server ? !server.messagesBySession[sessionId]?.length : true;
  return {
    project,
    regularChat: !projectPath || projectPath === CHAT_PROJECT,
    chat: summary && !blank ? sessionTitle(summary) : "",
    status: sessionId && server ? STATUS_LABELS[server.sessionStatus(sessionId)] : STATUS_LABELS.idle,
    server: server?.label ?? "",
  };
}

function contextKey(server: ServerState | null, context: DiscordPresenceContext): string {
  return `${server?.connectionId ?? ""}|${server?.currentSessionId ?? ""}|${context.project}|${context.chat}`;
}

let startedKey = "";
let startedAt = Date.now();

function editorContext(allowSample = false): DiscordEditorContext | null {
  const server = app.active;
  const live = !!server && editorPresence.sessionId === server.currentSessionId && !!editorPresence.path;
  if (live) {
    return {
      file: editorPresence.file,
      path: editorPresence.path,
      project: editorPresence.project,
      language: editorPresence.language,
      server: server?.label ?? "",
    };
  }
  if (!allowSample || !server) return null;
  const projectPath = server.currentProjectPath ?? "";
  return {
    file: "App.svelte",
    path: "src/App.svelte",
    project: !projectPath || projectPath === CHAT_PROJECT ? "yoake" : basename(projectPath),
    language: "Svelte",
    server: server.label ?? "",
  };
}

let editorTimerKey = "";
let editorTimerAt = Date.now();

/** The editor timer restarts per file or per workspace, depending on the setting. */
function editorStartedAt(settings: DiscordRpcSettings, context: DiscordEditorContext): number {
  const key =
    settings.editorTimerScope === "workspace"
      ? `${editorPresence.sessionId}|${context.project}`
      : `${editorPresence.sessionId}|${context.path}`;
  if (key !== editorTimerKey) {
    editorTimerKey = key;
    editorTimerAt = Date.now();
  }
  return editorTimerAt;
}

/** Auto follows the last focused surface; explicit modes ignore focus. */
function wantsEditor(settings: DiscordRpcSettings): boolean {
  if (settings.mode === "chat") return false;
  if (settings.mode === "editor") return true;
  return editorPresence.surface === "editor";
}

/** The activity for the current window. Elapsed time restarts when the chat or file changes. */
export function currentDiscordActivity(settings: DiscordRpcSettings): DiscordActivity | null {
  const server = app.active;
  const editor = editorContext();
  if (editor && wantsEditor(settings)) {
    return buildDiscordEditorActivity(settings, editor, editorStartedAt(settings, editor));
  }
  const context = activeContext(server);
  const key = contextKey(server, context);
  if (key !== startedKey) {
    startedKey = key;
    startedAt = Date.now();
  }
  return buildDiscordActivity(settings, context, startedAt);
}

/** A preview for Settings > Integrations; does not affect the live elapsed-time keys. */
export function previewDiscordActivity(settings: DiscordRpcSettings, kind: "chat" | "editor" = "chat"): DiscordActivity | null {
  let activity: DiscordActivity | null;
  if (kind === "editor") {
    const context = editorContext(true);
    if (!context) return null;
    const live = editorPresence.sessionId === app.active?.currentSessionId && !!editorPresence.path;
    activity = buildDiscordEditorActivity(settings, context, live ? editorStartedAt(settings, context) : Date.now() - 125_000);
  } else {
    activity = buildDiscordActivity(settings, activeContext(app.active), startedAt || Date.now());
  }
  // Discord always prints a timer on the card: with no timestamps it counts up from the card's
  // last update instead. Mimic that here so the preview matches what Discord will show.
  if (activity && !activity.timestamps) activity.timestamps = { start: Date.now() };
  return activity;
}

let lastConfig = "";
let lastPresence = "";

/** Called from a single $effect in the page: reacts to settings and to the open chat/project,
 * reconfigures the main-process client only when the connection settings change, and coalesces
 * identical presence updates (the main process also rate-limits Discord itself). */
export function syncDiscordRpc() {
  if (!isDesktop) return;
  const settings = app.settings.discordRpc;
  const config = { ...settings, clientId: resolveDiscordClientId(settings) };
  const signature = JSON.stringify(config);
  if (signature !== lastConfig) {
    lastConfig = signature;
    void discordConfigure(config).then(setDiscordRpcStatus, () => (lastConfig = "")); // retried on the next sync
  }
  const activity = settings.enabled ? currentDiscordActivity(settings) : null;
  const presence = JSON.stringify(activity);
  if (presence !== lastPresence) {
    lastPresence = presence;
    void discordPresence(activity).catch(() => (lastPresence = ""));
  }
}

/** Synthesizes the main process's first status when Settings > Integrations opens. */
export function refreshDiscordRpcStatus() {
  if (!isDesktop) return;
  void discordStatus().then(setDiscordRpcStatus, () => {});
}

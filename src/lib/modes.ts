import type { ChatMode, ModeSpec, ProviderInfo } from "./types";
import type { ServerState } from "./state.svelte";
import { setMode } from "./ipc";
import { isCli } from "./modelVendor";

/** The four rungs, by how much the agent may do without asking, and Plan, the phase in front of them. */
export interface ModeMeta {
  id: ChatMode;
  label: string;
  icon: string;
  tint?: string;
}

export const LADDER: ModeMeta[] = [
  { id: "read_only", label: "Read", icon: "eye" },
  { id: "read_write", label: "Ask", icon: "question-mark" },
  { id: "accept_edits", label: "Edit", icon: "pencil" },
  {
    id: "autonomous",
    label: "Run",
    icon: "player-track-next",
    tint: "var(--warning)",
  },
];
export const PLAN: ModeMeta = {
  id: "plan",
  label: "Plan",
  icon: "clipboard-list",
};
export const MODES: ModeMeta[] = [...LADDER, PLAN];
export const MODE_BY_ID = Object.fromEntries(
  MODES.map((m) => [m.id, m]),
) as Record<ChatMode, ModeMeta>;

/** What a mode does, in a few words. Run says whether anything confines it, when the provider says. */
export function modeHint(id: ChatMode, spec?: ModeSpec): string {
  switch (id) {
    case "read_only":
      return "Looks, changes nothing.";
    case "read_write":
      return "Asks before any change.";
    case "accept_edits":
      return "Edits freely, asks to run.";
    case "autonomous":
      return spec?.sandbox ? "Edits and runs freely, sandboxed." : spec ? "Edits and runs freely, unconfined." : "Edits and runs freely.";
    case "plan":
      return "Plans first, you approve.";
  }
}

/** The modes a chat's model offers and what each does there (SPEC.md §4c permissionModes). `specs`
 * is absent for a server or model list that doesn't say, which is the four pre-Edit modes. */
export function sessionModes(
  server: ServerState | null | undefined,
  sessionId: string,
) {
  const provider: ProviderInfo | undefined = server?.providers.find(
    (p) => p.name === server?.providerBySession[sessionId],
  );
  const models = provider
    ? (server?.modelsByProvider[provider.name] ?? [])
    : [];
  const model =
    models.find((m) => m.id === server?.modelBySession[sessionId]) ?? models[0];
  const list = model?.capabilities?.permissionModes;
  const specs = list
    ? (Object.fromEntries(list.map((s) => [s.mode, s])) as Partial<
        Record<ChatMode, ModeSpec>
      >)
    : undefined;
  const available = MODES.filter((m) =>
    specs ? !!specs[m.id] : m.id !== "accept_edits",
  ).map((m) => m.id);
  return { provider, cli: !!provider && isCli(provider), specs, available };
}

// One turn of Run and back is a habit of the user's, not of a chat.
const RUN_ONCE_KEY = "yoake.runOnce";
export function getRunOnce(): boolean {
  try {
    return localStorage.getItem(RUN_ONCE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setRunOnce(on: boolean) {
  try {
    localStorage.setItem(RUN_ONCE_KEY, on ? "1" : "0");
  } catch {
    /* a private window: the choice just doesn't outlive this one */
  }
}

/** Puts a chat in `id`. Optimistic; mode_set (state.svelte.ts) confirms it once the round trip lands. */
export function chooseMode(
  server: ServerState,
  cid: string,
  sessionId: string,
  id: ChatMode,
) {
  const cur = server.modeBySession[sessionId] ?? "read_write";
  if (id === cur) return;
  if (id === "plan") server.tierBeforePlan[sessionId] = cur;
  const back =
    cur === "plan" ? (server.tierBeforePlan[sessionId] ?? "read_write") : cur;
  const once = id === "autonomous" && getRunOnce();
  if (once) server.runOnce[sessionId] = back;
  else delete server.runOnce[sessionId];
  server.modeBySession[sessionId] = id;
  if (!once) server.setLastUsedMode(id);
  setMode(cid, sessionId, id);
}

/** The tier to fall back on when the chat's model offers none of `wanted`'s neighbours: Ask always exists. */
export function nearestAvailable(
  id: ChatMode,
  available: ChatMode[],
): ChatMode {
  return available.includes(id) ? id : "read_write";
}

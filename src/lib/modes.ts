import type { ChatMode, ModeSpec, ProviderInfo } from "./types";
import { app, type ServerState } from "./state.svelte";
import { describeProvider } from "./forwarding";
import { setMode } from "./ipc";

/** The rungs, by how much the agent may do without asking, and Plan, the phase in front of them.
 * Auto is only there for an agent whose own reviewer can do the deciding. */
export interface ModeMeta {
  id: ChatMode;
  label: string;
  icon: string;
  tint?: string;
}

export const LADDER: ModeMeta[] = [
  { id: "read_only", label: "Read", icon: "eye" },
  { id: "read_write", label: "Ask", icon: "message-question" },
  { id: "accept_edits", label: "Edit", icon: "pencil" },
  { id: "auto", label: "Auto", icon: "shield-check" },
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
    case "auto":
      return spec?.sandbox ? "Its own reviewer decides what to ask, in a sandbox." : spec ? "Its reviewer decides what to ask; with no sandbox, it is the only check." : "Its own reviewer decides what to ask.";
    case "autonomous":
      return spec?.sandbox ? "Edits and runs freely, sandboxed." : spec ? "Edits and runs freely, unconfined." : "Edits and runs freely.";
    case "plan":
      return "Plans first, you approve.";
  }
}

/** The modes a chat's model offers and what each does there (SPEC.md §4c permissionModes). `specs`
 * is absent for a server or model list that doesn't say, which is the four pre-Edit modes (no Edit, no Auto). */
export function sessionModes(
  server: ServerState | null | undefined,
  sessionId: string,
) {
  const { info: provider, models, runsOwnTools, serverName } = describeProvider(app, server, server?.providerBySession[sessionId]);
  const model =
    models.find((m) => m.id === server?.modelBySession[sessionId]) ?? models[0];
  // A borrowed model's own list says what the lender's agent can do, which isn't what runs here: the
  // modes are those of this server's API models (none known: the four basic ones).
  const borrowed = serverName !== undefined;
  const list = borrowed
    ? server?.providers.filter((p) => p.kind === "api_key").flatMap((p) => server.modelsByProvider[p.name] ?? []).find((m) => m.capabilities?.permissionModes)?.capabilities?.permissionModes
    : model?.capabilities?.permissionModes;
  const specs = list
    ? (Object.fromEntries(list.map((s) => [s.mode, s])) as Partial<
        Record<ChatMode, ModeSpec>
      >)
    : undefined;
  const available = MODES.filter((m) =>
    specs ? !!specs[m.id] : m.id !== "accept_edits" && m.id !== "auto",
  ).map((m) => m.id);
  return { provider, cli: runsOwnTools, specs, available };
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
  server.modeBySession[sessionId] = id;
  server.setLastUsedMode(id);
  setMode(cid, sessionId, id);
}

/** The tier to fall back on when the chat's model doesn't offer `id`: Ask where it exists, else the
 * first rung there is (an agent that only runs with full access offers Run alone). */
export function nearestAvailable(
  id: ChatMode,
  available: ChatMode[],
): ChatMode {
  if (available.includes(id)) return id;
  if (available.includes("read_write")) return "read_write";
  return available.find((m) => m !== "plan") ?? "read_write";
}

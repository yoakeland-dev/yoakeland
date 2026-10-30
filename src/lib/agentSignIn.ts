// Signing an agent account in happens in a shell on the server, with the account's folder
// variable set so the login lands in that account's folder.
import { app, type ServerState } from "./state.svelte";
import { terminalInput } from "./ipc";

const LOGIN: Record<string, { env: string; cmd: string }> = {
  cli_claude: { env: "CLAUDE_CONFIG_DIR", cmd: "claude auth login" },
  cli_codex: { env: "CODEX_HOME", cmd: "codex login" },
};

/** The line to run for this account, or "" for agents with no per-account login. */
export function signInCommand(kind: string, configDir?: string): string {
  const l = LOGIN[kind];
  if (!l) return "";
  return configDir?.trim() ? `${l.env}=${configDir.trim()} ${l.cmd}` : l.cmd;
}

/** Closes Settings, opens a shell in the current chat's drawer and types the command into it.
 * False when there is no started chat to hang a terminal on; the caller shows the command instead. */
export function openSignInTerminal(server: ServerState, command: string): boolean {
  const sid = server.currentSessionId;
  if (!sid || !command || !(server.messagesBySession[sid] ?? []).length) return false;
  app.showSettings = false;
  server.newTerminal(sid);
  const id = server.activeTerminalBySession[sid];
  if (!id) return true;
  let tries = 0;
  const timer = setInterval(() => {
    if (server.terminalById[id]?.status === "running") {
      clearInterval(timer);
      terminalInput(server.connectionId, sid, id, new TextEncoder().encode(command + "\r"));
    } else if (++tries > 40) clearInterval(timer);
  }, 150);
  return true;
}

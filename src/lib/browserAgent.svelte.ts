// The desktop half of the agent's browser tool (§3.2 browser_request): the server relays each
// action here, and this client runs it in that chat's browser panel (BrowserPanel.svelte), the
// same one the user watches, then answers with browser_response.
import { app, type ConnectionId } from "./state.svelte";

/** One chat's browser panel, as the agent drives it. */
export interface BrowserController {
  run(action: string, args: Record<string, unknown>): Promise<string>;
}

const controllers = new Map<string, BrowserController>();
const waiting = new Map<string, (() => void)[]>();

/** Chats whose browser pane must stay mounted because the agent is using it, even while another
 * chat is on screen (ChatSidebar.svelte mounts these). */
export const agentBrowsers = $state<Record<string, true>>({});

/** Called by a mounted BrowserPanel; returns its unregister. */
export function registerBrowser(sessionId: string, c: BrowserController): () => void {
  controllers.set(sessionId, c);
  for (const wake of waiting.get(sessionId) ?? []) wake();
  waiting.delete(sessionId);
  return () => {
    if (controllers.get(sessionId) === c) controllers.delete(sessionId);
  };
}

function controllerFor(sessionId: string, timeoutMs: number): Promise<BrowserController | undefined> {
  const c = controllers.get(sessionId);
  if (c) return Promise.resolve(c);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(controllers.get(sessionId)), timeoutMs);
    const list = waiting.get(sessionId) ?? [];
    list.push(() => {
      clearTimeout(timer);
      resolve(controllers.get(sessionId));
    });
    waiting.set(sessionId, list);
  });
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** The agent's URL, checked (web pages only) and, on a remote server, pointed at that server:
 * "localhost:3000" there is a dev server on the server's machine, not this one.
 * ponytail: assumes the port is reachable at the server's address; tunnel it if it's firewalled. */
export function resolveAgentUrl(raw: string, serverHost: string | null): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:/i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("the browser only opens http and https pages");
  if (serverHost && LOCAL_HOSTS.has(url.hostname)) url.hostname = serverHost;
  return url.toString();
}

interface BrowserRequest {
  requestId: string;
  sessionId: string;
  action: string;
  args: Record<string, unknown>;
}

export async function handleBrowserRequest(connectionId: ConnectionId, req: BrowserRequest, send: (data: object) => void) {
  const server = app.servers[connectionId];
  const reply = (r: { output?: string; error?: string }) => send({ requestId: req.requestId, ...r });
  if (!server) return reply({ error: "the app lost this connection" });
  try {
    const args = { ...(req.args ?? {}) };
    if (req.action === "navigate") {
      const host = server.connectParams.mode === "remote" ? server.connectParams.host : null;
      args.url = resolveAgentUrl(String(args.url ?? ""), host);
    }
    // Show the user what the agent is doing, if they're looking at this chat.
    const onScreen = app.activeConnectionId === connectionId && server.currentSessionId === req.sessionId;
    if (onScreen && (req.action === "navigate" || !controllers.has(req.sessionId))) {
      server.openSidebarPanel(req.sessionId, "browser");
    }
    agentBrowsers[req.sessionId] = true;
    const c = await controllerFor(req.sessionId, 8000);
    if (!c) {
      return reply({
        error: "the browser panel couldn't open for this chat" + (app.activeConnectionId === connectionId ? "" : " (its server isn't the one open in the app)"),
      });
    }
    reply({ output: await c.run(req.action, args) });
  } catch (e) {
    reply({ error: e instanceof Error ? e.message : String(e) });
  }
}

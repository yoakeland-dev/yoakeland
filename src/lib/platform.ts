// Components reach Electron (window.yoake, electron/preload.cjs) only through
// this file.

interface YoakeBridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, cb: (payload: unknown) => void): () => void;
  pickFiles(opts: { title?: string; multiple?: boolean }): Promise<string[]>;
  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  getPathForFile(file: File): string;
  platform: string;
  chrome: { overlay?: boolean; trafficLights?: { w: number; h: number } };
  setWindowChrome(on: boolean): Promise<void>;
  placeTrafficLights(x: number, y: number): Promise<void>;
  styleOverlay(symbolColor: string, height: number): Promise<void>;
}

const bridge = typeof window !== "undefined" ? (window as { yoake?: YoakeBridge }).yoake : undefined;

export const isDesktop = !!bridge;

function shell(): YoakeBridge {
  if (!bridge) throw new Error("not running in the desktop shell");
  return bridge;
}

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (bridge ? bridge.invoke(cmd, args) : webInvoke(cmd, args ?? {})) as Promise<T>;
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  const fn = cb as (payload: unknown) => void;
  if (bridge) return bridge.listen(event, fn);
  const set = webListeners.get(event) ?? webListeners.set(event, new Set()).get(event)!;
  set.add(fn);
  return () => set.delete(fn);
}

// Browser mode: remote servers only, over the WebSocket yoakeland serves at /ws.

const webListeners = new Map<string, Set<(payload: unknown) => void>>();
const webEmit = (event: string, payload: unknown) => webListeners.get(event)?.forEach((cb) => cb(payload));
const webSockets = new Map<string, WebSocket>();
// ponytail: saved tokens live in localStorage, where any script on the page
// can read them. sessionStorage (pair again in each tab) is stricter if needed.
const tokenKey = (serverId: unknown) => `yoake.token.${serverId}`;

async function webInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "connect_tcp": {
      const { host, port, token, caPem: _ca, ...identity } = args;
      const h = String(host).includes(":") ? `[${host}]` : host;
      const ws = new WebSocket(`wss://${h}:${port}/ws`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () =>
          reject(
            `couldn't open a secure connection to ${host}:${port}. Is remote access on, and does this browser trust the server's certificate?`,
          );
      });
      const connectionId = crypto.randomUUID();
      webSockets.set(connectionId, ws);
      ws.onmessage = (e) => {
        for (const line of String(e.data).split("\n")) {
          if (!line.trim()) continue;
          try {
            webEmit("yoake-event", { connectionId, envelope: JSON.parse(line) });
          } catch (err) {
            webEmit("yoake-log", { connectionId, message: `bad frame: ${err}: ${line}` });
          }
        }
      };
      ws.onclose = (e) => {
        // `disconnect` deletes the entry first, so only unexpected closes report.
        if (webSockets.delete(connectionId)) {
          webEmit("yoake-disconnected", { connectionId, reason: e.reason || "connection closed" });
        }
      };
      ws.send(JSON.stringify({ type: "auth", data: { token, ...identity } }) + "\n");
      return connectionId;
    }
    case "send_envelope": {
      const ws = webSockets.get(String(args.connectionId));
      if (!ws) throw "not connected";
      ws.send(JSON.stringify(args.envelope) + "\n");
      return;
    }
    case "disconnect": {
      const ws = webSockets.get(String(args.connectionId));
      webSockets.delete(String(args.connectionId));
      ws?.close();
      return;
    }
    case "load_credential":
      return localStorage.getItem(tokenKey(args.key));
    case "store_credential":
      if (args.value == null) localStorage.removeItem(tokenKey(args.key));
      else localStorage.setItem(tokenKey(args.key), String(args.value));
      return;
    case "probe_tcp":
    case "probe_unix":
      return false;
    default:
      throw `${cmd} isn't available in the browser`;
  }
}

export const pickFiles = (opts: { title?: string; multiple?: boolean } = {}): Promise<string[]> =>
  shell().pickFiles(opts);

export const openUrl = (url: string): Promise<void> => shell().openUrl(url);
export const revealItemInDir = (path: string): Promise<unknown> => shell().revealItemInDir(path);
export const readClipboard = (): Promise<string> => shell().readClipboard();
export const writeClipboard = (text: string): Promise<void> => shell().writeClipboard(text);

export const windowChromeKind: "traffic-lights" | "overlay" | "custom" | null = !bridge
  ? null
  : bridge.platform === "darwin"
    ? "traffic-lights"
    : bridge.platform === "win32"
      ? "overlay"
      : "custom";

export const trafficLightsWidth = bridge?.chrome.trafficLights?.w ?? 0;

export const windowControls =
  bridge && windowChromeKind === "custom"
    ? { minimize: bridge.minimize, toggleMaximize: bridge.toggleMaximize, close: bridge.close }
    : null;

export const setWindowChrome = (on: boolean): Promise<void> => bridge?.setWindowChrome(on) ?? Promise.resolve();

// Measures the DOM, so call it after layout or theme changes.
export function syncNativeChrome() {
  if (!bridge) return;
  const lights = bridge.chrome.trafficLights;
  const slot = document.querySelector(".traffic-lights")?.getBoundingClientRect();
  if (lights && slot?.width) {
    void bridge.placeTrafficLights(slot.left + (slot.width - lights.w) / 2, slot.top + (slot.height - lights.h) / 2);
  }
  const strip = document.querySelector(".titlebar-drag")?.getBoundingClientRect();
  if (bridge.chrome.overlay && strip?.height) {
    // body's computed colour is --text as rgb(), a format Electron can parse.
    void bridge.styleOverlay(getComputedStyle(document.body).color, strip.height);
  }
}

export type FileDropEvent =
  | { type: "enter" | "over"; x: number; y: number }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

export function onFileDrop(cb: (e: FileDropEvent) => void): () => void {
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  // dragenter/dragleave fire for every child crossed; count to detect leaving the window.
  let depth = 0;
  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    if (depth++ === 0) cb({ type: "enter", x: e.clientX, y: e.clientY });
  };
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    cb({ type: "over", x: e.clientX, y: e.clientY });
  };
  const leave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) (depth = 0), cb({ type: "leave" });
  };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    const paths = [...(e.dataTransfer?.files ?? [])].map((f) => shell().getPathForFile(f)).filter(Boolean);
    cb({ type: "drop", x: e.clientX, y: e.clientY, paths });
  };
  const events = { dragenter: enter, dragover: over, dragleave: leave, drop } as const;
  for (const [name, fn] of Object.entries(events)) document.addEventListener(name, fn as EventListener);
  return () => {
    for (const [name, fn] of Object.entries(events)) document.removeEventListener(name, fn as EventListener);
  };
}

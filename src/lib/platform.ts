// The one place the app talks to its desktop shell. Nothing else imports
// @tauri-apps — porting to another shell (Electron) means rewriting this
// file, not hunting through components.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl as tauriOpenUrl, revealItemInDir as tauriReveal } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

// Whether we're running inside the desktop shell rather than a plain browser
// tab. Window decorations are off in tauri.conf.json, so the app draws its
// own minimize/maximize/close buttons — but only here. On the web the OS
// chrome isn't ours to draw, and the header shouldn't reserve room for
// buttons that will never appear.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Calls a backend command (src-tauri/src/lib.rs's invoke_handler list). */
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/** Subscribes to a backend event; resolves to an unsubscribe function. */
export function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  return tauriListen<T>(event, (e) => cb(e.payload));
}

/** Native file picker; always an array of paths, empty when cancelled. */
export async function pickFiles(opts: { title?: string; multiple?: boolean } = {}): Promise<string[]> {
  const picked = await open({ multiple: opts.multiple ?? false, directory: false, title: opts.title });
  return Array.isArray(picked) ? picked : picked ? [picked] : [];
}

export const openUrl = (url: string): Promise<void> => tauriOpenUrl(url);
export const revealItemInDir = (path: string): Promise<unknown> => tauriReveal(path);

// The shell's clipboard rather than navigator.clipboard: WebKitGTK refuses
// clipboard reads from a context-menu click (not enough user-gesture), so
// the terminal's Paste resolved to nothing.
export const readClipboard = (): Promise<string> => readText();
export const writeClipboard = (text: string): Promise<void> => writeText(text);

/** Our own titlebar buttons; null outside the desktop shell. */
export const windowControls = isDesktop
  ? (() => {
      const win = getCurrentWindow();
      return { minimize: () => win.minimize(), toggleMaximize: () => win.toggleMaximize(), close: () => win.close() };
    })()
  : null;

export type FileDropEvent =
  | { type: "enter" | "over"; x: number; y: number }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

/** Files dragged in from the OS. The shell intercepts these, so the page
 * never sees HTML5 drop events for them; x/y are CSS pixels. Returns an
 * unsubscribe function. */
export function onFileDrop(cb: (e: FileDropEvent) => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void getCurrentWebview()
    .onDragDropEvent(({ payload: p }) => {
      if (p.type === "leave") return cb({ type: "leave" });
      const x = p.position.x / devicePixelRatio;
      const y = p.position.y / devicePixelRatio;
      cb(p.type === "drop" ? { type: "drop", x, y, paths: p.paths } : { type: p.type, x, y });
    })
    .then((u) => (disposed ? u() : (unlisten = u)));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

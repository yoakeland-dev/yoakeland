// OS-level alerts for server notifications. The renderer forwards the ones worth a desktop alert
// (see AppState.osAlert); this decides, with the window's real focus state, whether one is raised.
// Kept free of `electron` imports so node --test can drive it with a fake Notification.

const clip = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n - 1) + "…" : String(s ?? ""));

/**
 * @param {{
 *   Notification: { isSupported(): boolean, new (opts: object): any },
 *   isFocused: () => boolean,
 *   onOpen: (target: { connectionId: string, sessionId: string, projectPath: string }) => void,
 *   setBadge?: (count: number) => void,
 * }} deps
 */
export function createOsAlerts({ Notification, isFocused, onOpen, setBadge }) {
  /** One live alert per chat: a newer one for the same chat replaces it instead of stacking. */
  const live = new Map();

  return {
    /** Returns "shown", or why it wasn't. */
    show(req) {
      if (!Notification.isSupported()) return "unsupported";
      if (isFocused()) return "focused"; // you're looking at the app; the in-app toast/bell has it
      if (req.priority === "quiet") return "quiet";
      const tag = req.sessionId ? `${req.connectionId}|${req.sessionId}` : `${req.connectionId}|${req.id}`;
      live.get(tag)?.close();
      const urgent = req.priority !== "normal";
      const n = new Notification({ title: clip(req.title, 120), body: clip(req.body, 240), silent: !urgent });
      n.on("click", () => {
        live.delete(tag);
        onOpen({ connectionId: req.connectionId, sessionId: req.sessionId ?? "", projectPath: req.projectPath ?? "" });
      });
      n.on("close", () => {
        if (live.get(tag) === n) live.delete(tag);
      });
      live.set(tag, n);
      n.show();
      return "shown";
    },
    /** Coming back to the window makes every pending alert moot. */
    closeAll() {
      for (const n of [...live.values()]) n.close();
      live.clear();
    },
    badge(count) {
      setBadge?.(Math.max(0, Math.floor(Number(count) || 0)));
    },
  };
}

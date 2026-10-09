// The client half of the notification policy: tells each server which chats this device shows
// (so it can skip pings for a chat you're reading and keep your other devices quiet), keeps the
// desktop badge at the unread count, and opens the chat behind a clicked OS alert.
import { app } from "./state.svelte";
import { invoke, isDesktop, listen } from "./platform";
import { openNotificationTarget, setPresence } from "./ipc";
import type { ConnectionId } from "./state.svelte";

/** The server counts a heartbeat for five minutes; this keeps one comfortably inside that. */
const HEARTBEAT_MS = 60_000;

export function startNotifications(): () => void {
  let focused = $state(typeof document !== "undefined" && document.hasFocus());
  let visible = $state(typeof document !== "undefined" && document.visibilityState === "visible");
  const sync = () => {
    focused = document.hasFocus();
    visible = document.visibilityState === "visible";
  };

  const beat = () => {
    for (const s of Object.values(app.servers)) {
      if (s.connectionStatus !== "connected") continue;
      // Only the server this window is showing has chats on screen; the rest just learn you're here.
      const mine = s.connectionId === app.activeConnectionId;
      const shown = mine ? [s.currentSessionId, s.sidebarSessionId].filter((id): id is string => !!id) : [];
      setPresence(s.connectionId, shown, focused, visible);
    }
  };

  const stopEffects = $effect.root(() => {
    // Re-sent whenever the window changes hands or another chat comes up front.
    $effect(() => {
      focused;
      visible;
      app.activeConnectionId;
      for (const s of Object.values(app.servers)) {
        s.connectionStatus;
        s.currentSessionId;
        s.sidebarSessionId;
      }
      beat();
    });
    $effect(() => {
      if (!isDesktop) return;
      let unread = 0;
      for (const s of Object.values(app.servers)) unread += s.unreadNotifications + s.pendingAsks.length;
      void invoke("shell:badge", { count: unread }).catch(() => {});
    });
  });

  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
  const timer = setInterval(beat, HEARTBEAT_MS);
  let stopClicks = () => {};
  void listen<{ connectionId: ConnectionId; sessionId: string; projectPath: string }>("yoake-notification-open", (p) => {
    if (!app.servers[p.connectionId]) return;
    app.activeConnectionId = p.connectionId;
    openNotificationTarget(p.connectionId, p);
  }).then((off) => (stopClicks = off));

  return () => {
    stopEffects();
    clearInterval(timer);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    document.removeEventListener("visibilitychange", sync);
    stopClicks();
  };
}

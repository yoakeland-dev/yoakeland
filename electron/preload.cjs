// Never expose ipcRenderer itself.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function call(cmd, args) {
  const r = await ipcRenderer.invoke(cmd, args);
  if ("error" in r) throw r.error;
  return r.ok;
}

const chromeArg = process.argv.find((a) => a.startsWith("--yoake-chrome="));

// The commands the page calls through invoke() (src/lib/ipc.ts and friends). Anything else stays
// unreachable from the page, the shell: channels included; main.js checks each call's arguments.
const COMMANDS = new Set([
  "load_themes", "themes_reveal_path", "default_socket_path", "probe_unix", "connect_unix", "connect_tcp",
  "pair_tcp", "disconnect", "send_envelope", "spawn_detached_unix_server", "server_latest_release",
  "server_install", "read_text_file", "read_file_bytes", "load_credential", "store_credential",
  "oauth_listen", "oauth_wait", "oauth_wait_params", "oauth_cancel", "shell:notify", "shell:badge",
]);

const EVENTS = ["yoake-event", "yoake-log", "yoake-disconnected", "yoake-notification-open", "yoake-themes-changed", "yoake-close-requested"];

contextBridge.exposeInMainWorld("yoake", {
  invoke: (cmd, args) => (COMMANDS.has(cmd) ? call(cmd, args) : Promise.reject("unknown command")),
  listen(event, cb) {
    if (!EVENTS.includes(event)) throw new Error(`unknown event ${event}`);
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(event, h);
    return () => ipcRenderer.off(event, h);
  },
  pickFiles: (opts) => call("shell:pick_files", opts),
  openUrl: (url) => call("shell:open_url", { url }),
  browserGuard: (id, hosts) => call("shell:browser_guard", { id, hosts }),
  browserUnguard: (id) => call("shell:browser_unguard", { id }),
  pairInfo: () => call("shell:pair_info"),
  revealItemInDir: (path) => call("shell:reveal", { path }),
  readClipboard: () => call("shell:read_clipboard"),
  writeClipboard: (text) => call("shell:write_clipboard", { text }),
  minimize: () => call("shell:window", { action: "minimize" }),
  toggleMaximize: () => call("shell:window", { action: "toggleMaximize" }),
  close: () => call("shell:window", { action: "close" }),
  // A dropped file's path is only ever learned this way, so it's the one grant a drop makes.
  getPathForFile(file) {
    const p = webUtils.getPathForFile(file);
    if (p) void call("shell:grant_path", { path: p }).catch(() => {});
    return p;
  },
  platform: process.platform,
  chrome: chromeArg ? JSON.parse(chromeArg.slice("--yoake-chrome=".length)) : {},
  setCloseHook: (on) => call("shell:set_close_hook", { on }),
  closeAck: () => call("shell:close_ack"),
  quit: () => call("shell:quit"),
  setWindowChrome: (on) => call("shell:set_window_chrome", { on }),
  placeTrafficLights: (x, y) => call("shell:place_traffic_lights", { x, y }),
  styleOverlay: (symbolColor, height) => call("shell:style_overlay", { symbolColor, height }),
});

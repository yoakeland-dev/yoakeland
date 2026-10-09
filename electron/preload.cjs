// Never expose ipcRenderer itself.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function call(cmd, args) {
  const r = await ipcRenderer.invoke(cmd, args);
  if ("error" in r) throw r.error;
  return r.ok;
}

const chromeArg = process.argv.find((a) => a.startsWith("--yoake-chrome="));

const EVENTS = ["yoake-event", "yoake-log", "yoake-disconnected", "yoake-notification-open", "yoake-themes-changed"];

contextBridge.exposeInMainWorld("yoake", {
  invoke: (cmd, args) => (cmd.startsWith("shell:") ? Promise.reject("unknown command") : call(cmd, args)),
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
  revealItemInDir: (path) => call("shell:reveal", { path }),
  readClipboard: () => call("shell:read_clipboard"),
  writeClipboard: (text) => call("shell:write_clipboard", { text }),
  minimize: () => call("shell:window", { action: "minimize" }),
  toggleMaximize: () => call("shell:window", { action: "toggleMaximize" }),
  close: () => call("shell:window", { action: "close" }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
  chrome: chromeArg ? JSON.parse(chromeArg.slice("--yoake-chrome=".length)) : {},
  setWindowChrome: (on) => call("shell:set_window_chrome", { on }),
  placeTrafficLights: (x, y) => call("shell:place_traffic_lights", { x, y }),
  styleOverlay: (symbolColor, height) => call("shell:style_overlay", { symbolColor, height }),
});

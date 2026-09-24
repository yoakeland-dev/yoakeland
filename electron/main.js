import { app, BrowserWindow, clipboard, dialog, ipcMain, net as enet, protocol, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as backend from "./backend.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.YOAKE_DEV_URL; // set by `npm run electron:dev`
const APP_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : "app://yoake";
// Node's URL reports the origin of app:// URLs as "null", so compare prefixes.
const isAppUrl = (url) => url.startsWith(APP_ORIGIN + "/");
const BUILD_DIR = path.join(here, "..", "build");

app.setPath("userData", path.join(app.getPath("appData"), "com.aveline.yoake-gui"));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** @type {BrowserWindow | null} */
let win = null;
let overlayOn = false;

// Mirrors the renderer's "Window controls" setting; Windows only accepts the overlay at window creation.
const prefsFile = () => path.join(app.getPath("userData"), "window.json");
function chromeEnabled() {
  try {
    return JSON.parse(readFileSync(prefsFile(), "utf8")).chrome !== false;
  } catch {
    return true;
  }
}

function chromeOptions(chrome) {
  if (process.platform === "darwin") return { titleBarStyle: "hidden" };
  if (process.platform === "win32" && chrome) {
    return { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#e6e6e6", height: 50 } };
  }
  return { frame: false };
}

// macOS 26 made the traffic lights larger.
const trafficLights = Number(process.getSystemVersion().split(".")[0]) >= 26 ? { w: 60, h: 14 } : { w: 52, h: 16 };

function createWindow() {
  const chrome = chromeEnabled();
  overlayOn = process.platform === "win32" && chrome;
  win = new BrowserWindow({
    ...chromeOptions(chrome),
    title: "yoakeland",
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0c11",
    icon: path.join(here, "icon.png"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--yoake-chrome=${JSON.stringify({ overlay: overlayOn, trafficLights })}`,
      ],
    },
  });
  if (process.platform === "darwin" && !chrome) win.setWindowButtonVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    }
  });
  // vite may still be starting.
  if (DEV_URL) win.webContents.on("did-fail-load", (_e, _code, _desc, _url, mainFrame) => mainFrame && setTimeout(() => win?.loadURL(DEV_URL), 300));
  win.on("closed", () => (win = null));
  void win.loadURL(DEV_URL ?? "app://yoake/");
}

// Errors come back as `{ error }` so the renderer gets the plain message, not Electron's wrapper.
function handle(name, fn) {
  ipcMain.handle(name, async (event, args) => {
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) {
      return { error: "forbidden" };
    }
    try {
      return { ok: await fn(args ?? {}, event) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

const emit = (channel, payload) => win?.webContents.send(channel, payload);

for (const [name, fn] of Object.entries(backend.commands(emit, app.getPath("userData")))) handle(name, fn);

handle("load_credential", ({ key }) => backend.loadCredential(app.getPath("userData"), key));
handle("store_credential", ({ key, value }) => backend.storeCredential(app.getPath("userData"), key, value));

handle("shell:pick_files", async ({ title, multiple }, event) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title,
    properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
  });
  return r.canceled ? [] : r.filePaths;
});
handle("shell:open_url", ({ url }) => {
  if (!/^https?:|^mailto:/.test(url)) throw new Error(`refusing to open ${url}`);
  return shell.openExternal(url);
});
handle("shell:reveal", ({ path: p }) => shell.showItemInFolder(p));
handle("shell:read_clipboard", () => clipboard.readText());
handle("shell:write_clipboard", ({ text }) => clipboard.writeText(text));
handle("shell:window", ({ action }, event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w) return;
  if (action === "minimize") w.minimize();
  else if (action === "toggleMaximize") w.isMaximized() ? w.unmaximize() : w.maximize();
  else if (action === "close") w.close();
});
handle("shell:set_window_chrome", ({ on }, event) => {
  writeFileSync(prefsFile(), JSON.stringify({ chrome: !!on }));
  // Windows applies it on the next launch; see chromeEnabled.
  if (process.platform === "darwin") BrowserWindow.fromWebContents(event.sender)?.setWindowButtonVisibility(!!on);
});
handle("shell:place_traffic_lights", ({ x, y }, event) => {
  if (process.platform === "darwin") {
    BrowserWindow.fromWebContents(event.sender)?.setWindowButtonPosition({ x: Math.round(x), y: Math.round(y) });
  }
});
handle("shell:style_overlay", ({ symbolColor, height }, event) => {
  if (overlayOn) {
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ color: "#00000000", symbolColor, height: Math.round(height) });
  }
});

app.whenReady().then(() => {
  // Not file://: adapter-static emits absolute asset paths.
  protocol.handle("app", async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.join(BUILD_DIR, path.normalize(rel));
    if (!file.startsWith(BUILD_DIR)) return new Response("forbidden", { status: 403 });
    const res = await enet.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (res?.ok) return res;
    return new Response(await readFile(path.join(BUILD_DIR, "index.html")), {
      headers: { "content-type": "text/html" },
    });
  });
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on("window-all-closed", () => {
  backend.disconnectAll();
  if (process.platform !== "darwin") app.quit();
});

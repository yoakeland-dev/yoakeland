import { app, BrowserWindow, clipboard, dialog, ipcMain, net as enet, Notification, protocol, session, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import os from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as backend from "./backend.js";
import { createOsAlerts } from "./osAlerts.js";
import { lanHosts } from "./lanHosts.js";
import { createGuards } from "./agentGuard.js";
import { createOAuthListener } from "./oauthListener.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = app.isPackaged ? undefined : process.env.YOAKE_DEV_URL; // set by `npm run electron:dev`
const APP_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : "app://yoake";
// Node's URL reports the origin of app:// URLs as "null", so compare prefixes.
const isAppUrl = (url) => url.startsWith(APP_ORIGIN + "/");
const BUILD_DIR = path.join(here, "..", "build");

app.setPath("userData", path.join(app.getPath("appData"), "com.aveline.yoake-gui"));

// At 1x scale Chromium won't give a scroller with a transparent background its own layer (it
// would lose LCD subpixel text), so scrolling the chat, a diff or the editor repainted and
// re-rasterized the whole window every frame. Composite them anyway: text inside scrollers is
// grayscale-antialiased, which is what most Linux desktops use already.
app.commandLine.appendSwitch("enable-prefer-compositing-to-lcd-text");

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
      // The side panel's browser (BrowserPanel.svelte); locked down in lockDownWebviews.
      webviewTag: true,
      // Chromium's built-in PDF viewer, for the explorer's PDF preview (FileEditor.svelte).
      plugins: true,
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
  win.on("focus", () => osAlerts.closeAll());
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
// Server notifications the renderer thinks deserve an OS alert; osAlerts.js has the policy.
const osAlerts = createOsAlerts({
  Notification,
  isFocused: () => !!win && win.isFocused() && win.isVisible() && !win.isMinimized(),
  onOpen: (target) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    emit("yoake-notification-open", target);
  },
  setBadge: (count) => app.setBadgeCount(count),
});
// OpenRouter sign-in: the redirect lands on a loopback port this process listens on (oauthListener.js).
const oauth = createOAuthListener();
handle("oauth_listen", () => oauth.listen());
handle("oauth_wait", () => oauth.wait());
handle("oauth_wait_params", () => oauth.waitParams());
handle("oauth_cancel", () => oauth.cancel());
handle("shell:notify", (req) => osAlerts.show(req));
handle("shell:badge", ({ count }) => osAlerts.badge(count));

// What "Pair a phone" needs: the built web client for yoakeland to serve (a Go process can't read
// inside app.asar, hence asarUnpack) and this machine's LAN addresses for the QR code's URL.
handle("shell:pair_info", async () => {
  const webRoot = BUILD_DIR.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
  const hosts = await lanHosts();
  return { webRoot: existsSync(path.join(webRoot, "index.html")) ? webRoot : "", hosts };
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

// The side panel's browser shows arbitrary sites: http(s) only, no preload, sandboxed, its own
// storage partition, no permissions, and popups open in place instead of new windows.
const WEB = /^(https?:|about:blank)/;
const BROWSER_PARTITION = "persist:yoake-browser";
// While the agent drives a chat's browser (browserAgent.svelte.ts), the renderer guards that
// webview with the hosts the agent may be on; a page-initiated navigation or redirect anywhere
// else is stopped and reported back when the guard is released. The user's own navigation
// (loadURL from the address bar) isn't a will-navigate, and the guard only lasts one action.
const guards = createGuards();
handle("shell:browser_guard", ({ id, hosts }) => guards.guard(id, hosts));
handle("shell:browser_unguard", ({ id }) => guards.unguard(id));

function lockDownWebviews() {
  const browser = session.fromPartition(BROWSER_PARTITION);
  browser.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // Requests aren't the only way in: synchronous checks (permissions.query, device lists) are
  // answered separately, and default to allowed.
  browser.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e, prefs, params) => {
      delete prefs.preload;
      delete prefs.preloadURL;
      prefs.nodeIntegration = false;
      prefs.nodeIntegrationInSubFrames = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      // A `disablewebsecurity` attribute would otherwise turn off same-origin checks.
      prefs.webSecurity = true;
      prefs.allowRunningInsecureContent = false;
      if (!WEB.test(params.src) || params.partition !== BROWSER_PARTITION) e.preventDefault();
    });
    if (contents.getType() !== "webview") return;
    contents.on("destroyed", () => guards.unguard(contents.id));
    contents.setWindowOpenHandler(({ url }) => {
      if (WEB.test(url) && guards.allows(contents.id, url)) void contents.loadURL(url);
      return { action: "deny" };
    });
    // The agent drives this browser too (browserAgent.svelte.ts), so a server redirect gets the
    // same web-only rule as a navigation.
    for (const ev of ["will-navigate", "will-redirect"]) {
      contents.on(ev, (e, url) => {
        if (!WEB.test(url) || !guards.allows(contents.id, url)) e.preventDefault();
      });
    }
  });
}

app.whenReady().then(() => {
  lockDownWebviews();
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
  // Theme files get regenerated by tools like matugen, which replace them, so watch the
  // directory (a watch on a file goes stale after the first rename).
  let themesTimer;
  const themesDir = path.join(app.getPath("userData"), "themes");
  mkdirSync(themesDir, { recursive: true });
  watch(themesDir, (_ev, name) => {
    if (!name?.endsWith(".json")) return;
    clearTimeout(themesTimer);
    themesTimer = setTimeout(() => emit("yoake-themes-changed"), 150);
  }).on("error", () => {});
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on("window-all-closed", () => {
  backend.disconnectAll();
  if (process.platform !== "darwin") app.quit();
});

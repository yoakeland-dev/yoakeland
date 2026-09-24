# Tauri → Electron migration

Why: WebKitGTK caps rendering at 60fps on Linux (measured on a 180Hz monitor; no
env var or renderer switch lifts it). Chromium follows the display's refresh rate.

Starting point: this is a copy of `yoake-gui` at `2941d56`. Every desktop-shell
call already goes through **`src/lib/platform.ts`**. Nothing else imports
`@tauri-apps`, so the frontend port is mostly "rewrite that one file".

---

## 1. Scaffold the Electron shell

- [ ] `npm i -D electron electron-builder` (plus a TS build for main/preload: `tsc` or `esbuild`)
- [ ] `electron/main.ts`: one `BrowserWindow`
  - `frame: false` (the app draws its own titlebar buttons)
  - `backgroundColor: "#0b0c11"` (the app's `--bg`; avoids flashes during resize)
  - `minWidth: 900, minHeight: 600, width: 1280, height: 800`, title `yoakeland`
  - `webPreferences`: `preload`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- [ ] Load the app
  - dev: `http://localhost:1420` (the existing `vite dev`)
  - prod: serve `build/` over a custom scheme (`protocol.handle("app", …)`) with an
    `index.html` fallback, since SvelteKit's adapter-static uses absolute asset paths
    and `file://` breaks them
- [ ] Links: `setWindowOpenHandler` → `shell.openExternal`, and block in-app navigation away from the app
- [ ] On Linux, confirm it runs as a native Wayland window, not XWayland
  (`hyprctl clients` shows `xwayland: false`). If not, set `--ozone-platform-hint=auto`
- [ ] `package.json` scripts: `electron:dev` (vite + electron), `electron:build` (vite build + electron-builder)

## 2. Preload bridge

- [ ] `electron/preload.ts`: `contextBridge.exposeInMainWorld("yoake", { … })` with:
  - `invoke(cmd, args)` → `ipcRenderer.invoke(cmd, args)`
  - `listen(event, cb)` → `ipcRenderer.on`, returning an unsubscribe function
  - `pickFiles(opts)`, `openUrl(url)`, `revealItemInDir(path)`
  - `readClipboard()`, `writeClipboard(text)` (Electron's `clipboard` module)
  - `minimize()`, `toggleMaximize()`, `close()`
  - `getPathForFile(file)` → `webUtils.getPathForFile` (needed for native drops, see §4)
- [ ] Expose only these named functions, never `ipcRenderer` itself. In main, only accept
  IPC from the app's own frame (`event.senderFrame.url` starts with the app origin).

## 3. Port the backend (`src-tauri/src/*.rs`) to the main process

The frontend calls these by name with **camelCase** args (Tauri converted them to
snake_case for Rust; Electron won't). Handle each with `ipcMain.handle(name, …)`:

| Command | Args | Returns |
|---|---|---|
| `probe_tcp` | `host, port` | `boolean` (400ms connect timeout) |
| `probe_unix` | `path` | `boolean` (400ms timeout) |
| `default_socket_path` | none | `string` |
| `spawn_detached_server` | `binPath, host, port, token` | void |
| `spawn_detached_unix_server` | `binPath, socketPath` | void |
| `connect_tcp` | `host, port, token, caPem?, name?, deviceType?, avatar?, deviceId?` | `connectionId` |
| `connect_unix` | `path, name?, deviceType?, avatar?, deviceId?` | `connectionId` |
| `send_envelope` | `connectionId, envelope` | void |
| `disconnect` | `connectionId` | void |
| `read_text_file` | `path` | `string` |
| `read_file_bytes` | `path` | bytes (return a `Uint8Array`; the frontend wraps it in a `File`) |
| `load_credential` | `key` | `string \| null` |
| `store_credential` | `key, value?` (absent value = delete) | void |

Events pushed to the renderer (`webContents.send`), each tagged with `connectionId`:
`yoake-event {connectionId, envelope}`, `yoake-log {connectionId, message}`,
`yoake-disconnected {connectionId, reason}`.

Behaviour to carry over (read `backend.rs` for details):

- [ ] **Framing:** newline-delimited JSON both ways. One entry per `connectionId` in a
  map, so several servers can be connected at once
- [ ] **TCP is TLS-only.** With `caPem`, trust *only* that CA (`tls.connect({ ca: caPem, servername: host })`).
  Without it, use the OS trust store. Never set `rejectUnauthorized: false`
- [ ] **Auth frame:** first frame on TCP is `{type:"auth", data:{token, name?, deviceType?, avatar?, deviceId?}}`.
  On the local socket the same frame without `token`, sent only if any identity field is set
- [ ] **Local transport:** `net.connect(path)` handles both the Unix socket and Windows named
  pipes. Expand `~`. `default_socket_path` order: `$XDG_RUNTIME_DIR/yoake/yoakeland.sock`,
  then `$TMPDIR/yoake/…` on macOS, then `~/.yoake/yoakeland.sock`. On Windows it's
  `\\.\pipe\yoakeland-<USERNAME>`
- [ ] **Windows pipe:** retry while the pipe is busy (`ERROR_PIPE_BUSY`, up to ~40×50ms). Then
  **verify the pipe is owned by the current user before sending anything.** This is a
  security check, not optional: the pipe namespace is global, so another user could create
  the name first and receive our prompts and credentials. Node can't do this natively; use
  a small native addon (napi-rs, reusing `check_pipe_owner` from `backend.rs`) or a signed
  helper binary
- [ ] **Spawning the server:** detached, with no stdin, and `unref()` it so it outlives the app.
  Pipe its stdout/stderr lines to `yoake-log`. On Windows use `windowsHide: true`
- [ ] **Unexpected close:** remove the map entry and emit `yoake-disconnected`
- [ ] **Credentials:** a JSON map in `app.getPath("userData")/credentials.json`, written
  with mode `0600` (see `credentials.rs`). Optionally switch to `safeStorage` later

## 4. Rewrite `src/lib/platform.ts` against `window.yoake`

- [ ] `isDesktop` = `"yoake" in window` (replaces the `__TAURI_INTERNALS__` check)
- [ ] `invoke`, `listen`, `pickFiles`, `openUrl`, `revealItemInDir`, `readClipboard`,
  `writeClipboard`, `windowControls`: thin calls into the preload API, same signatures
- [ ] `onFileDrop`: Electron doesn't intercept drops; the page gets normal HTML5 events.
  Implement it with `dragenter`/`dragover`/`dragleave`/`drop` listeners on `document`
  (call `preventDefault` on `dragover`/`drop`), map `drop` files to paths with
  `yoake.getPathForFile`, and emit the same `FileDropEvent` shape (x/y = `clientX`/`clientY`).
  Check that `PromptInput.svelte`'s own HTML5 `ondrop` doesn't also fire for the same drop
  and double-attach files
- [ ] Remove the now-stale clipboard comment in `TerminalView.svelte` (it explains a WebKitGTK workaround)

## 5. Window dragging

Tauri used `data-tauri-drag-region`. Electron uses CSS `app-region`.

- [ ] Replace the attribute in `src/routes/+page.svelte` (`.right-island`), `Sidebar.svelte`
  (`.brand-row`) and `ChatHeader.svelte` (only when `draggable`), then update the comments
  that mention it (`+page.svelte`, `ChatHeader.svelte`)
- [ ] Gotcha: Tauri's attribute only dragged on direct clicks on that element.
  `-webkit-app-region: drag` covers the **whole subtree**, so every interactive child
  (buttons, inputs, the title-edit field, dropdown triggers) needs `-webkit-app-region: no-drag`.
  Easiest: a `.drag-region { -webkit-app-region: drag }` class in `app.css`, plus
  `.drag-region :is(button, input, textarea, a, [role="button"], [contenteditable]) { -webkit-app-region: no-drag }`
- [ ] Double-click-to-maximize and dragging: test on Hyprland and on a floating window

## 6. Remove Tauri

- [ ] Delete `src-tauri/`
- [ ] Drop `@tauri-apps/*` and `@tauri-apps/cli` from `package.json`, plus the `tauri` script
- [ ] Update the Tauri comments in `svelte.config.js`, `src/routes/+layout.ts` and the `__preview` routes
- [ ] Update `README.md` build instructions

## 7. Packaging

- [ ] `electron-builder` config: `appId com.aveline.yoake-gui`, productName, icons (reuse `src-tauri/icons/` before deleting it)
- [ ] Targets: Linux `AppImage` + `deb` + `rpm`, Windows `nsis`, macOS `dmg`
- [ ] Only ship `build/` and the compiled main/preload in the package (`files`), not `src/`

## 8. Verify

- [ ] `npm run check` passes
- [ ] Frame rate: on the 180Hz monitor, count `requestAnimationFrame` calls per second
  (a throwaway snippet in devtools is enough); expect ~180, not 60
- [ ] Local connect: auto-starting the server, reconnecting to an already-running one, and closing the app leaves the server running
- [ ] Remote connect: pairing code (token + CA), a wrong CA is rejected, reconnect on startup via stored credentials
- [ ] Multiple servers connected at once, and a server dying mid-session shows as disconnected
- [ ] Terminal: typing, copy/paste from the context menu, resize
- [ ] Attachments: file picker (local), drag-drop onto the correct chat when split, upload of a dropped file to a remote server
- [ ] Links in Markdown open in the system browser; "Reveal in file manager" works
- [ ] Titlebar: drag, double-click maximize, minimize/maximize/close, and every button inside a drag region still clicks
- [ ] Idle CPU near 0 and memory in the same range as the Tauri build (~440MB PSS)

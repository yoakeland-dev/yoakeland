# yoake-gui

Desktop client for yoakeland: SvelteKit (static SPA) in an Electron shell.

- `electron/main.js`: window, `app://` protocol serving `build/`, IPC handlers
- `electron/backend.js`: server connections (TLS / Unix socket), spawning, credentials
- `electron/preload.cjs`: the `window.yoake` bridge; `src/lib/platform.ts` is its only user

```sh
npm install
npm run electron:dev    # vite on :1420 + Electron
npm run electron:build  # packages into dist/
npm run check
```

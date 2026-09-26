import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).version) },
  // The ~1,250 file icons (fileIcons.ts) stay separate files rather than base64 inside the JS.
  build: { assetsInlineLimit: (file) => (file.includes("material-icon-theme") ? false : undefined) },
  // Fixed port: `npm run electron:dev` points the window at it.
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
});

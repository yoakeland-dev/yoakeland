import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";

// KaTeX's stylesheet lists every font three times (woff2, woff, ttf) and Vite would bundle all of
// them. Chromium, i.e. Electron, reads woff2, so drop the other two.
/** @type {import("vite").Plugin} */
const katexWoff2Only = {
  name: "katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (id.endsWith("katex.min.css")) return code.replace(/,url\([^)]*\.(?:woff|ttf)\)\s*format\("[^"]*"\)/g, "");
  },
};

export default defineConfig({
  plugins: [katexWoff2Only, sveltekit()],
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).version) },
  // The ~1,250 file icons (fileIcons.ts) stay separate files rather than base64 inside the JS.
  build: { assetsInlineLimit: (file) => (file.includes("material-icon-theme") ? false : undefined) },
  // Fixed port: `npm run electron:dev` points the window at it.
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
});

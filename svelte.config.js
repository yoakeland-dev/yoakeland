// Static SPA: no server rendering, index.html as the fallback route.
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { CSP } from "./electron/csp.js";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    // SvelteKit adds the hash of its inline bootstrap script to script-src.
    csp: { mode: "hash", directives: CSP },
  },
};

export default config;

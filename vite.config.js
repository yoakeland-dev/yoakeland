import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [sveltekit()],
  // Fixed port: `npm run electron:dev` points the window at it.
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
});

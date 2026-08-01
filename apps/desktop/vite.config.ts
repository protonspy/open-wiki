import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The renderer's build. Only the renderer: the main process is TypeScript that
 * Electron's Node runs, and putting it through a browser-targeted bundler is
 * how `node:fs` ends up shimmed out of a process whose whole job is the
 * filesystem.
 *
 * `base: "./"` because the built page is loaded from a file URL inside the
 * packaged application, not served.
 */
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../build/renderer",
    emptyOutDir: true,
  },
});

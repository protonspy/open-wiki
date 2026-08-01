/**
 * Bundle the Electron main process and its preload (plan 10.1).
 *
 *   node scripts/build-main.mjs
 *
 * The renderer is Vite's job; this is the other half. Electron's `main` points
 * at `build/main/index.js`, and the preload at `build/main/preload.js` — a
 * packaged application has no TypeScript and no `node_modules` for the
 * workspace packages, so both have to be bundles rather than entry points.
 *
 * `electron` itself stays external: it is provided by the runtime, and
 * bundling it produces a file that cannot start.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..", "apps", "desktop");

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Provided by Electron, and by the OS in the case of the optional native
  // pieces the source adapters load lazily.
  external: ["electron", "pdfjs-dist", "mammoth", "chokidar", "fsevents"],
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: [join(desktop, "src", "main", "index.ts")],
  outfile: join(desktop, "build", "main", "index.js"),
});

await build({
  ...shared,
  entryPoints: [join(desktop, "src", "main", "preload.ts")],
  outfile: join(desktop, "build", "main", "preload.js"),
});

console.log("build-main: apps/desktop/build/main/{index,preload}.js");

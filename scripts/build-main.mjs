/**
 * Bundle the Electron main process and its preload (plan 10.1).
 *
 *   node scripts/build-main.mjs
 *
 * The renderer is Vite's job; this is the other half. Electron's `main` points
 * at `build/main/index.js`, and the preload at `build/main/preload.cjs` — a
 * packaged application has no TypeScript and no `node_modules` for the
 * workspace packages, so both have to be bundles rather than entry points.
 *
 * **Two formats, and neither is a preference.**
 *
 * The main process is ESM, because `apps/desktop/package.json` is
 * `"type": "module"` and because the graph uses `import.meta.url` in three
 * places. esbuild cannot express `import.meta` in CommonJS: it substitutes an
 * empty object, `fileURLToPath(undefined)` throws at module load, and it
 * *warns rather than fails*, so the packaging run stays green and the
 * application does not start.
 *
 * The preload is CommonJS with a `.cjs` extension, because a sandboxed preload
 * cannot be an ES module and `"type": "module"` would make a `.js` one.
 *
 * **Everything is bundled except `electron` itself.** A packaged application
 * has no `node_modules`: `apps/desktop/package.json` declares its libraries as
 * devDependencies precisely so electron-builder collects none of them, and the
 * bundle carries them instead. Leaving one external would make it a runtime
 * `ERR_MODULE_NOT_FOUND` in the installed copy and nowhere else.
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
  // Provided by the Electron runtime; bundling it produces a file that cannot
  // start. `fsevents` is macOS-only and optional inside chokidar.
  external: ["electron", "fsevents"],
  logLevel: "info",
};

await build({
  ...shared,
  format: "esm",
  // The graph contains CommonJS packages — `yaml` calls `require("process")` —
  // and esbuild's ESM output replaces `require` with a stub that throws. The
  // application would start and then die on the first page it parsed.
  banner: {
    js: [
      'import { createRequire as __owCreateRequire } from "node:module";',
      "const require = __owCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  entryPoints: [join(desktop, "src", "main", "index.ts")],
  outfile: join(desktop, "build", "main", "index.js"),
});

await build({
  ...shared,
  format: "cjs",
  entryPoints: [join(desktop, "src", "main", "preload.ts")],
  outfile: join(desktop, "build", "main", "preload.cjs"),
});

console.log("build-main: apps/desktop/build/main/{index.js,preload.cjs}");

/**
 * Bundle the CLI to a single file (plan 9.14, first half).
 *
 *   node scripts/build-cli.mjs
 *
 * **Not a preference.** An unbundled CLI pays Node's module resolution on
 * every invocation, and a `PreToolUse` hook fires it on *every page write* —
 * so the cost is not paid once when a person types `ow check`, it is paid
 * every time an agent touches a page. `adr:0014-typescript-everywhere-except-audio-capture`
 * names this as the reason esbuild is in the stack at all.
 *
 * The result is what npm publishes: `bin.ow` points at `build/ow.mjs`, and
 * `files` carries nothing else — so `npx open-wiki init` downloads one file
 * plus its manifest.
 *
 * **Nothing stays external.** `open-wiki` declares no runtime dependencies:
 * `@open-wiki/access` and `@open-wiki/mcp` are workspace packages that are
 * never published, and declaring them would make every install 404. So the
 * bundle has to carry the whole graph — including the source adapters'
 * libraries, which are reached through a dynamic `import()` and would
 * otherwise be an `ERR_MODULE_NOT_FOUND` the first time somebody drops a PDF
 * into `raw/`. The dynamic import still buys what it was for: esbuild splits
 * those out of the startup path, so a hook run does not parse them.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "packages", "cli");

await build({
  entryPoints: [join(cli, "src", "cli.ts")],
  outfile: join(cli, "build", "ow.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // ESM, and the shebang and the `require` shim both come from here.
  //
  // ESM because the graph uses `import.meta.url`, which esbuild cannot express
  // in CommonJS. But the graph also contains CommonJS packages — `yaml` calls
  // `require("process")` — and esbuild's ESM output replaces `require` with a
  // stub that throws, so the CLI died on its first `parse`. `createRequire`
  // is what makes those calls real.
  //
  // The shebang is here rather than in `cli.ts` because esbuild emits the
  // banner *above* the shebang it hoists out of the entry point: with both,
  // the output carried two, and the second one is a syntax error.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __owCreateRequire } from "node:module";',
      "const require = __owCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  // macOS-only, optional inside chokidar, and this product is Windows-only.
  external: ["fsevents"],
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

console.log("build-cli: packages/cli/build/ow.mjs");

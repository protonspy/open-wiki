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
  // The shebang `cli.ts` carries is a comment to esbuild; put it back.
  banner: { js: "#!/usr/bin/env node" },
  // Bundled, including the workspace packages — that is the point. What stays
  // external is what cannot be bundled: the native and lazily-loaded parts of
  // the source adapters, which the CLI reaches only through a dynamic import
  // and which npm installs alongside.
  external: ["pdfjs-dist", "mammoth", "chokidar", "electron"],
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

console.log("build-cli: packages/cli/build/ow.mjs");

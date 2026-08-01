import { main } from "./main.js";

/**
 * The process entrypoint, and nothing else. Everything a test would want to
 * drive lives in `main.ts`; what is left here is the pair of things a test
 * cannot have — the real `process.argv` and a real `process.exit`.
 *
 * **No shebang here; `scripts/build-cli.mjs` writes it.** What ships is the
 * bundle, and that bundle needs a `createRequire` shim above the first line of
 * code — esbuild emits the banner before the shebang it hoists out of this
 * file, so two shebangs would land in the output and the second one is a
 * syntax error. One place writes it, and it is the place that also writes the
 * shim.
 */
main(process.argv.slice(2)).then((code) => process.exit(code));

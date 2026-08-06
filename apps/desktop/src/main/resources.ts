import { join, resolve } from "node:path";

/**
 * Where the two bundled binaries are — packaged, and in a checkout (plan 10.1).
 *
 * `resolveFfmpeg` and `resolveRecorder` find their binary by counting
 * directories up from the module that defines them — four levels for one, five
 * for the other, each correct for where its *source* file sits.
 * **Bundling collapses those depths into one file**, and `build/main/index.js`
 * is not where either source was. `resolveRecorder` survives on a coincidence:
 * `src/main` and `build/main` sit at the same depth, so its five levels still
 * land on the repository root. `resolveFfmpeg` does not — its source is in
 * `packages/audio/src`, so from the bundle its four levels stop at `apps/`, and
 * a checkout run reports looking for ffmpeg in `apps/vendor/ffmpeg`.
 *
 * Both counts are also wrong once packaged, and wrong quietly in every mode:
 * the tests all pass, because they pass the resolver an explicit root.
 *
 * So the location is stated rather than derived, in both modes. Packaged,
 * `extraResources` puts both beside the asar, which is `process.resourcesPath`.
 * Unpackaged, `app.getAppPath()` is `apps/desktop`, so the repository root is
 * two levels above it and each binary is where its build step writes it —
 * `node scripts/fetch-ffmpeg.mjs` and `cargo build --release`.
 *
 * Both resolvers honour an explicit override, which is also what lets a
 * developer point at a build they already have.
 */
export const BINARY_VARIABLES = ["OPEN_WIKI_FFMPEG", "OPEN_WIKI_RECORDER"] as const;

/** Beside the asar, where `extraResources` puts them. */
export function packagedBinaries(resourcesPath: string): Record<string, string> {
  return {
    OPEN_WIKI_FFMPEG: join(resourcesPath, "ffmpeg.exe"),
    OPEN_WIKI_RECORDER: join(resourcesPath, "recorder.exe"),
  };
}

/**
 * Where a checkout's build steps write them, given `apps/desktop` — the app
 * path Electron reports when it is not packaged.
 */
export function checkoutBinaries(appPath: string): Record<string, string> {
  const root = resolve(appPath, "..", "..");
  return {
    OPEN_WIKI_FFMPEG: join(root, "vendor", "ffmpeg", "ffmpeg.exe"),
    OPEN_WIKI_RECORDER: join(root, "target", "release", "recorder.exe"),
  };
}

/**
 * Point the resolvers at those paths, leaving an existing override alone — a
 * developer running against their own ffmpeg meant that, and this is not the
 * place to overrule it.
 */
export function applyBinaries(
  binaries: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
): void {
  for (const [variable, file] of Object.entries(binaries)) {
    env[variable] ??= file;
  }
}

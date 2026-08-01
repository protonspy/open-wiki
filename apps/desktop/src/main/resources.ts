import { join } from "node:path";

/**
 * Where the bundled binaries are once the application is packaged (plan 10.1).
 *
 * `resolveFfmpeg` and `resolveRecorder` find their binary by counting
 * directories up from the module that defines them — four levels for one, five
 * for the other, each correct for where its source file sits in the checkout.
 * **Bundling collapses those three depths into one file**, so both counts are
 * wrong in the packaged application, and wrong quietly: recording fails on
 * every installed copy while every test passes.
 *
 * So the packaged location is stated rather than derived. `extraResources`
 * puts both beside the asar, which is `process.resourcesPath`, and both
 * resolvers already honour an explicit override — which is also what lets a
 * developer point at a build they already have.
 */
export const BINARY_VARIABLES = ["OPEN_WIKI_FFMPEG", "OPEN_WIKI_RECORDER"] as const;

export function packagedBinaries(resourcesPath: string): Record<string, string> {
  return {
    OPEN_WIKI_FFMPEG: join(resourcesPath, "ffmpeg.exe"),
    OPEN_WIKI_RECORDER: join(resourcesPath, "recorder.exe"),
  };
}

/**
 * Point the resolvers at the packaged binaries, leaving an existing override
 * alone — a developer running the packaged build against their own ffmpeg
 * meant that, and this is not the place to overrule it.
 */
export function applyPackagedBinaries(
  resourcesPath: string,
  env: Record<string, string | undefined> = process.env,
): void {
  for (const [variable, file] of Object.entries(packagedBinaries(resourcesPath))) {
    env[variable] ??= file;
  }
}

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPackagedBinaries,
  BINARY_VARIABLES,
  packagedBinaries,
} from "../src/main/resources.js";

/**
 * Plan 10.1 — the packaged application has to find the two binaries the
 * installer bundles. `resolveFfmpeg` and `resolveRecorder` count directories up
 * from their own source file, four levels for one and five for the other, and
 * the bundle collapses those depths into one file: both counts are wrong once
 * packaged, and wrong silently, because every test passes and only an installed
 * copy fails to record.
 */
describe("packagedBinaries (10.1)", () => {
  it("names both binaries beside the asar, where extraResources puts them", () => {
    const resources = join(
      "C:",
      "Users",
      "x",
      "AppData",
      "Local",
      "Programs",
      "open-wiki",
      "resources",
    );
    expect(packagedBinaries(resources)).toEqual({
      OPEN_WIKI_FFMPEG: join(resources, "ffmpeg.exe"),
      OPEN_WIKI_RECORDER: join(resources, "recorder.exe"),
    });
  });

  it("covers every variable the resolvers read", () => {
    expect(Object.keys(packagedBinaries("r")).sort()).toEqual([...BINARY_VARIABLES].sort());
  });
});

describe("applyPackagedBinaries (10.1)", () => {
  it("points the resolvers at the packaged binaries", () => {
    const env: Record<string, string | undefined> = {};
    applyPackagedBinaries(join("app", "resources"), env);
    expect(env["OPEN_WIKI_RECORDER"]).toBe(join("app", "resources", "recorder.exe"));
  });

  it("leaves an override alone", () => {
    // A developer running the packaged build against a build of ffmpeg they
    // already have meant that, and this is not the place to overrule it.
    const env: Record<string, string | undefined> = { OPEN_WIKI_FFMPEG: "D:\\ffmpeg.exe" };
    applyPackagedBinaries(join("app", "resources"), env);
    expect(env["OPEN_WIKI_FFMPEG"]).toBe("D:\\ffmpeg.exe");
    expect(env["OPEN_WIKI_RECORDER"]).toBe(join("app", "resources", "recorder.exe"));
  });
});

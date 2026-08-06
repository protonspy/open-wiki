import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBinaries,
  BINARY_VARIABLES,
  checkoutBinaries,
  packagedBinaries,
} from "../src/main/resources.js";

/**
 * Plan 10.1 — the application has to find the two binaries the installer
 * bundles. `resolveFfmpeg` and `resolveRecorder` count directories up from
 * their own source file, four levels for one and five for the other, and the
 * bundle collapses those depths into one file: both counts are wrong once
 * packaged, and the ffmpeg one is wrong in a checkout too, stopping at `apps/`.
 * Wrong silently, because every test of the resolvers passes them an explicit
 * root — which is why these tests assert the stated paths instead.
 */
describe("packagedBinaries (10.1)", () => {
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

  it("names both binaries beside the asar, where extraResources puts them", () => {
    expect(packagedBinaries(resources)).toEqual({
      OPEN_WIKI_FFMPEG: join(resources, "ffmpeg.exe"),
      OPEN_WIKI_RECORDER: join(resources, "recorder.exe"),
    });
  });

  it("covers every variable the resolvers read", () => {
    expect(Object.keys(packagedBinaries("r")).sort()).toEqual([...BINARY_VARIABLES].sort());
  });
});

describe("checkoutBinaries (10.1)", () => {
  const root = join("C:", "src", "open-wiki");
  const appPath = join(root, "apps", "desktop");

  it("names each binary where its build step writes it in a checkout", () => {
    expect(checkoutBinaries(appPath)).toEqual({
      OPEN_WIKI_FFMPEG: join(root, "vendor", "ffmpeg", "ffmpeg.exe"),
      OPEN_WIKI_RECORDER: join(root, "target", "release", "recorder.exe"),
    });
  });

  it("resolves to the repository root, not to apps/", () => {
    // The bug this exists for: the bundled main process is one file at
    // apps/desktop/build/main/index.js, so resolveFfmpeg's four-level climb
    // stopped at apps/ and the app reported looking in apps/vendor/ffmpeg.
    expect(checkoutBinaries(appPath)["OPEN_WIKI_FFMPEG"]).not.toContain(join("apps", "vendor"));
  });

  it("covers every variable the resolvers read", () => {
    expect(Object.keys(checkoutBinaries(appPath)).sort()).toEqual([...BINARY_VARIABLES].sort());
  });
});

describe("applyBinaries (10.1)", () => {
  it("points the resolvers at the binaries it was given", () => {
    const env: Record<string, string | undefined> = {};
    applyBinaries(packagedBinaries(join("app", "resources")), env);
    expect(env["OPEN_WIKI_RECORDER"]).toBe(join("app", "resources", "recorder.exe"));
  });

  it("leaves an override alone", () => {
    // A developer running against a build of ffmpeg they already have meant
    // that, and this is not the place to overrule it.
    const env: Record<string, string | undefined> = { OPEN_WIKI_FFMPEG: "D:\\ffmpeg.exe" };
    applyBinaries(packagedBinaries(join("app", "resources")), env);
    expect(env["OPEN_WIKI_FFMPEG"]).toBe("D:\\ffmpeg.exe");
    expect(env["OPEN_WIKI_RECORDER"]).toBe(join("app", "resources", "recorder.exe"));
  });
});

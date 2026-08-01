import { describe, expect, it } from "vitest";
/*
 * The release scripts are plain ESM on purpose: CI runs them with `node` and
 * nothing bundles them, so they carry no types. Imported dynamically and typed
 * as `any` here rather than with a `.d.ts` nobody would keep in step.
 */
const { checkRelease, isPrerelease, versionOfTag } =
  await import("../../../scripts/ci/release-version.mjs");
const { installerUrl, scoopManifest, wingetManifests } =
  await import("../../../scripts/ci/package-manifests.mjs");

/** A `read` that answers from a map rather than the filesystem. */
function reader(versions: Record<string, string | undefined>) {
  return (path: string) => {
    const key = path.replace(/\\/g, "/");
    const match = Object.keys(versions).find((k) => key.endsWith(k));
    if (!match) throw new Error(`no such file: ${path}`);
    return { version: versions[match] };
  };
}

describe("versionOfTag (10.2)", () => {
  it("reads a release tag", () => {
    expect(versionOfTag("v0.1.0")).toBe("0.1.0");
    expect(versionOfTag("v10.20.30")).toBe("10.20.30");
  });

  it("reads a prerelease tag", () => {
    expect(versionOfTag("v0.1.0-beta.1")).toBe("0.1.0-beta.1");
    expect(isPrerelease("v0.1.0-beta.1")).toBe(true);
    expect(isPrerelease("v0.1.0")).toBe(false);
  });

  it("refuses anything that is not one", () => {
    for (const tag of ["0.1.0", "v0.1", "vlatest", "", "v1.2.3.4"]) {
      expect(versionOfTag(tag)).toBeNull();
    }
  });
});

describe("checkRelease (10.3)", () => {
  const both = { "apps/desktop/package.json": "0.1.0", "packages/cli/package.json": "0.1.0" };

  it("accepts a tag both artifacts agree with", () => {
    expect(checkRelease("v0.1.0", ".", reader(both))).toEqual({ ok: true, version: "0.1.0" });
  });

  it("refuses when the installer and the npm package disagree", () => {
    // `adr:0014` names the cost it accepted: a skew "fails looking like
    // corrupted state rather than a bad install". A user with the application
    // from one version and `npx open-wiki` resolving to another gets a CLI
    // writing an older convention into their project, and nothing says so.
    const result = checkRelease(
      "v0.2.0",
      ".",
      reader({ "apps/desktop/package.json": "0.2.0", "packages/cli/package.json": "0.1.0" }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("the CLI says 0.1.0");
  });

  it("names every artifact that disagrees, not just the first", () => {
    const result = checkRelease(
      "v0.3.0",
      ".",
      reader({ "apps/desktop/package.json": "0.1.0", "packages/cli/package.json": "0.2.0" }),
    );
    expect(result.ok === false && result.problems).toHaveLength(2);
  });

  it("refuses a tag that is not a release tag before reading anything", () => {
    const result = checkRelease("nightly", ".", () => {
      throw new Error("should not read");
    });
    expect(result.ok).toBe(false);
  });

  it("reports a manifest it could not read rather than passing", () => {
    const result = checkRelease("v0.1.0", ".", reader({ "apps/desktop/package.json": "0.1.0" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toMatch(/could not be read/);
  });
});

describe("the package manifests (10.4)", () => {
  const SHA = "a".repeat(64);

  it("points at the release URL for that exact version", () => {
    expect(installerUrl("0.1.0")).toContain("/releases/download/v0.1.0/");
    expect(installerUrl("0.1.0")).toContain("open-wiki-Setup-0.1.0.exe");
  });

  it("quotes the hash in the winget installer manifest", () => {
    // A package manager that downloads without verifying is the
    // fetch-and-execute this product refuses to ship.
    const files = wingetManifests("0.1.0", SHA);
    const installer = Object.entries(files).find(([p]) => p.endsWith("installer.yaml"))?.[1];
    expect(installer).toContain(`InstallerSha256: ${SHA.toUpperCase()}`);
    expect(installer).toContain(installerUrl("0.1.0"));
  });

  it("writes the three files winget wants, under the version", () => {
    const paths = Object.keys(wingetManifests("0.1.0", SHA));
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path).toContain("/0.1.0/");
  });

  it("quotes the hash in the Scoop manifest", () => {
    const scoop = JSON.parse(scoopManifest("0.1.0", SHA.toUpperCase()));
    expect(scoop.architecture["64bit"].hash).toBe(SHA);
    expect(scoop.architecture["64bit"].url).toBe(installerUrl("0.1.0"));
  });

  it("keeps Scoop able to update itself from the published sums", () => {
    const scoop = JSON.parse(scoopManifest("0.1.0", SHA));
    expect(scoop.autoupdate.hash.url).toContain("SHA256SUMS.txt");
    expect(scoop.version).toBe("0.1.0");
  });

  it("declares the licence in both", () => {
    expect(JSON.parse(scoopManifest("0.1.0", SHA)).license).toBe("Apache-2.0");
    const locale = Object.entries(wingetManifests("0.1.0", SHA)).find(([p]) =>
      p.endsWith("locale.en-US.yaml"),
    )?.[1];
    expect(locale).toContain("License: Apache-2.0");
  });
});

const { checkPlugin } = await import("../../../scripts/ci/check-plugin.mjs");

describe("checkPlugin (10.6)", () => {
  const marketplace = {
    plugins: [{ name: "open-wiki", source: "./plugins/open-wiki", version: "0.1.0" }],
  };
  const manifest = { name: "open-wiki", version: "0.1.0" };
  const files = (over: Record<string, unknown> = {}) => {
    const map: Record<string, unknown> = {
      ".claude-plugin/marketplace.json": marketplace,
      "plugins/open-wiki/.claude-plugin/plugin.json": manifest,
      ...over,
    };
    return (path: string) => {
      const key = path.replace(/\\/g, "/");
      const hit = Object.keys(map).find((k) => key.endsWith(k));
      return hit ? map[hit] : null;
    };
  };
  const exists = (present: string[]) => (path: string) =>
    present.some((p) => path.replace(/\\/g, "/").endsWith(p));

  it("accepts a plugin the marketplace and the manifest agree on", () => {
    expect(checkPlugin(".", files(), exists(["plugins/open-wiki"]))).toEqual({ ok: true });
  });

  it("refuses when the two disagree on the version", () => {
    // The marketplace is what a user installs from; a version that does not
    // match the plugin is a install that silently gets something else.
    const result = checkPlugin(
      ".",
      files({
        "plugins/open-wiki/.claude-plugin/plugin.json": { name: "open-wiki", version: "0.2.0" },
      }),
      exists(["plugins/open-wiki"]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("0.2.0");
  });

  it("refuses a source path that is not there", () => {
    const result = checkPlugin(".", files(), exists([]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toMatch(/not there/);
  });

  it("refuses a plugin that ships the skills", () => {
    // `adr:0015` gives the convention one home, and it is the project. A copy
    // here would be a second, and two copies of a convention drift — which is
    // the failure that record exists to prevent.
    const result = checkPlugin(
      ".",
      files(),
      exists(["plugins/open-wiki", "plugins/open-wiki/skills"]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("adr:0015");
  });

  it("refuses a plugin that ships a .mcp.json", () => {
    const result = checkPlugin(
      ".",
      files(),
      exists(["plugins/open-wiki", "plugins/open-wiki/.mcp.json"]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toMatch(/differ per user/);
  });

  it("says so when the marketplace itself will not parse", () => {
    const result = checkPlugin(".", () => null, exists([]));
    expect(result.ok).toBe(false);
  });
});

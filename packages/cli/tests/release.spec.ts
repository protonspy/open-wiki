import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOOK_MATCHERS } from "../src/install.js";

/** This file, `packages/cli/tests/`, is three levels down from the root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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

  it("refuses a version that walks up a directory", () => {
    // The version becomes a path segment — of the manifest directory and of
    // the URL those manifests point at. The prerelease suffix permits `.` and
    // `-`, which is enough to spell `..`.
    for (const tag of ["v1.0.0-..", "v1.0.0-..-..", "v1.0.0-a..b"]) {
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
    expect(scoop.architecture["64bit"].url).toContain(installerUrl("0.1.0"));
  });

  it("actually installs something through Scoop", () => {
    // What the release publishes is an NSIS setup, and Scoop understands Inno
    // but not NSIS. A manifest with a bare `.exe` url and a `bin` entry
    // downloads the setup, never runs it, and then fails to shim a file that
    // was never extracted — passing every assertion about its strings.
    const scoop = JSON.parse(scoopManifest("0.1.0", SHA));
    expect(scoop.bin).toBeUndefined();
    expect(scoop.installer.script.join("\n")).toContain("open-wiki-Setup-0.1.0.exe");
    expect(scoop.installer.script.join("\n")).toContain("/S");
    expect(scoop.uninstaller.script.join("\n")).toContain("Uninstall open-wiki.exe");
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
  const hooks = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit|MultiEdit|Bash",
          hooks: [{ type: "command", command: "npx -y open-wiki@0.1.0 gate pre" }],
        },
      ],
    },
  };
  const files = (over: Record<string, unknown> = {}) => {
    const map: Record<string, unknown> = {
      ".claude-plugin/marketplace.json": marketplace,
      "plugins/open-wiki/.claude-plugin/plugin.json": manifest,
      "plugins/open-wiki/hooks/hooks.json": hooks,
      "packages/cli/package.json": { version: "0.1.0" },
      ...over,
    };
    return (path: string) => {
      const key = path.replace(/\\/g, "/");
      const hit = Object.keys(map).find((k) => key.endsWith(k));
      return hit ? map[hit] : null;
    };
  };
  const PRESENT = ["plugins/open-wiki", "plugins/open-wiki/hooks/hooks.json"];
  const exists = (present: string[]) => (path: string) =>
    present.some((p) => path.replace(/\\/g, "/").endsWith(p));

  it("accepts a plugin the marketplace and the manifest agree on", () => {
    expect(checkPlugin(".", files(), exists(PRESENT))).toEqual({ ok: true });
  });

  it("refuses a hook that resolves whatever is latest on the registry", () => {
    // `npx -y open-wiki gate pre` fetches from the registry on *every page
    // write* — the exact cost the CLI bundle exists to remove — and it defeats
    // 10.3: the installer and the npm package ship from one tag so they cannot
    // skew, and a hook picking up `latest` skews by design.
    const result = checkPlugin(
      ".",
      files({
        "plugins/open-wiki/hooks/hooks.json": {
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "npx -y open-wiki gate pre" }] }],
          },
        },
      }),
      exists(PRESENT),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("open-wiki@0.1.0");
  });

  it("refuses a pin that is not the version this repository publishes", () => {
    const result = checkPlugin(
      ".",
      files({ "packages/cli/package.json": { version: "0.2.0" } }),
      exists(PRESENT),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a plugin with no hooks — the gate is what it is for", () => {
    const result = checkPlugin(".", files(), exists(["plugins/open-wiki"]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toMatch(/ships no hooks/);
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
    const result = checkPlugin(".", files(), exists([...PRESENT, "plugins/open-wiki/skills"]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("adr:0015");
  });

  it("refuses a plugin that ships a .mcp.json", () => {
    const result = checkPlugin(".", files(), exists([...PRESENT, "plugins/open-wiki/.mcp.json"]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toMatch(/differ per user/);
  });

  it("says so when the marketplace itself will not parse", () => {
    const result = checkPlugin(".", () => null, exists([]));
    expect(result.ok).toBe(false);
  });
});

describe("the plugin and `ow init` install the same gate (10.6)", () => {
  // Two JSON files, one convention, and nothing that makes them agree. They
  // drifted the first time they were written: the plugin dropped `Bash` — the
  // matcher whose whole purpose is shell writes, which `ow init` has because a
  // page written through a command carries no content for the gate to see —
  // and added `MultiEdit`, which `ow init` did not have. A user who installs
  // the plugin instead of running `ow init` gets whichever of the two is wrong.
  const plugin = JSON.parse(
    readFileSync(join(REPO_ROOT, "plugins/open-wiki/hooks/hooks.json"), "utf8"),
  ) as { hooks: Record<string, Array<{ matcher: string }>> };

  it("matches the same tools before a write", () => {
    expect(plugin.hooks["PreToolUse"]?.map((e) => e.matcher)).toEqual([HOOK_MATCHERS.pre]);
  });

  it("matches the same tools after one", () => {
    expect(plugin.hooks["PostToolUse"]?.map((e) => e.matcher)).toEqual([HOOK_MATCHERS.post]);
  });

  it("passes its own shape check against the real files", () => {
    expect(checkPlugin(REPO_ROOT)).toEqual({ ok: true });
  });
});

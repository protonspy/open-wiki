/**
 * The winget and Scoop manifests (plan 10.4).
 *
 *   node scripts/ci/package-manifests.mjs v0.1.0 <sha256> [outDir]
 *
 * Both point at the GitHub release URL and quote its hash, which is the whole
 * requirement: a package manager that downloads without verifying is the
 * fetch-and-execute this product refuses to ship — the same argument
 * `scripts/fetch-ffmpeg.mjs` makes about its own download, applied to the
 * installer.
 *
 * Generated rather than hand-maintained because the hash changes every
 * release, and a manifest with last release's hash fails as "the download is
 * corrupt" rather than "somebody forgot to update a file".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { versionOfTag } from "./release-version.mjs";

export const OWNER = "protonspy";
export const REPO = "open-wiki";
export const PUBLISHER = "protonspy";
export const PACKAGE_ID = "protonspy.open-wiki";

/** Where a release's installer lives. `adr:0009` — GitHub Releases, no host of ours. */
export function installerUrl(version) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/open-wiki-Setup-${version}.exe`;
}

/**
 * winget wants three files under `manifests/<letter>/<Publisher>/<Package>/<version>/`.
 * Returned as a map of relative path to content so a test can read them
 * without a filesystem.
 */
export function wingetManifests(version, sha256) {
  const dir = `manifests/${PUBLISHER[0].toLowerCase()}/${PUBLISHER}/open-wiki/${version}`;
  const header = (type) =>
    [
      `PackageIdentifier: ${PACKAGE_ID}`,
      `PackageVersion: ${version}`,
      `ManifestType: ${type}`,
      "ManifestVersion: 1.6.0",
    ].join("\n");

  return {
    [`${dir}/${PACKAGE_ID}.yaml`]: [
      `PackageIdentifier: ${PACKAGE_ID}`,
      `PackageVersion: ${version}`,
      "DefaultLocale: en-US",
      "ManifestType: version",
      "ManifestVersion: 1.6.0",
      "",
    ].join("\n"),

    [`${dir}/${PACKAGE_ID}.locale.en-US.yaml`]: [
      `PackageIdentifier: ${PACKAGE_ID}`,
      `PackageVersion: ${version}`,
      "PackageLocale: en-US",
      `Publisher: ${PUBLISHER}`,
      `PublisherUrl: https://github.com/${OWNER}`,
      "PackageName: open-wiki",
      `PackageUrl: https://github.com/${OWNER}/${REPO}`,
      "License: Apache-2.0",
      `LicenseUrl: https://github.com/${OWNER}/${REPO}/blob/main/LICENSE`,
      "ShortDescription: A project's documentation as a wiki the AI agent already has open.",
      "Description: >-",
      "  Takes in sources — a file or a recording — reduces them to text with",
      "  provenance anchors, and stores a validated markdown wiki inside the",
      "  project directory. The application calls no LLM.",
      "Tags:",
      "  - documentation",
      "  - wiki",
      "  - transcription",
      "ManifestType: defaultLocale",
      "ManifestVersion: 1.6.0",
      "",
    ].join("\n"),

    [`${dir}/${PACKAGE_ID}.installer.yaml`]: [
      header("installer").split("\nManifestType")[0],
      "InstallerType: nullsoft",
      "Scope: user",
      "InstallModes:",
      "  - interactive",
      "  - silent",
      "Installers:",
      "  - Architecture: x64",
      `    InstallerUrl: ${installerUrl(version)}`,
      `    InstallerSha256: ${sha256.toUpperCase()}`,
      "ManifestType: installer",
      "ManifestVersion: 1.6.0",
      "",
    ].join("\n"),
  };
}

/** Scoop is one JSON manifest, and `autoupdate` is what keeps it current. */
export function scoopManifest(version, sha256) {
  return `${JSON.stringify(
    {
      version,
      description: "A project's documentation as a wiki the AI agent already has open.",
      homepage: `https://github.com/${OWNER}/${REPO}`,
      license: "Apache-2.0",
      architecture: {
        "64bit": {
          url: installerUrl(version),
          hash: sha256.toLowerCase(),
        },
      },
      innosetup: false,
      // The NSIS installer puts `ow` on PATH itself; Scoop shims the exe.
      bin: ["ow.cmd"],
      checkver: {
        github: `https://github.com/${OWNER}/${REPO}`,
      },
      autoupdate: {
        architecture: {
          "64bit": {
            url: installerUrl("$version"),
          },
        },
        hash: {
          url: `https://github.com/${OWNER}/${REPO}/releases/download/v$version/SHA256SUMS.txt`,
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function writeManifests(version, sha256, outDir) {
  const files = {
    ...wingetManifests(version, sha256),
    "scoop/open-wiki.json": scoopManifest(version, sha256),
  };
  for (const [rel, content] of Object.entries(files)) {
    const target = join(outDir, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return Object.keys(files);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const version = versionOfTag(process.argv[2] ?? "");
  const sha256 = process.argv[3] ?? "";
  if (!version || !/^[0-9a-f]{64}$/i.test(sha256)) {
    console.error("usage: package-manifests.mjs v1.2.3 <sha256> [outDir]");
    process.exit(1);
  }
  for (const file of writeManifests(version, sha256, process.argv[4] ?? "dist/manifests")) {
    console.log(file);
  }
}

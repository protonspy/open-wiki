/**
 * The version every artifact of a release has to agree on (plan 10.2, 10.3).
 *
 *   node scripts/ci/release-version.mjs v0.1.0
 *
 * Two artifacts ship from one tag — the installer and the npm package — and
 * `adr:0014-typescript-everywhere-except-audio-capture` names the cost it
 * accepted: "a skew between them fails looking like corrupted state rather
 * than a bad install". A user with the desktop application from `v0.2.0` and
 * `npx open-wiki` resolving to `0.1.0` gets a CLI that writes an older
 * convention into their project, and nothing on either side says so.
 *
 * So the tag, the desktop app and the CLI are checked to be the same string
 * *before* anything is published, and the check is a module rather than a
 * shell snippet so it can be tested.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The packages whose `version` a release publishes. */
export const RELEASED = [
  { name: "the desktop application", path: "apps/desktop/package.json" },
  { name: "the CLI", path: "packages/cli/package.json" },
];

/**
 * `v0.1.0` → `0.1.0`. A tag that is not a version is not a release tag.
 *
 * `..` is rejected separately from the pattern: the prerelease suffix permits
 * `.` and `-`, and the version becomes a path segment — of the manifest
 * directory this writes, and of the download URL those manifests point at.
 * Anyone who can push a tag can already do worse, but a version that walks out
 * of `dist/manifests` is not a thing to leave available.
 */
export function versionOfTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? "");
  if (!match || match[1].includes("..")) return null;
  return match[1];
}

/** True for a tag carrying a suffix — `v0.1.0-beta.1` is not a stable release. */
export function isPrerelease(tag) {
  return (versionOfTag(tag) ?? "").includes("-");
}

/**
 * Check that everything agrees, and say precisely what does not.
 *
 * Returns `{ ok: true, version }` or `{ ok: false, problems }`. It never
 * throws for a disagreement: a release that must not happen is an answer, and
 * the caller decides the exit code.
 */
export function checkRelease(tag, repoRoot = ".", read = defaultRead) {
  const version = versionOfTag(tag);
  if (!version) {
    return {
      ok: false,
      problems: [`"${tag}" is not a release tag — it has to look like v1.2.3`],
    };
  }
  const problems = [];
  for (const pkg of RELEASED) {
    let declared;
    try {
      declared = read(join(repoRoot, pkg.path)).version;
    } catch {
      problems.push(`${pkg.name} (${pkg.path}) could not be read`);
      continue;
    }
    if (declared !== version) {
      problems.push(`${pkg.name} says ${String(declared)}, the tag says ${version}`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, version };
}

function defaultRead(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Run as a script: exit 1 on disagreement, and print what to fix.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  // `--prerelease <tag>` prints "true" or nothing, so the release workflow can
  // pick npm's dist-tag from it. A prerelease published to `latest` is what
  // `npx open-wiki` would then hand every user.
  if (process.argv[2] === "--prerelease") {
    if (isPrerelease(process.argv[3] ?? "")) console.log("true");
    process.exit(0);
  }
  const result = checkRelease(process.argv[2] ?? "");
  if (!result.ok) {
    for (const problem of result.problems) console.error(`release: ${problem}`);
    console.error(
      "release: the installer and the npm package ship from one tag and must " +
        "agree on the version — a skew fails looking like corrupted state.",
    );
    process.exit(1);
  }
  console.log(result.version);
}

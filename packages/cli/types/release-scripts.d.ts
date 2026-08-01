/**
 * The release scripts are plain ESM, deliberately: CI runs them with `node`,
 * nothing bundles them, and giving them a build step would mean the thing that
 * publishes a release depends on a build that has to happen first.
 *
 * So they carry no types, and these declarations exist only so the tests that
 * exercise them typecheck. Deliberately loose — a hand-written `.d.ts` that
 * described the real shapes would be a second declaration of them, drifting
 * from the one that runs.
 */
declare module "*/scripts/ci/release-version.mjs" {
  export function versionOfTag(tag: string): string | null;
  export function isPrerelease(tag: string): boolean;
  export function checkRelease(
    tag: string,
    repoRoot?: string,
    read?: (path: string) => { version?: string },
  ): { ok: true; version: string } | { ok: false; problems: string[] };
}

declare module "*/scripts/ci/package-manifests.mjs" {
  export function installerUrl(version: string): string;
  export function wingetManifests(version: string, sha256: string): Record<string, string>;
  export function scoopManifest(version: string, sha256: string): string;
}

declare module "*/scripts/ci/check-plugin.mjs" {
  export function checkPlugin(
    repoRoot?: string,
    read?: (path: string) => unknown,
    exists?: (path: string) => boolean,
  ): { ok: true } | { ok: false; problems: string[] };
}

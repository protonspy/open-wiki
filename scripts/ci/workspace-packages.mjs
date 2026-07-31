/**
 * Lists the pnpm workspace packages that have tests, as a GitHub Actions matrix.
 *
 * Emits `key=value` lines on stdout, meant to be appended to $GITHUB_OUTPUT, and
 * a human-readable summary on stderr:
 *
 *   packages=[{"name":"@open-wiki/desktop","path":"apps/desktop", ...}]
 *   any=true
 *   rust=false
 *
 * It reads the globs out of pnpm-workspace.yaml rather than hard-coding them, so
 * adding a workspace root never means remembering to edit CI too.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The `packages:` list of pnpm-workspace.yaml — a flat sequence of glob strings. */
function workspaceGlobs() {
  const file = join(repoRoot, "pnpm-workspace.yaml");
  if (!existsSync(file)) return [];
  const globs = [];
  let inPackages = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = /^\s+-\s*["']?(.+?)["']?\s*$/.exec(line);
      if (item) globs.push(item[1]);
      else if (line.trim() !== "") break;
    }
  }
  return globs;
}

/** Only `prefix/*` is supported, which is every shape this workspace uses. */
function expand(glob) {
  const star = glob.indexOf("*");
  if (star === -1) return existsSync(join(repoRoot, glob)) ? [glob] : [];
  if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
    process.stderr.write(`unsupported workspace glob, ignored: ${glob}\n`);
    return [];
  }
  const prefix = glob.slice(0, -2);
  const dir = join(repoRoot, prefix);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}/${entry.name}`);
}

const packages = [];
for (const glob of workspaceGlobs()) {
  for (const path of expand(glob)) {
    const manifest = join(repoRoot, path, "package.json");
    if (!existsSync(manifest)) continue;

    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const scripts = pkg.scripts ?? {};
    // A package that reports coverage is preferred; a bare `test` still runs,
    // and the coverage gate then fails it for producing no summary — which is
    // the honest outcome, not a silent pass.
    const script = scripts["test:coverage"] ? "test:coverage" : scripts["test"] ? "test" : null;
    if (!script) continue;

    packages.push({
      name: pkg.name ?? path,
      path,
      script,
      slug: (pkg.name ?? path).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, ""),
    });
  }
}

packages.sort((a, b) => a.path.localeCompare(b.path));

const rust = existsSync(join(repoRoot, "crates")) || existsSync(join(repoRoot, "Cargo.toml"));

process.stdout.write(`packages=${JSON.stringify(packages)}\n`);
process.stdout.write(`any=${packages.length > 0}\n`);
process.stdout.write(`rust=${rust}\n`);

process.stderr.write(
  packages.length === 0
    ? "no workspace package declares a test script yet — the test matrix is empty\n"
    : `${packages.length} package(s) to test:\n${packages
        .map((p) => `  ${p.path} → pnpm --filter ${p.name} run ${p.script}\n`)
        .join("")}`,
);

/**
 * Fails when a package's coverage is below the floor.
 *
 *   node scripts/ci/check-coverage.mjs apps/desktop
 *
 * The floor also lives in vitest.shared.ts, and vitest enforces it locally. This
 * check exists because that one is opt-in: a package that overrides or drops
 * `coverage.thresholds` would go green with no coverage at all. Reading the
 * summary here is the check that cannot be configured away.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const packagePath = process.argv[2];
if (!packagePath) {
  console.error("usage: node scripts/ci/check-coverage.mjs <package-path>");
  process.exit(2);
}

const threshold = Number(process.env["COVERAGE_THRESHOLD"] ?? 76);
if (!Number.isFinite(threshold)) {
  console.error(`COVERAGE_THRESHOLD is not a number: ${process.env["COVERAGE_THRESHOLD"]}`);
  process.exit(2);
}

const summaryPath = join(repoRoot, packagePath, "coverage", "coverage-summary.json");
if (!existsSync(summaryPath)) {
  console.error(
    `${packagePath}: no coverage/coverage-summary.json.\n` +
      "Its test script has to run vitest with --coverage and the json-summary reporter " +
      "(vitest.shared.ts configures both). A test run that reports no coverage cannot " +
      "clear a coverage floor.",
  );
  process.exit(1);
}

const total = JSON.parse(readFileSync(summaryPath, "utf8"))["total"];
if (!total) {
  console.error(`${packagePath}: coverage summary has no "total" section`);
  process.exit(1);
}

const metrics = ["lines", "statements", "functions", "branches"];
const failed = [];

console.log(`${packagePath} — floor ${threshold}%`);
for (const metric of metrics) {
  const pct = total[metric]?.pct;
  if (typeof pct !== "number") {
    failed.push(`${metric}: missing from the summary`);
    continue;
  }
  const ok = pct >= threshold;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${metric.padEnd(11)} ${pct.toFixed(2)}%`);
  if (!ok) failed.push(`${metric}: ${pct.toFixed(2)}% < ${threshold}%`);
}

if (failed.length > 0) {
  console.error(`\n${packagePath} is below the coverage floor:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}

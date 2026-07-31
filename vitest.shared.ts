import { defineConfig } from "vitest/config";

/**
 * The coverage floor every package in this repo has to clear. CI reads the same
 * number out of `coverage/coverage-summary.json`, so a package that drops these
 * thresholds locally still fails there — the gate is not on the honour system.
 */
export const COVERAGE_THRESHOLD = 76;

/**
 * Base config each package extends:
 *
 *   import { defineConfig, mergeConfig } from "vitest/config";
 *   import shared from "../../vitest.shared.js";
 *
 *   export default mergeConfig(shared, defineConfig({ test: { name: "desktop" } }));
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      // json-summary is what CI parses; text is for the person reading the log.
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.spec.ts", "**/*.d.ts", "**/index.ts"],
      // Reporting only on files a test happened to import hides the untested
      // module entirely, which is the exact thing a floor is meant to catch.
      all: true,
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
      },
    },
  },
});

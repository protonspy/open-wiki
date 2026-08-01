import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

/**
 * One lint pass for the whole monorepo. The repo root's `lint` script runs
 * `eslint .` from here, so adding a workspace package needs no config change.
 *
 * It is the non-type-checked flavour of typescript-eslint on purpose: the
 * strict `tsconfig.base.json` already catches the type errors, and a type-aware
 * lint across every package is slow enough to tempt skipping the per-task loop.
 * What this layer adds is what the compiler does not: unused code, shadowed
 * names, no-undef, and the rest of the hygiene the methodology asks for.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // Generated bundles. `build-cli.mjs` and `build-main.mjs` produce these;
      // they are what the installer and the npm package carry, and linting a
      // bundle reports on somebody else's source.
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/release/**",
      "vendor/**",
      "apps/desktop/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Last so it wins: turn off every eslint rule that fights prettier.
  prettier,
);

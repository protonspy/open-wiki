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
/**
 * The three the renderer may not call (plan 1.1, 1.2).
 *
 * They are one class, and the class is "a browser dialog Electron does not
 * give this window". `prompt` is not implemented at all — the call answers
 * `undefined`, no box appears, and the button silently does nothing, which is
 * how four controls shipped dead. `alert` and `confirm` do open, as native
 * modals that block the main process for as long as they are on screen: no
 * watcher event, no IPC reply, no recording tick.
 *
 * The renderer asks its questions through `Ask.tsx` instead. This rule is here
 * so the next one is a failed build rather than a dead button somebody finds
 * in a packaged application.
 */
const BLOCKED = {
  prompt: "Electron does not implement `prompt`: the call answers `undefined` and no box opens.",
  confirm: "`confirm` is a native modal that blocks the main process while it is open.",
  alert: "`alert` is a native modal that blocks the main process while it is open.",
};

/** Every way to reach one of them: bare, and through each name for the global. */
const HOLDERS = ["globalThis", "window", "self"];

const RENDERER = "apps/desktop/src/renderer/**/*.{ts,tsx}";

const ASK_INSTEAD = " Ask through `useDialogs` in `Ask.tsx`.";

function restrictedGlobal([name, why]) {
  return { name, message: why + ASK_INSTEAD };
}

function restrictedProperties(object) {
  return Object.entries(BLOCKED).map(([property, why]) => ({
    object,
    property,
    message: why + ASK_INSTEAD,
  }));
}

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
  {
    files: [RENDERER],
    rules: {
      "no-restricted-globals": ["error", ...Object.entries(BLOCKED).map(restrictedGlobal)],
      "no-restricted-properties": ["error", ...HOLDERS.flatMap(restrictedProperties)],
    },
  },
  // Last so it wins: turn off every eslint rule that fights prettier.
  prettier,
);

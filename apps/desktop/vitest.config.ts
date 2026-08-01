import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.js";

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      name: "desktop",
      coverage: {
        exclude: [
          "**/*.spec.ts",
          "**/*.d.ts",
          // The shared config excludes every `index.ts` because an entry point
          // is wiring. `preload.ts` is the same file in a different name: it
          // imports `electron`, calls `contextBridge.exposeInMainWorld` with a
          // literal, and decides nothing. Importing it outside Electron does
          // not work at all, so a test of it would have to mock away the only
          // two lines it has.
          "**/index.ts",
          "src/main/preload.ts",
        ],
      },
    },
  }),
);

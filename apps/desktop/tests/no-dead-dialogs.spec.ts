import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The ban on the three dialogs Electron does not give this window (plan 1.2).
 *
 * **This runs the repository's real config**, not a copy of the rule. A lint
 * rule is only worth anything if it fires during `pnpm lint`, and every way of
 * getting that wrong — the glob missing `.tsx`, the property form going
 * unnoticed, the block sitting after `prettier` and being turned off again —
 * looks exactly like a working config from the inside.
 */

const root = fileURLToPath(new URL("../../../", import.meta.url));
const eslint = new ESLint({ cwd: root });

async function rulesFiredIn(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "");
}

const RENDERER = "apps/desktop/src/renderer/probe.tsx";

describe("the renderer may not call prompt, confirm or alert", () => {
  it("catches the bare call", async () => {
    for (const name of ["prompt", "confirm", "alert"]) {
      expect(await rulesFiredIn(RENDERER, `${name}("x");\n`)).toContain("no-restricted-globals");
    }
  });

  it("catches it through globalThis, which is the form that shipped", async () => {
    // `globalThis.prompt?.("What are you recording?")` is what four controls
    // did. It type-checks, it lints clean under a globals-only rule, and it
    // answers nothing.
    const fired = await rulesFiredIn(RENDERER, `globalThis.prompt?.("x");\n`);
    expect(fired).toContain("no-restricted-properties");
  });

  it("catches it through window and self as well", async () => {
    expect(await rulesFiredIn(RENDERER, `window.confirm("x");\n`)).toContain(
      "no-restricted-properties",
    );
    expect(await rulesFiredIn(RENDERER, `self.alert("x");\n`)).toContain(
      "no-restricted-properties",
    );
  });

  it("says why, and what to use instead", async () => {
    const [result] = await eslint.lintText(`globalThis.prompt?.("x");\n`, {
      filePath: join(root, RENDERER),
    });
    const message = result?.messages.find((m) => m.ruleId === "no-restricted-properties")?.message;
    expect(message).toMatch(/does not implement/);
    expect(message).toMatch(/useDialogs/);
  });

  it("leaves alone a method of ours that happens to share the name", async () => {
    // The ban is on the platform's three, not on the word. `dialogs.confirm`
    // is the replacement, and a rule that flagged it would be a rule people
    // turn off.
    const fired = await rulesFiredIn(RENDERER, `dialogs.confirm(question);\n`);
    expect(fired).not.toContain("no-restricted-properties");
    expect(fired).not.toContain("no-restricted-globals");
  });

  it("is scoped to the renderer — the main process is Node and has no window", async () => {
    const fired = await rulesFiredIn(
      "apps/desktop/src/main/probe.ts",
      `globalThis.prompt?.("x");\n`,
    );
    expect(fired).not.toContain("no-restricted-properties");
  });
});

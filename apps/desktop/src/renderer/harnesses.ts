import type { Harness } from "@open-wiki/access";

/**
 * The harnesses the form offers (`harness-portability` 2.6), in one place.
 *
 * **A type-only import, and the list written out here.** `@open-wiki/access` is
 * restricted to type imports in the renderer: a value import pulls `node:fs`
 * into the browser bundle, which is the rule `languages.ts` already follows for
 * exactly the same reason. So this mirrors what the profile says rather than
 * reading it, and `tests/harness-form.spec.ts` asserts the two agree — a
 * mirrored list nobody checks is two answers to one question.
 *
 * The values are the `Harness` union itself, so a harness added to the profile
 * and forgotten here is a compile error rather than a form quietly missing an
 * option — which, given what this form decides, would be the plan's own bug.
 */
export const HARNESS_CHOICES: ReadonlyArray<{
  value: Harness;
  label: string;
  /** What choosing it puts in the directory, shown because it is committed. */
  detail: string;
}> = [
  { value: "claude", label: "Claude Code", detail: "CLAUDE.md, .claude/skills/" },
  { value: "codex", label: "Codex", detail: "AGENTS.md, .codex/skills/" },
  { value: "opencode", label: "opencode", detail: "AGENTS.md, .opencode/skills/" },
];

/**
 * Toggle one harness, keeping the result in the list's own order.
 *
 * Order is fixed rather than "the order they were ticked" so that two people
 * choosing the same set commit the same `ow.json` — a settings file that
 * differs only by array order is a diff nobody made.
 */
export function toggleHarness(current: readonly Harness[], h: Harness): Harness[] {
  return HARNESS_CHOICES.map((c) => c.value).filter((x) =>
    x === h ? !current.includes(x) : current.includes(x),
  );
}

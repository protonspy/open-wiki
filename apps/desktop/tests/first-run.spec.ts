import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canLeave, nextStep, STEPS, stepNumber } from "../src/renderer/first-run.js";

/**
 * The first run (plan desktop-ui 6.3): project, language, transcription, done.
 *
 * The order and what each step may refuse are the decisions; the rest is a
 * form. Step 1 is where the draft is overruled — it picks a **project**, not a
 * workspace, because a project *is* the directory `ow` opened
 * (`adr:0013`) and the registry is a cache and never truth (2.2).
 */

describe("STEPS (6.3)", () => {
  it("is the draft's four plus the harness step, in order", () => {
    // The harness step is 2.6 of `plans/harness-portability.md`, added after the
    // draft was written: the draft knew one harness, and a project may carry
    // several (`adr:0024`). It sits before the language because it decides
    // which entry files the language is then written into.
    expect(STEPS.map((s) => s.id)).toEqual([
      "project",
      "harness",
      "language",
      "transcription",
      "done",
    ]);
  });

  it("asks for a project rather than a workspace", () => {
    // The one place this plan wins over the draft, per its own table.
    const first = STEPS[0];
    expect(first?.title.toLowerCase()).toContain("project");
    expect(STEPS.map((s) => `${s.title} ${s.detail}`).join(" ")).not.toContain("workspace");
  });

  it("counts from one, because a person reads it", () => {
    expect(stepNumber("project")).toBe(1);
    expect(stepNumber("done")).toBe(5);
  });
});

describe("nextStep (6.3)", () => {
  it("walks forward", () => {
    expect(nextStep("project")).toBe("harness");
    expect(nextStep("harness")).toBe("language");
    expect(nextStep("language")).toBe("transcription");
    expect(nextStep("transcription")).toBe("done");
  });

  it("stops at the end rather than wrapping to the beginning", () => {
    expect(nextStep("done")).toBeNull();
  });
});

describe("canLeave (6.3)", () => {
  it("refuses a project with no name or no directory", () => {
    expect(canLeave("project", { name: "", directory: "C:/p" })).toBe(false);
    expect(canLeave("project", { name: "fenix", directory: "" })).toBe(false);
    expect(canLeave("project", { name: "  ", directory: "  " })).toBe(false);
  });

  it("lets a named project with a directory through", () => {
    expect(canLeave("project", { name: "fenix", directory: "C:/p/fenix" })).toBe(true);
  });

  it("never blocks the transcription step", () => {
    // Somebody who is not recording today should not be made to produce an API
    // key to reach a wiki.
    expect(canLeave("transcription", { name: "", directory: "" })).toBe(true);
  });

  it("never blocks the language step, which always has an answer", () => {
    // `adr:0008` makes English the default rather than an empty state.
    expect(canLeave("language", { name: "", directory: "" })).toBe(true);
  });
});

describe("the first run, as it ships (6.3)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/renderer/FirstRun.tsx", import.meta.url)),
    "utf8",
  );

  it("creates the project before it configures one", () => {
    // `createProject` takes the name, the directory *and* the language, so it
    // cannot run before step 2 — and a credential belongs to a project, so it
    // cannot be stored before one exists.
    expect(source).toContain("createProject");
    expect(source).toContain("saveCredentialFor");
  });

  it("names the project and never its path", () => {
    // 2.2 and 8.2's rule: the registry resolves a name, refuses an unknown one,
    // and degrades to a refusal for a directory that moved.
    //
    // This asserted the literal `name.trim()` until R3.6 made a project's name
    // the kebab-case of what was typed. That string was a proxy for the rule
    // rather than the rule, so what is asserted now is the rule: both address
    // the project by name, and the directory reaches neither.
    expect(source).toContain("saveCredentialFor(projectName");
    expect(source).toContain("openProject(projectName)");
    expect(source).not.toMatch(/saveCredentialFor\(directory/);
    expect(source).not.toMatch(/openProject\(directory/);
  });

  it("uses one name for creating, configuring and opening (R3.6)", () => {
    // Three calls name the same project. Two of them resolving a name the
    // registry never got would store the credential against nothing and refuse
    // to open the window, on the last step of somebody's first run.
    expect(source).toContain("const projectName = kebabCase(name)");
    expect(source).toContain("createProject(projectName");
  });

  it("says what skipping means rather than calling it Cancel", () => {
    // The same rule the recording box follows: a button that does something
    // says what it does.
    expect(source).toContain("Not recording yet — skip");
  });
});

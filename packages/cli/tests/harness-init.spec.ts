import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings } from "@open-wiki/access";
import { main, noHarnessChosen, noHarnessNamed, parseInitArgs } from "../src/main.js";
import { runInit } from "../src/commands/init.js";
import { hasTerminal } from "../src/commands/pick.js";

/**
 * `ow init` and the harnesses (2.3, 2.4, 2.5).
 *
 * The three-way contract comes from the plan's third divergence, not from
 * reading the parser: a harness named scaffolds it and asks nothing; none named
 * with a terminal attached opens the picker; none named and no terminal
 * refuses, naming the flags.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-hinit-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseInitArgs and the harness flags (2.3)", () => {
  it("accepts a harness spelled as its own flag", () => {
    expect(parseInitArgs(["--codex"]).harnesses).toEqual(["codex"]);
  });

  it("accepts more than one", () => {
    expect(parseInitArgs(["--claude", "--opencode"]).harnesses).toEqual(["claude", "opencode"]);
  });

  it("answers in a fixed order, whatever order they were given", () => {
    expect(parseInitArgs(["--opencode", "--claude"]).harnesses).toEqual(["claude", "opencode"]);
  });

  it("ignores a harness named twice", () => {
    expect(parseInitArgs(["--codex", "--codex"]).harnesses).toEqual(["codex"]);
  });

  it("names none when none was given", () => {
    expect(parseInitArgs([]).harnesses).toEqual([]);
    expect(parseInitArgs(["--language", "es"]).harnesses).toEqual([]);
  });

  it("does not mistake a harness name for the value of another flag", () => {
    // `--name codex` names the project, and says nothing about harnesses.
    expect(parseInitArgs(["--name", "codex"]).harnesses).toEqual([]);
    expect(parseInitArgs(["--name", "codex"]).name).toBe("codex");
  });

  it("leaves the other flags alone", () => {
    const opts = parseInitArgs(["--claude", "--language", "pt-BR", "--refresh-skills"]);
    expect(opts.language).toBe("pt-BR");
    expect(opts.refreshSkills).toBe(true);
    expect(opts.harnesses).toEqual(["claude"]);
  });
});

describe("scaffolding what was named, and asking nothing (2.3)", () => {
  it("writes only that harness's convention", () => {
    const result = runInit({ projectRoot: root, harnesses: ["codex"] });
    expect(result.harnesses).toEqual(["codex"]);
    expect(existsSync(join(root, ".codex", "skills", "wiki", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "wiki", "SKILL.md"))).toBe(false);
    expect(result.entryFiles.map((f) => f.split(/[\\/]/).at(-1))).toEqual(["AGENTS.md"]);
  });

  it("writes one AGENTS.md for Codex and opencode, and lists both their skills in it", () => {
    const result = runInit({ projectRoot: root, harnesses: ["codex", "opencode"] });
    expect(result.entryFiles.map((f) => f.split(/[\\/]/).at(-1))).toEqual(["AGENTS.md"]);
    const body = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(body).toContain(".codex/skills/wiki/SKILL.md");
    expect(body).toContain(".opencode/skills/wiki/SKILL.md");
  });

  it("makes CLAUDE.md a pointer when an AGENTS.md carries the convention", () => {
    runInit({ projectRoot: root, harnesses: ["claude", "codex"] });
    const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain("@AGENTS.md");
    expect(claude.length).toBeLessThan(readFileSync(join(root, "AGENTS.md"), "utf8").length);
  });

  it("records the harnesses in ow.json so a later run needs no answer", () => {
    runInit({ projectRoot: root, harnesses: ["opencode"] });
    expect(readSettings(root).harnesses).toEqual(["opencode"]);
  });
});

describe("no harness named, no terminal (2.5)", () => {
  it("refuses rather than guessing", async () => {
    // `main` sees no TTY under the test runner, which is the situation itself.
    const code = await main(["init"], root);
    expect(code).toBe(2);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(existsSync(join(root, "wiki"))).toBe(false);
  });

  it("names every flag it would have accepted", () => {
    const message = noHarnessNamed();
    expect(message).toContain("--claude");
    expect(message).toContain("--codex");
    expect(message).toContain("--opencode");
  });

  it("says why it refuses instead of defaulting", () => {
    // The reason is the point: a wrong scaffold is discovered by a colleague,
    // not by the person who ran the command.
    expect(noHarnessNamed()).toMatch(/clones|committed/i);
  });

  it("scaffolds without asking when a harness is named", async () => {
    expect(await main(["init", "--codex"], root)).toBe(0);
    expect(existsSync(join(root, ".codex", "skills", "wiki", "SKILL.md"))).toBe(true);
  });

  it("asks nothing on a re-run of a project that already recorded its harnesses", async () => {
    expect(await main(["init", "--codex"], root)).toBe(0);
    expect(await main(["init", "--language", "es"], root)).toBe(0);
    expect(readSettings(root).harnesses).toEqual(["codex"]);
    expect(readSettings(root).language).toBe("es");
  });

  it("asks nothing on a re-run of a project scaffolded before harnesses existed", async () => {
    // The regression a review caught: an `ow.json` with no `harnesses` key is a
    // project somebody scaffolded last month, not a new one. Reading both off
    // `harnesses.length === 0` made a headless `ow init --language pt-BR` in CI
    // exit 2 against every project created before this feature — which is the
    // opposite of the breaking change the plan actually declared, and it would
    // have been discovered by whoever's pipeline went red rather than by us.
    writeFileSync(
      join(root, "ow.json"),
      JSON.stringify({ language: "en", deleteWavAfterTranscription: true }),
      "utf8",
    );
    expect(await main(["init", "--language", "pt-BR"], root)).toBe(0);
    expect(readSettings(root).language).toBe("pt-BR");
    // And it keeps what such a project actually has on disk: Claude Code.
    expect(existsSync(join(root, ".claude", "skills", "wiki", "SKILL.md"))).toBe(true);
  });

  it("still asks when the directory holds no project at all", async () => {
    // The case the refusal is genuinely for, kept distinct from the one above.
    expect(existsSync(join(root, "ow.json"))).toBe(false);
    expect(await main(["init"], root)).toBe(2);
  });
});

describe("the picker (2.4)", () => {
  it("needs a person on both ends before it will run", () => {
    expect(hasTerminal({ stdin: { isTTY: true }, stdout: { isTTY: true } })).toBe(true);
    // Piped input with a terminal on stdout cannot drive a picker: it would sit
    // waiting for keystrokes nobody is typing.
    expect(hasTerminal({ stdin: {}, stdout: { isTTY: true } })).toBe(false);
    expect(hasTerminal({ stdin: { isTTY: true }, stdout: {} })).toBe(false);
    expect(hasTerminal({ stdin: {}, stdout: {} })).toBe(false);
  });

  it("treats choosing nothing as its own answer, with its own message", () => {
    const message = noHarnessChosen();
    expect(message).toMatch(/nothing was scaffolded/i);
    // Distinct from the headless refusal: this person was asked and answered.
    expect(message).not.toBe(noHarnessNamed());
  });
});

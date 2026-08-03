import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "@open-wiki/access";
import { main } from "../src/main.js";
import {
  formatPlan,
  needsConfirmation,
  parseUpdateArgs,
  runUpdate,
} from "../src/commands/update.js";
import { runInit } from "../src/commands/init.js";

/**
 * `ow update` — the plan a user is shown, and the confirmation before it runs
 * (5.3); gaining a harness through the same verb (5.4).
 *
 * The assertions come from those tasks: **print the plan grouped by outcome and
 * ask before applying, with the confirmation given up front for unattended
 * callers and a mode that reports and stops.**
 */

let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-update-"));
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const stdout = () => out.join("");
const stderr = () => err.join("");
const SKILL = ".claude/skills/wiki/SKILL.md";
const at = (rel: string) => join(root, ...rel.split("/"));

/** A project this build scaffolded, so the manifest knows what it wrote. */
function scaffolded(harnesses: ("claude" | "codex" | "opencode")[] = ["claude"]): void {
  runInit({ projectRoot: root, harnesses });
}

describe("parseUpdateArgs", () => {
  it("reads the harness flags, --yes and --dry-run", () => {
    expect(parseUpdateArgs(["--codex", "--yes"])).toEqual({
      harnesses: ["codex"],
      yes: true,
      dryRun: false,
      adopt: false,
    });
    expect(parseUpdateArgs(["--dry-run"]).dryRun).toBe(true);
    expect(parseUpdateArgs(["-y"]).yes).toBe(true);
  });

  it("defaults to no harnesses, which means whatever the project carries", () => {
    expect(parseUpdateArgs([]).harnesses).toEqual([]);
  });
});

describe("the plan a user is shown (5.3)", () => {
  it("names what it would rewrite", () => {
    scaffolded();
    writeFileSync(at(SKILL), "what an older build wrote\n", "utf8");
    // Record that older content as ours, which is what an older build left.
    runUpdate({ projectRoot: root, dryRun: true });
    const plan = formatPlan(runUpdate({ projectRoot: root, dryRun: true }).plan);
    expect(plan).toMatch(/to update|yours/);
  });

  it("names the files it is leaving alone, and says they are the user's", () => {
    // The list the whole verb is careful about. A user who does not see it
    // cannot tell their edits survived on purpose rather than by luck.
    scaffolded();
    writeFileSync(at(SKILL), "mine\n", "utf8");
    const text = formatPlan(runUpdate({ projectRoot: root, dryRun: true }).plan);
    expect(text).toContain(SKILL);
    expect(text).toMatch(/yours/);
    expect(text).toMatch(/left alone/);
  });

  it("says so plainly when there is nothing to do", () => {
    scaffolded();
    expect(formatPlan(runUpdate({ projectRoot: root, dryRun: true }).plan)).toContain(
      "nothing to do",
    );
  });
});

describe("asking before applying (5.3)", () => {
  it("reports and stops on --dry-run, changing nothing", async () => {
    scaffolded();
    writeFileSync(at(SKILL), "older\n", "utf8");
    runUpdate({ projectRoot: root, harnesses: [] }); // record `older` as ours
    writeFileSync(at(SKILL), "older\n", "utf8");

    const before = readFileSync(at(SKILL), "utf8");
    expect(await main(["update", "--dry-run"], root)).toBe(0);
    expect(readFileSync(at(SKILL), "utf8")).toBe(before);
  });

  it("refuses to apply with no confirmation and no terminal, naming both ways forward", async () => {
    scaffolded();
    rmSync(at(SKILL));

    expect(await main(["update"], root)).toBe(2);
    expect(stderr()).toContain("--yes");
    expect(stderr()).toContain("--dry-run");
    expect(existsSync(at(SKILL))).toBe(false);
  });

  it("applies when the confirmation is given up front", async () => {
    scaffolded();
    rmSync(at(SKILL));

    expect(await main(["update", "--yes"], root)).toBe(0);
    expect(existsSync(at(SKILL))).toBe(true);
    expect(stdout()).toContain("updated");
  });

  it("prints the plan before it applies, not only after", async () => {
    // A verb that rewrites files and reports afterwards is one a user has to
    // `git diff` to understand.
    scaffolded();
    rmSync(at(SKILL));
    await main(["update", "--yes"], root);
    expect(stdout().indexOf("to add")).toBeLessThan(stdout().indexOf("updated"));
  });

  it("succeeds and asks nothing when there is nothing to do", async () => {
    scaffolded();
    expect(await main(["update"], root)).toBe(0);
    expect(stderr()).toBe("");
  });

  it("names both ways forward in the refusal, not only the one that writes", () => {
    // A caller with no terminal is as likely to want the report as the write.
    expect(needsConfirmation()).toContain("--yes");
    expect(needsConfirmation()).toContain("--dry-run");
  });
});

describe("gaining a harness through the same verb (5.4)", () => {
  it("writes the new harness's convention and records it", async () => {
    scaffolded(["claude"]);
    expect(await main(["update", "--codex", "--yes"], root)).toBe(0);

    expect(existsSync(at(".codex/skills/wiki/SKILL.md"))).toBe(true);
    expect(existsSync(at("AGENTS.md"))).toBe(true);
    expect(readSettings(root).harnesses).toEqual(["claude", "codex"]);
  });

  it("installs the new harness's gate too", async () => {
    // A convention with no gate beside it is half a scaffold, and `ow init`
    // would have installed both.
    scaffolded(["claude"]);
    await main(["update", "--codex", "--yes"], root);
    expect(existsSync(at(".codex/hooks.json"))).toBe(true);
  });

  it("adds rather than replaces, so the first harness survives", async () => {
    scaffolded(["claude"]);
    await main(["update", "--codex", "--yes"], root);
    expect(existsSync(at(SKILL))).toBe(true);
    expect(readSettings(root).harnesses).toContain("claude");
  });

  it("does not record the harness when nothing was applied", async () => {
    // A project claiming a harness whose convention never landed is this plan's
    // own bug. `--dry-run` must leave `ow.json` alone.
    scaffolded(["claude"]);
    await main(["update", "--codex", "--dry-run"], root);
    expect(readSettings(root).harnesses).toEqual(["claude"]);
    expect(existsSync(at(".codex/skills/wiki/SKILL.md"))).toBe(false);
  });

  it("does not rewrite the gate of a harness it is not adding", async () => {
    // **What a code review reproduced by execution.** `writeOpencodePlugin`
    // overwrites unconditionally and the gate is not hash-tracked, so
    // installing for every *recorded* harness meant an ordinary update —
    // triggered by a stale skill somewhere else — silently destroyed a
    // hand-edited opencode plugin that appeared in neither the plan nor the
    // report. 5.2's promise, broken through the one door that does not go past
    // the planner.
    scaffolded(["claude", "opencode"]);
    const plugin = at(".opencode/plugin/open-wiki.ts");
    writeFileSync(plugin, "// my own hardening\n", "utf8");

    rmSync(at(SKILL)); // something legitimate to do, on an unrelated file
    expect(await main(["update", "--yes"], root)).toBe(0);

    expect(existsSync(at(SKILL))).toBe(true);
    expect(readFileSync(plugin, "utf8")).toBe("// my own hardening\n");
  });
});

describe("a project that predates the record (--adopt)", () => {
  /**
   * The installed base. No `.state/managed.json` has ever been written by a
   * published build, so every managed file is `unknown` — and `unknown` is
   * never written. A review pointed out that this made `ow update` report
   * "nothing to do" to exactly the users the feature was framed as fixing.
   */
  function legacyProject(): void {
    scaffolded(["claude"]);
    rmSync(join(root, ".state", "managed.json"), { force: true });
    writeFileSync(at(SKILL), "what an older build shipped\n", "utf8");
  }

  it("does not claim there is nothing to do when it simply cannot tell", async () => {
    legacyProject();
    expect(await main(["update"], root)).toBe(0);
    expect(stdout()).toContain("nothing to do safely");
    expect(stdout()).toContain("--adopt");
  });

  it("still refuses to touch those files without being asked", async () => {
    legacyProject();
    await main(["update", "--yes"], root);
    expect(readFileSync(at(SKILL), "utf8")).toBe("what an older build shipped\n");
  });

  it("takes them over when the user asks, and brings them current", async () => {
    legacyProject();
    expect(await main(["update", "--adopt", "--yes"], root)).toBe(0);
    expect(readFileSync(at(SKILL), "utf8")).not.toBe("what an older build shipped\n");
    expect(readFileSync(at(SKILL), "utf8")).toContain("open-wiki-version:");
  });

  it("records what it adopted, so the next run is an ordinary one", async () => {
    legacyProject();
    await main(["update", "--adopt", "--yes"], root);
    out.length = 0;
    await main(["update"], root);
    expect(stdout()).toContain("nothing to do");
    expect(stdout()).not.toContain("--adopt");
  });
});

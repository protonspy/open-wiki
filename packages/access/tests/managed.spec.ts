import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderConvention } from "../src/render.js";
import {
  planUpdate,
  readManagedManifest,
  recordManaged,
  type UpdateOutcome,
} from "../src/update/managed.js";

/**
 * `ow update`'s three-way answer (plan `harness-portability.md` 5.1).
 *
 * **Written first and watched fail.** The whole value is in the third bucket:
 * telling *the user edited this* apart from *this is out of date* is what stops
 * the verb overwriting something somebody wrote by hand. A two-way comparison —
 * disk against what this build renders — cannot tell them apart at all: both
 * look like "differs". The manifest is what makes it answerable, and it is the
 * reason this task is `(TDD)` rather than `(Unit)`.
 *
 * The assertions come from that requirement, never from the shape of whatever
 * `planUpdate` happens to return.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-managed-"));
  mkdirSync(join(root, ".state"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write a managed file exactly as this build renders it, and record that. */
function scaffoldAsCurrent(harness: "claude" | "codex" | "opencode" = "claude"): void {
  for (const [rel, content] of Object.entries(renderConvention([harness]))) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  recordManaged(root, renderConvention([harness]));
}

const outcomeFor = (
  plan: { files: Array<{ path: string; outcome: UpdateOutcome }> },
  rel: string,
) => plan.files.find((f) => f.path === rel)?.outcome;

const SKILL = ".claude/skills/wiki/SKILL.md";

describe("the three buckets (5.1)", () => {
  it("calls a file this build would write identically unchanged", () => {
    scaffoldAsCurrent();
    const plan = planUpdate(root, ["claude"]);
    expect(outcomeFor(plan, SKILL)).toBe("unchanged");
  });

  it("calls a file still exactly as we last wrote it updatable when the build has moved on", () => {
    scaffoldAsCurrent();
    // What an older build left: on disk *and* in the manifest, agreeing with
    // each other and not with what this build renders.
    writeFileSync(join(root, ...SKILL.split("/")), "old text\n", "utf8");
    recordManaged(root, { [SKILL]: "old text\n" });

    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("updatable");
  });

  it("calls a file that differs from what we recorded edited", () => {
    // **The bucket the whole task is for.** Disk disagrees with the manifest,
    // so somebody changed it after we wrote it — and this is the answer a
    // two-way comparison cannot give.
    scaffoldAsCurrent();
    writeFileSync(join(root, ...SKILL.split("/")), "somebody's own text\n", "utf8");

    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("edited");
  });

  it("still calls it edited when the build has also moved on", () => {
    // Both changed. This is where a two-way comparison is not merely unhelpful
    // but wrong: it would report "out of date" and overwrite the edit.
    scaffoldAsCurrent();
    writeFileSync(join(root, ...SKILL.split("/")), "somebody's own text\n", "utf8");
    recordManaged(root, { [SKILL]: "what an older build wrote\n" });

    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("edited");
  });

  it("calls a file we never recorded unknown, not updatable", () => {
    // A project scaffolded before the manifest existed. We cannot tell whether
    // its content is ours or somebody's, and guessing "ours" would overwrite an
    // edit made in every such project. Unknown is a real answer.
    for (const [rel, content] of Object.entries(renderConvention(["claude"]))) {
      const file = join(root, ...rel.split("/"));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content === undefined ? "" : "older text\n", "utf8");
    }
    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("unknown");
  });

  it("calls a managed file that is gone missing", () => {
    scaffoldAsCurrent();
    rmSync(join(root, ...SKILL.split("/")));
    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("missing");
  });

  it("covers every file the convention renders, and no others", () => {
    scaffoldAsCurrent();
    const plan = planUpdate(root, ["claude"]);
    expect(plan.files.map((f) => f.path).sort()).toEqual(
      Object.keys(renderConvention(["claude"])).sort(),
    );
  });
});

describe("the manifest", () => {
  it("starts empty rather than absent, so a fresh project is not 'unknown' forever", () => {
    expect(readManagedManifest(root).files).toEqual({});
  });

  it("records what was written, and reading it back gives the same answer", () => {
    recordManaged(root, { [SKILL]: "text\n" });
    expect(Object.keys(readManagedManifest(root).files)).toEqual([SKILL]);
  });

  it("does not store the file, only enough to compare", () => {
    // A copy of every managed file in `.state` would be a second source of
    // truth for content the project already holds, and it would go stale.
    recordManaged(root, { [SKILL]: "text\n" });
    expect(JSON.stringify(readManagedManifest(root))).not.toContain("text\n");
  });

  it("keeps a record for a file this run did not write", () => {
    // `ow init --codex` on a Claude Code project records Codex's files and must
    // not forget Claude Code's — 5.4's whole shape depends on this.
    recordManaged(root, { [SKILL]: "text\n" });
    recordManaged(root, { ".codex/skills/wiki/SKILL.md": "text\n" });
    expect(Object.keys(readManagedManifest(root).files).sort()).toEqual([
      ".claude/skills/wiki/SKILL.md",
      ".codex/skills/wiki/SKILL.md",
    ]);
  });

  it("survives a manifest that will not parse, rather than taking the run down", () => {
    // It is a cache of hashes, and the honest degradation is "we do not know",
    // which is already a bucket. Refusing to run would make a corrupt state file
    // block an update the user needs.
    writeFileSync(join(root, ".state", "managed.json"), "{ not json", "utf8");
    expect(readManagedManifest(root).files).toEqual({});
    expect(outcomeFor(planUpdate(root, ["claude"]), SKILL)).toBe("missing");
  });
});

describe("the plan a user is shown (5.3)", () => {
  it("groups the files by outcome", () => {
    scaffoldAsCurrent();
    writeFileSync(join(root, ...SKILL.split("/")), "somebody's own text\n", "utf8");
    const plan = planUpdate(root, ["claude"]);
    expect(plan.byOutcome.edited).toContain(SKILL);
    expect(plan.byOutcome.unchanged.length).toBeGreaterThan(0);
  });

  it("says whether there is anything to do at all", () => {
    scaffoldAsCurrent();
    expect(planUpdate(root, ["claude"]).hasWork).toBe(false);

    writeFileSync(join(root, ...SKILL.split("/")), "old\n", "utf8");
    recordManaged(root, { [SKILL]: "old\n" });
    expect(planUpdate(root, ["claude"]).hasWork).toBe(true);
  });

  it("does not count an edited file as work, because it will not be touched", () => {
    // 5.2: an edited file is kept and named, never merged and never replaced.
    // Counting it as work would make `ow update` report something to do that it
    // then declines to do, every single run.
    scaffoldAsCurrent();
    writeFileSync(join(root, ...SKILL.split("/")), "somebody's own text\n", "utf8");
    expect(planUpdate(root, ["claude"]).hasWork).toBe(false);
  });
});

describe("gaining a harness through the same verb (5.4)", () => {
  it("reports the new harness's files as missing, which is work", () => {
    scaffoldAsCurrent("claude");
    const plan = planUpdate(root, ["claude", "codex"]);
    expect(outcomeFor(plan, ".codex/skills/wiki/SKILL.md")).toBe("missing");
    expect(plan.hasWork).toBe(true);
  });

  it("leaves the harness it already had alone", () => {
    scaffoldAsCurrent("claude");
    const plan = planUpdate(root, ["claude", "codex"]);
    expect(outcomeFor(plan, SKILL)).toBe("unchanged");
  });
});

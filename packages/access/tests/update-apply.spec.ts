import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderConvention } from "../src/render.js";
import { applyUpdate } from "../src/update/apply.js";
import { hashOf, planUpdate, readManagedManifest, recordManaged } from "../src/update/managed.js";

/**
 * Applying an update (5.2), and gaining a harness through the same verb (5.4).
 *
 * The requirement, from the task: an edited file is **kept and named, never
 * merged and never silently replaced**, and stays recorded at the version last
 * written — which is the base revision a three-way merge would need later.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-apply-"));
  mkdirSync(join(root, ".state"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const SKILL = ".claude/skills/wiki/SKILL.md";
const at = (rel: string) => join(root, ...rel.split("/"));

function scaffoldAsCurrent(harness: "claude" | "codex" = "claude"): void {
  const files = renderConvention([harness]);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(at(rel), ".."), { recursive: true });
    writeFileSync(at(rel), content, "utf8");
  }
  recordManaged(root, files);
}

describe("an edited file is kept and named (5.2)", () => {
  beforeEach(() => {
    scaffoldAsCurrent();
    writeFileSync(at(SKILL), "somebody's own text\n", "utf8");
  });

  it("leaves the file exactly as it was", () => {
    applyUpdate(root, ["claude"]);
    expect(readFileSync(at(SKILL), "utf8")).toBe("somebody's own text\n");
  });

  it("names it, rather than counting it", () => {
    // "3 files kept" tells a user nothing they can act on.
    expect(applyUpdate(root, ["claude"]).kept).toContain(SKILL);
  });

  it("does not write it, and does not report writing it", () => {
    expect(applyUpdate(root, ["claude"]).written).not.toContain(SKILL);
  });

  it("keeps the recorded hash at the version this product last wrote", () => {
    // **The base revision.** Re-recording the user's content as though we had
    // written it would destroy the one fact a three-way merge would need — and
    // would silently make the file `updatable` next run, turning "never touched"
    // into "touched the second time".
    const before = readManagedManifest(root).files[SKILL]?.hash;
    applyUpdate(root, ["claude"]);
    expect(readManagedManifest(root).files[SKILL]?.hash).toBe(before);
    expect(readManagedManifest(root).files[SKILL]?.hash).not.toBe(hashOf("somebody's own text\n"));
  });

  it("stays edited on a second run, rather than becoming updatable", () => {
    applyUpdate(root, ["claude"]);
    applyUpdate(root, ["claude"]);
    expect(readFileSync(at(SKILL), "utf8")).toBe("somebody's own text\n");
    expect(planUpdate(root, ["claude"]).byOutcome.edited).toContain(SKILL);
  });

  it("writes no backup copy beside it", () => {
    // Keeping means keeping. A `.orig` left in the project is a file nobody
    // asked for, in a directory the harness reads.
    applyUpdate(root, ["claude"]);
    expect(existsSync(`${at(SKILL)}.orig`)).toBe(false);
    expect(existsSync(`${at(SKILL)}.bak`)).toBe(false);
  });
});

describe("a file we have no record of is kept too", () => {
  it("is named, not overwritten", () => {
    // A project scaffolded before the manifest existed. Guessing that its
    // content is ours would overwrite an edit in every such project.
    for (const [rel] of Object.entries(renderConvention(["claude"]))) {
      mkdirSync(join(at(rel), ".."), { recursive: true });
      writeFileSync(at(rel), "from an older build, possibly edited\n", "utf8");
    }
    const result = applyUpdate(root, ["claude"]);
    expect(result.kept).toContain(SKILL);
    expect(readFileSync(at(SKILL), "utf8")).toBe("from an older build, possibly edited\n");
  });
});

describe("what it does write", () => {
  it("brings an out-of-date file to what this build renders", () => {
    scaffoldAsCurrent();
    writeFileSync(at(SKILL), "what an older build wrote\n", "utf8");
    recordManaged(root, { [SKILL]: "what an older build wrote\n" });

    expect(applyUpdate(root, ["claude"]).written).toContain(SKILL);
    expect(readFileSync(at(SKILL), "utf8")).toBe(renderConvention(["claude"])[SKILL]);
  });

  it("records what it wrote, so the next run calls it unchanged", () => {
    scaffoldAsCurrent();
    writeFileSync(at(SKILL), "old\n", "utf8");
    recordManaged(root, { [SKILL]: "old\n" });

    applyUpdate(root, ["claude"]);
    expect(planUpdate(root, ["claude"]).byOutcome.unchanged).toContain(SKILL);
  });

  it("writes nothing at all when there is nothing to do", () => {
    scaffoldAsCurrent();
    expect(applyUpdate(root, ["claude"]).written).toEqual([]);
  });
});

describe("a link is never a file this product writes — including the manifest", () => {
  /**
   * `recordManaged` was the one writer that had not learned this. `seedWiki`
   * learned it in `open-wiki` 1.3, `applyUpdate` and `writeEntryFiles` after
   * it — and `assertWithin` does not cover it, because it resolves a link and
   * answers about the *target*. A link planted at `.state/managed.json` and
   * pointing anywhere else in the project passed that check, and the write
   * landed on whatever it named.
   */
  const canSymlink = (): boolean => {
    try {
      const probe = join(root, "probe-link");
      symlinkSync(join(root, "nowhere"), probe);
      rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  };

  it.skipIf(!canSymlink())("refuses a symlinked manifest rather than writing through it", () => {
    const victim = join(root, "wiki", "index.md");
    mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(victim, "# the index\n", "utf8");
    rmSync(join(root, ".state", "managed.json"), { force: true });
    symlinkSync(victim, join(root, ".state", "managed.json"));

    expect(() => recordManaged(root, { [SKILL]: "text\n" })).toThrow(/symbolic link/i);
    expect(readFileSync(victim, "utf8")).toBe("# the index\n");
  });

  it.skipIf(!canSymlink())(
    "classifies a symlinked managed file as unknown, so it is never written",
    () => {
      // The read path has to be guarded the same way the write path is, or a file
      // is classified from one place and rewritten at another — the class of bug
      // groups 3 and 4 each shipped once.
      scaffoldAsCurrent();
      rmSync(at(SKILL));
      symlinkSync(join(root, "..", "outside.md"), at(SKILL));

      const plan = planUpdate(root, ["claude"]);
      expect(plan.byOutcome.unknown).toContain(SKILL);
      expect(applyUpdate(root, ["claude"], "en", plan).written).not.toContain(SKILL);
    },
  );
});

describe("gaining a harness through the same verb (5.4)", () => {
  it("writes the new harness's convention", () => {
    scaffoldAsCurrent("claude");
    const result = applyUpdate(root, ["claude", "codex"]);
    expect(existsSync(at(".codex/skills/wiki/SKILL.md"))).toBe(true);
    expect(result.written).toContain(".codex/skills/wiki/SKILL.md");
  });

  it("leaves the harness the project already had alone", () => {
    scaffoldAsCurrent("claude");
    const before = readFileSync(at(SKILL), "utf8");
    applyUpdate(root, ["claude", "codex"]);
    expect(readFileSync(at(SKILL), "utf8")).toBe(before);
  });

  it("does not forget the first harness's record when recording the second", () => {
    // A replace rather than a merge here would make every Claude Code file
    // `unknown` on the next run — and `unknown` is never written, so the project
    // would quietly stop being updatable at all.
    scaffoldAsCurrent("claude");
    applyUpdate(root, ["claude", "codex"]);
    expect(Object.keys(readManagedManifest(root).files)).toContain(SKILL);
    expect(planUpdate(root, ["claude", "codex"]).byOutcome.unknown).toEqual([]);
  });

  it("keeps an edited file while adding the new harness", () => {
    scaffoldAsCurrent("claude");
    writeFileSync(at(SKILL), "mine\n", "utf8");
    const result = applyUpdate(root, ["claude", "codex"]);
    expect(readFileSync(at(SKILL), "utf8")).toBe("mine\n");
    expect(result.kept).toContain(SKILL);
    expect(result.written.length).toBeGreaterThan(0);
  });
});

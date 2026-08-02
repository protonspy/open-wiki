import { FINDING_CODES, type Finding, type FindingCode } from "@open-wiki/access";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAMILIES, familyOf, groupFindings, whereOf } from "../src/renderer/families.js";

/**
 * The checks pane (plan desktop-ui 5.2): the findings 7.6 already produces,
 * given the draft's shape.
 *
 * What is asserted is the arranging, because that is the only thing here that
 * is a decision — the findings themselves are `@open-wiki/access`'s and are
 * tested there.
 */

function finding(code: FindingCode, over: Partial<Finding> = {}): Finding {
  return {
    code,
    severity: "error",
    message: `${code} happened`,
    fix: "do the thing",
    ...over,
  };
}

describe("familyOf (5.2)", () => {
  it("puts every code the store can report in a group", () => {
    // A code added to `FINDING_CODES` and forgotten in the map would render in
    // no group at all, which is the same as not reporting it. The type makes
    // that a compile error; this makes it a red test as well, because the map
    // is what a future code has to be added to and nothing else says so.
    for (const code of FINDING_CODES) {
      expect(FAMILIES).toContain(familyOf(code));
    }
  });

  it("groups the three link checks together, under the task that owns them", () => {
    for (const code of ["wikilink.broken", "page.orphan", "page.duplicate-slug"] as const) {
      expect(familyOf(code)).toMatchObject({ key: "links", task: "7.1" });
    }
  });

  it("keeps the schema apart from the links, because they are fixed differently", () => {
    expect(familyOf("page.invalid").key).toBe("schema");
    expect(familyOf("codewiki.citation-unresolved").key).toBe("codewiki");
    expect(familyOf("glossary.synonym").key).toBe("vocabulary");
    expect(familyOf("source.uncited").key).toBe("records");
  });
});

describe("groupFindings (5.2)", () => {
  it("returns the groups in a fixed order, whatever order they were found in", () => {
    // The pane must not rearrange itself between two runs of the same check.
    const groups = groupFindings([
      finding("glossary.synonym"),
      finding("wikilink.broken"),
      finding("provenance.unresolved"),
    ]);
    expect(groups.map((g) => g.family.key)).toEqual(["links", "provenance", "vocabulary"]);
  });

  it("leaves out a family with nothing in it, rather than heading an empty list", () => {
    const groups = groupFindings([finding("wikilink.broken")]);
    expect(groups).toHaveLength(1);
  });

  it("puts an error above a warning inside a group", () => {
    const groups = groupFindings([
      finding("page.orphan", { severity: "warning", page: "wiki/a.md" }),
      finding("wikilink.broken", { severity: "error", page: "wiki/b.md" }),
    ]);
    expect(groups[0]?.findings.map((f) => f.severity)).toEqual(["error", "warning"]);
  });

  it("has nothing to show for a project with no findings", () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe("whereOf (5.2)", () => {
  it("names the page and the line the finding sits on", () => {
    expect(whereOf(finding("wikilink.broken", { page: "wiki/fenix.md", line: 24 }))).toBe(
      "wiki/fenix.md:24",
    );
  });

  it("names the page alone when the check could not point at a line", () => {
    expect(whereOf(finding("page.orphan", { page: "wiki/fenix.md" }))).toBe("wiki/fenix.md");
  });

  it("names the source, for a finding that is about one", () => {
    expect(whereOf(finding("source.uncited", { source: "fenix-weekly-2026-07-31" }))).toBe(
      "fenix-weekly-2026-07-31",
    );
  });

  it("says nothing rather than guessing, for a finding about neither", () => {
    // A location nobody can act on is better absent than invented.
    expect(whereOf(finding("glossary.conflict"))).toBe("");
  });
});

describe("the checks pane, as it ships (5.2)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/renderer/ChecksPane.tsx", import.meta.url)),
    "utf8",
  );

  it("shows the fix the finding already carries, and never one of its own", () => {
    // 7.6's rule, and 9.13's: the message has three mouths and they have to say
    // the same thing.
    expect(source).toContain("{finding.fix}");
    expect(source).toContain("{finding.message}");
  });

  it("tells an error from a warning by shape as well as by colour", () => {
    expect(source).toContain("CircleAlert");
    expect(source).toContain("TriangleAlert");
  });
});

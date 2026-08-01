import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProvenance } from "../src/store/provenance.js";
import { registerSource } from "../src/sources/register.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-prov-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("resolveProvenance (5.4)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("a"),
    });
    registerSource(root, { name: "Fenix weekly 2026-07-31", kind: "recording", content: null });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a citation whose id climbs out of raw/ — an id is not a path", () => {
    // `parseLink` takes everything before the `#` as the id, so a page can put
    // a traversal there. Answering it against the filesystem outside `raw/`
    // would make an accepted page an existence oracle for the machine.
    const issues = resolveProvenance(root, [
      "src://../../etc#p1",
      "src://..#p1",
      "rec://../../..#14:32",
    ]);
    expect(issues).toHaveLength(3);
    for (const issue of issues) expect(issue.reason).toContain("points at no source");
  });

  it("reports nothing when every citation points at an existing source", () => {
    const sources = ["src://arquitetura-fenix.pdf#p12", "rec://fenix-weekly-2026-07-31#14:32"];
    expect(resolveProvenance(root, sources)).toEqual([]);
  });

  it("refuses a file citation whose source does not exist, naming the link", () => {
    const issues = resolveProvenance(root, ["src://ghost.pdf#p1"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("provenance");
    expect(issues[0]!.reason).toContain("src://ghost.pdf#p1");
    expect(issues[0]!.reason).toMatch(/no source/i);
  });

  it("refuses a recording citation whose source does not exist", () => {
    const issues = resolveProvenance(root, ["rec://missing-2026-01-01#00:00"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toContain("rec://missing-2026-01-01#00:00");
  });

  it("refuses a recording citation with a malformed instant, even when the source exists", () => {
    const issues = resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#noon"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/instant/i);
  });

  it("refuses a file citation with a non-page fragment", () => {
    const issues = resolveProvenance(root, ["src://arquitetura-fenix.pdf#page12"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/page/i);
  });

  it("reports each broken citation separately", () => {
    const issues = resolveProvenance(root, ["src://ghost.pdf#p1", "src://phantom.pdf#p2"]);
    expect(issues).toHaveLength(2);
  });
});

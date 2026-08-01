import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordWrite, type WriteEntry } from "../src/store/record.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-rec-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  return root;
}

const CREATED: WriteEntry = {
  slug: "fenix",
  action: "created",
  origin: "hook",
  date: "2026-08-01",
};
const MODIFIED: WriteEntry = {
  slug: "ana",
  action: "modified",
  origin: "editor",
  date: "2026-08-01",
};
const SUPERSEDED: WriteEntry = {
  slug: "fenix",
  action: "superseded",
  origin: "cli",
  date: "2026-08-02",
  replacementSlug: "fenix-2",
};

describe("recordWrite — log.md (5.6)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates log.md with a header when absent and appends the line", () => {
    recordWrite(root, CREATED);
    const text = readFileSync(join(root, "wiki", "log.md"), "utf8");
    expect(text).toContain("# Log");
    expect(text).toContain("- 2026-08-01 hook — created [[fenix]]");
  });

  it("appends further writes in order, newest last", () => {
    recordWrite(root, CREATED);
    recordWrite(root, MODIFIED);
    const text = readFileSync(join(root, "wiki", "log.md"), "utf8");
    const createdIdx = text.indexOf("created [[fenix]]");
    const modifiedIdx = text.indexOf("modified [[ana]]");
    expect(modifiedIdx).toBeGreaterThan(createdIdx);
  });

  it("records a supersession with the replacement", () => {
    recordWrite(root, SUPERSEDED);
    expect(readFileSync(join(root, "wiki", "log.md"), "utf8")).toContain(
      "- 2026-08-02 cli — superseded [[fenix → fenix-2]]",
    );
  });
});

describe("recordWrite — changelog.md (5.6)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates changelog.md with its header and a dated section, newest first", () => {
    recordWrite(root, CREATED);
    const text = readFileSync(join(root, "wiki", "changelog.md"), "utf8");
    expect(text).toContain("# Changelog");
    expect(text).toContain("## 2026-08-01");
    expect(text).toContain("- Created [[fenix]].");
  });

  it("prepends a new entry to an existing same-date section", () => {
    recordWrite(root, CREATED);
    recordWrite(root, MODIFIED);
    const text = readFileSync(join(root, "wiki", "changelog.md"), "utf8");
    const anaIdx = text.indexOf("- Updated [[ana]].");
    const fenixIdx = text.indexOf("- Created [[fenix]].");
    // Both under 2026-08-01; newest entry first.
    expect(anaIdx).toBeLessThan(fenixIdx);
    expect(anaIdx).toBeGreaterThan(text.indexOf("## 2026-08-01"));
  });

  it("places a newer date section above an older one", () => {
    recordWrite(root, CREATED); // 2026-08-01
    recordWrite(root, SUPERSEDED); // 2026-08-02
    const text = readFileSync(join(root, "wiki", "changelog.md"), "utf8");
    const newIdx = text.indexOf("## 2026-08-02");
    const oldIdx = text.indexOf("## 2026-08-01");
    expect(newIdx).toBeLessThan(oldIdx);
    expect(text).toContain("- Superseded [[fenix]] with [[fenix-2]].");
  });

  it("does not disturb an existing hand-written changelog header", () => {
    writeFileSync(
      join(root, "wiki", "changelog.md"),
      "# Changelog\n\nWhat changed in the wiki, newest first.\n\n## 2026-07-31\n\n- Started.\n",
    );
    recordWrite(root, CREATED);
    const text = readFileSync(join(root, "wiki", "changelog.md"), "utf8");
    expect(text).toContain("## 2026-07-31");
    expect(text).toContain("- Started.");
    // Newer date on top.
    expect(text.indexOf("## 2026-08-01")).toBeLessThan(text.indexOf("## 2026-07-31"));
  });
});

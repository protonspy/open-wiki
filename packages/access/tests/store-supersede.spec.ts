import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supersedePage } from "../src/store/supersede.js";
import { writePage } from "../src/write/atomic-write.js";
import { listOperations } from "../src/write/log.js";
import { validatePage } from "../src/store/page.js";

const VALID = [
  "---",
  "id: project:fenix",
  "type: project",
  "title: Fenix",
  "status: active",
  "aliases: [fenix platform]",
  "updated: 2026-07-31",
  "sources: [src://arquitetura-fenix.pdf#p12]",
  'superseded-by: ""',
  "---",
  "",
  "# Fenix",
  "",
  "The platform. See [[ana]].",
  "",
].join("\n");

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-supersede-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

describe("supersedePage (5.2)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writePage(root, join("wiki", "fenix.md"), VALID, "editor");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records status, superseded-by and the date on the replaced page, leaving the body intact", () => {
    const result = supersedePage(
      root,
      join("wiki", "fenix.md"),
      "project:fenix-2",
      "2026-08-01",
      "cli",
    );
    expect(result.ok).toBe(true);

    const onDisk = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    expect(onDisk).toContain("status: superseded");
    expect(onDisk).toContain("superseded-by: project:fenix-2");
    expect(onDisk).toContain("updated: 2026-08-01");
    // The prose the agent wrote is untouched — only the three fields move.
    expect(onDisk).toContain("# Fenix");
    expect(onDisk).toContain("See [[ana]].");
  });

  it("the rewritten page still passes the schema (5.1)", () => {
    supersedePage(root, join("wiki", "fenix.md"), "project:fenix-2", "2026-08-01", "cli");
    const onDisk = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    expect(validatePage(onDisk, "fenix").ok).toBe(true);
  });

  it("goes through the safe write — an operation is logged", () => {
    const result = supersedePage(
      root,
      join("wiki", "fenix.md"),
      "project:fenix-2",
      "2026-08-01",
      "hook",
    );
    expect(result.ok).toBe(true);
    const ops = listOperations(root);
    expect(ops.length).toBe(2); // the seed write, then the supersession
    expect(ops[1]!.origin).toBe("hook");
    expect(ops[1]!.pages[0]!.existed).toBe(true); // it modified, not created
  });

  it("refuses when the page to supersede does not exist", () => {
    const result = supersedePage(
      root,
      join("wiki", "ghost.md"),
      "project:fenix-2",
      "2026-08-01",
      "cli",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /no such page/i.test(e.reason))).toBe(true);
    // And nothing was written.
    expect(existsSync(join(root, "wiki", "ghost.md"))).toBe(false);
  });

  it("refuses a replacement id that is not type:slug, and does not write", () => {
    const before = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = supersedePage(root, join("wiki", "fenix.md"), "fenix-2", "2026-08-01", "cli");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "superseded-by")).toBe(true);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toBe(before);
  });

  it("refuses a date that is not YYYY-MM-DD, and does not write", () => {
    const before = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = supersedePage(
      root,
      join("wiki", "fenix.md"),
      "project:fenix-2",
      "31-07-2026",
      "cli",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "updated")).toBe(true);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toBe(before);
  });

  it("refuses a page with no frontmatter rather than storing something malformed", () => {
    writeFileSync(join(root, "wiki", "bare.md"), "# No frontmatter\n");
    const result = supersedePage(
      root,
      join("wiki", "bare.md"),
      "project:fenix-2",
      "2026-08-01",
      "cli",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /frontmatter/i.test(e.reason))).toBe(true);
  });
});

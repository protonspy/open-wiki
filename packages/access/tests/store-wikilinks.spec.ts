import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWikilinks } from "../src/store/wikilinks.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-wiki-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  return root;
}

const ANA = [
  "---",
  "id: person:ana",
  "type: person",
  "title: Ana",
  "status: active",
  "aliases: []",
  "updated: 2026-07-31",
  "sources: []",
  'superseded-by: ""',
  "---",
  "",
  "# Ana",
  "",
].join("\n");

describe("resolveWikilinks (5.3)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writeFileSync(join(root, "wiki", "ana.md"), ANA);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports nothing when every link resolves to an existing page", () => {
    const body = "See [[ana]] for details, and [[ana|Ana]] again.\n";
    expect(resolveWikilinks(root, body, "fenix")).toEqual([]);
  });

  it("resolves a link with a heading fragment to the same page", () => {
    expect(resolveWikilinks(root, "See [[ana#bio]].\n", "fenix")).toEqual([]);
  });

  it("reports a link to a page that does not exist, naming the link", () => {
    const body = "See [[ghost]] and [[ana]].\n";
    const issues = resolveWikilinks(root, body, "fenix");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("wikilink");
    expect(issues[0]!.reason).toContain("ghost");
  });

  it("reports each broken link separately", () => {
    const body = "[[ghost]] and [[phantom]] both miss.\n";
    const issues = resolveWikilinks(root, body, "fenix");
    expect(issues).toHaveLength(2);
    const names = issues.map((i) => i.reason);
    expect(names.some((r) => r.includes("ghost"))).toBe(true);
    expect(names.some((r) => r.includes("phantom"))).toBe(true);
  });

  it("resolves a self-link to the page being written, even before it lands on disk", () => {
    // fenix.md does not exist yet — the page is being created. Its own link is fine.
    const body = "This page ([[fenix]]) introduces itself.\n";
    expect(resolveWikilinks(root, body, "fenix")).toEqual([]);
  });

  it("ignores embeds (![[...]]) — they are not wikilinks for this check", () => {
    // ![[missing]] is a transclusion, a separate concern; 5.3 follows links.
    const body = "![[missing]] and [[ana]].\n";
    expect(resolveWikilinks(root, body, "fenix")).toEqual([]);
  });

  it("ignores code spans so a link-shaped string in code is not checked", () => {
    const body = "Use `[[not-a-link]]` literally.\n";
    expect(resolveWikilinks(root, body, "fenix")).toEqual([]);
  });
});

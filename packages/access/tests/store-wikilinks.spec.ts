import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("resolveWikilinks — what a link may name (adr:0016)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-links2-"));
    mkdirSync(join(root, "wiki"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string): void => {
    const file = join(root, "wiki", rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "# page\n", "utf8");
  };

  it("resolves a link to a page filed under a subdirectory", () => {
    write("topics/checkout.md");
    expect(resolveWikilinks(root, "See [[checkout]].", "other")).toEqual([]);
  });

  it("resolves a link to the wiki's own index, changelog and log", () => {
    // These are not entity pages, but they are files in every scaffolded
    // project and the skill tells the agent to record things in them. Denying
    // a page for mentioning [[changelog]] gave a reason that reads as a bug.
    write("changelog.md");
    write("index.md");
    write("log.md");
    expect(
      resolveWikilinks(
        root,
        "Recorded in the [[changelog]], linked from [[index]], see [[log]].",
        "x",
      ),
    ).toEqual([]);
  });

  it("still reports a link that names nothing", () => {
    const issues = resolveWikilinks(root, "See [[nowhere]].", "x");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.target).toBe("nowhere");
  });

  it("carries the target on the issue, so nobody parses it back out of the reason", () => {
    const issues = resolveWikilinks(root, "See [[a-b-c]].", "x");
    expect(issues[0]!.target).toBe("a-b-c");
  });

  it("accepts a caller-supplied slug set instead of walking the wiki", () => {
    // `ow check` builds the set once for the whole run; per-page walks made it
    // quadratic — three seconds over eight hundred pages.
    expect(resolveWikilinks(root, "See [[checkout]].", "x", new Set(["checkout"]))).toEqual([]);
  });
});

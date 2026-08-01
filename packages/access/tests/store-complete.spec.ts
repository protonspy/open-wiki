import { describe, expect, it } from "vitest";
import { completeFrontmatter, extractProvenanceLinks } from "../src/store/complete.js";
import { validatePage } from "../src/store/page.js";

function page(overrides: string[] = []): string {
  const base = [
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
    "Body.",
    "",
  ];
  return [...base.slice(0, 9), ...overrides, ...base.slice(9)].join("\n");
}

describe("extractProvenanceLinks (5.5)", () => {
  it("pulls the provenance links out of prose, deduplicated", () => {
    const body = "See src://a.pdf#p1 and rec://b-2026-01-01#14:32, again src://a.pdf#p1.\n";
    expect(extractProvenanceLinks(body)).toEqual(["src://a.pdf#p1", "rec://b-2026-01-01#14:32"]);
  });

  it("pulls a link out of a markdown link form", () => {
    expect(extractProvenanceLinks("Cite [the doc](src://a.pdf#p3).\n")).toEqual(["src://a.pdf#p3"]);
  });

  it("finds nothing when the body cites nothing", () => {
    expect(extractProvenanceLinks("Just prose, no citations.\n")).toEqual([]);
  });
});

describe("completeFrontmatter (5.5)", () => {
  it("fills updated when the agent left it out", () => {
    const noUpdated = page().replace("updated: 2026-07-31\n", "");
    const out = completeFrontmatter(noUpdated, "2026-08-01");
    expect(out).toContain("updated: 2026-08-01");
  });

  it("fills updated when the agent left a value that is not a date", () => {
    const bad = page().replace("updated: 2026-07-31", "updated: today");
    expect(completeFrontmatter(bad, "2026-08-01")).toContain("updated: 2026-08-01");
  });

  it("keeps an existing valid updated rather than clobbering it", () => {
    const out = completeFrontmatter(page(), "2026-08-01");
    expect(out).toContain("updated: 2026-07-31");
  });

  it("appends the body's provenance links to sources, deduped, keeping what was listed", () => {
    const withBody = page().replace(
      "Body.",
      "Claim cites src://notes.txt#p4 and the existing src://arquitetura-fenix.pdf#p12.",
    );
    const out = completeFrontmatter(withBody, "2026-08-01");
    expect(validatePage(out, "fenix").ok).toBe(true);
    if (!validatePage(out, "fenix").ok) return;
    const fm = (validatePage(out, "fenix") as { frontmatter: { sources: string[] } }).frontmatter;
    expect(fm.sources).toContain("src://arquitetura-fenix.pdf#p12");
    expect(fm.sources).toContain("src://notes.txt#p4");
  });

  it("leaves sources as the existing list when the body cites nothing new", () => {
    const out = completeFrontmatter(page(), "2026-08-01");
    expect(validatePage(out, "fenix").ok).toBe(true);
    if (!validatePage(out, "fenix").ok) return;
    const fm = (validatePage(out, "fenix") as { frontmatter: { sources: string[] } }).frontmatter;
    expect(fm.sources).toEqual(["src://arquitetura-fenix.pdf#p12"]);
  });

  it("preserves the body verbatim", () => {
    const withBody = page().replace("Body.", "A specific sentence.");
    expect(completeFrontmatter(withBody, "2026-08-01")).toContain("A specific sentence.");
  });

  it("returns the markdown unchanged when there is no frontmatter to complete", () => {
    const bare = "# No frontmatter\n";
    expect(completeFrontmatter(bare, "2026-08-01")).toBe(bare);
  });

  it("the completed page passes the schema", () => {
    const withBody = page().replace("Body.", "Cite src://notes.txt#p4.");
    expect(validatePage(completeFrontmatter(withBody, "2026-08-01"), "fenix").ok).toBe(true);
  });
});

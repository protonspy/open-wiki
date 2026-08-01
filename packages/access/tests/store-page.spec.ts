import { describe, expect, it } from "vitest";
import { isEntityPage, validatePage, type PageFrontmatter } from "../src/store/page.js";

/** A frontmatter block that satisfies the schema, to mutate per test. */
function validFrontmatter(): string {
  return [
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
    "The platform.",
    "",
  ].join("\n");
}

describe("isEntityPage (5.1)", () => {
  it("is true for an ordinary wiki page, false for the three non-entity pages", () => {
    expect(isEntityPage("fenix.md")).toBe(true);
    expect(isEntityPage("codewiki/dispatch.md")).toBe(true);
    expect(isEntityPage("index.md")).toBe(false);
    expect(isEntityPage("changelog.md")).toBe(false);
    expect(isEntityPage("log.md")).toBe(false);
  });
});

describe("validatePage (5.1)", () => {
  it("accepts a well-formed page, returning the parsed frontmatter and body", () => {
    const result = validatePage(validFrontmatter(), "fenix");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fm: PageFrontmatter = result.frontmatter;
    expect(fm.id).toBe("project:fenix");
    expect(fm.type).toBe("project");
    expect(fm.title).toBe("Fenix");
    expect(fm.status).toBe("active");
    expect(fm.aliases).toEqual(["fenix platform"]);
    expect(fm.updated).toBe("2026-07-31");
    expect(fm.sources).toEqual(["src://arquitetura-fenix.pdf#p12"]);
    expect(fm["superseded-by"]).toBe("");
    expect(result.body).toContain("# Fenix");
    expect(result.body).not.toContain("---");
  });

  it("refuses a page with no frontmatter block, saying so", () => {
    const result = validatePage("# Fenix\n\nNo frontmatter here.\n", "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.reason.includes("no frontmatter"))).toBe(true);
  });

  it("refuses unparseable frontmatter, saying it could not read the YAML", () => {
    const broken = "---\nid: project:fenix\ntitle: Fenix\n  : bad: yaml: :\n---\nbody\n";
    const result = validatePage(broken, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /could not parse/i.test(e.reason))).toBe(true);
  });

  it("refuses a missing required field, naming the field", () => {
    const page = validFrontmatter().replace("title: Fenix\n", "");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "title")).toBe(true);
  });

  it("refuses an id that is not type:slug", () => {
    const page = validFrontmatter().replace("id: project:fenix", "id: fenix");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "id")).toBe(true);
  });

  it("refuses an id whose slug does not match the filename", () => {
    const result = validatePage(validFrontmatter(), "fenix-2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "id" && /fenix-2/.test(e.reason))).toBe(true);
  });

  it("refuses a status outside active/superseded", () => {
    const page = validFrontmatter().replace("status: active", "status: draft");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "status")).toBe(true);
  });

  it("refuses aliases that are not a list of strings", () => {
    const page = validFrontmatter().replace("aliases: [fenix platform]", "aliases: fenix");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "aliases")).toBe(true);
  });

  it("refuses an updated that is not a YYYY-MM-DD date", () => {
    const page = validFrontmatter().replace("updated: 2026-07-31", "updated: 31-07-2026");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "updated")).toBe(true);
  });

  it("refuses a source that is not a provenance link, naming the offender", () => {
    const page = validFrontmatter().replace(
      "sources: [src://arquitetura-fenix.pdf#p12]",
      "sources: [see the architecture doc]",
    );
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "sources")).toBe(true);
  });

  it("refuses superseded-by set while the page is active", () => {
    const page = validFrontmatter().replace('superseded-by: ""', "superseded-by: project:fenix-2");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "superseded-by")).toBe(true);
  });

  it("refuses a superseded page that names no replacement", () => {
    const page = validFrontmatter()
      .replace("status: active", "status: superseded")
      .replace('superseded-by: ""', 'superseded-by: ""');
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "superseded-by")).toBe(true);
  });

  it("accepts a properly superseded page", () => {
    const page = validFrontmatter()
      .replace("status: active", "status: superseded")
      .replace('superseded-by: ""', "superseded-by: project:fenix-2");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(true);
  });

  it("collects more than one problem rather than stopping at the first", () => {
    const page = validFrontmatter()
      .replace("title: Fenix\n", "")
      .replace("status: active", "status: draft");
    const result = validatePage(page, "fenix");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("title");
    expect(fields).toContain("status");
  });
});

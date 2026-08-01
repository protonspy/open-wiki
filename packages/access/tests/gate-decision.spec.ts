import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { gateWrite } from "../src/gate/gate.js";
import { formatDenial } from "../src/gate/errors.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-gate-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  return root;
}

const DATE = "2026-08-01";

/** A minimal valid page body the store will accept after completion. */
function page(fm: string, body = "Body.\n"): string {
  return `---\n${fm}\n---\n${body}`;
}

const GOOD_FM =
  'id: t:fenix\ntype: t\ntitle: Fenix\nstatus: active\naliases: []\nupdated: ""\nsources: []\nsuperseded-by: ""';

describe("gateWrite — routing (9.5)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a write to the gate's own configuration (9.6)", () => {
    const d = gateWrite({ projectRoot: root, filePath: ".claude/settings.json", content: "x", date: DATE });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("configuration");
  });

  it("passes through a non-gated path unchanged", () => {
    expect(gateWrite({ projectRoot: root, filePath: "README.md", content: "hi\n", date: DATE })).toEqual({
      action: "allow",
    });
    expect(
      gateWrite({ projectRoot: root, filePath: "raw/doc.pdf/text.md", content: "hi\n", date: DATE }),
    ).toEqual({ action: "allow" });
  });

  it("passes through the non-entity pages under wiki/ (index, changelog, log)", () => {
    expect(gateWrite({ projectRoot: root, filePath: "wiki/index.md", content: "# Index\n", date: DATE })).toEqual({
      action: "allow",
    });
  });
});

describe("gateWrite — a valid page (9.5)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a valid page and completes the store-managed fields", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM),
      date: DATE,
    });
    expect(d.action).toBe("accept");
    if (d.action === "accept") {
      expect(d.content).toContain("updated: 2026-08-01");
    }
  });

  it("preserves a valid `updated` the writer already set", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM.replace('updated: ""', "updated: 2026-07-31")),
      date: DATE,
    });
    expect(d.action).toBe("accept");
    if (d.action === "accept") expect(d.content).toContain("updated: 2026-07-31");
  });

  it("derives `sources` from citations written in the body", () => {
    // The cited source must exist for provenance resolution to pass.
    mkdirSync(join(root, "raw", "doc.pdf"), { recursive: true });
    writeFileSync(
      join(root, "raw", "doc.pdf", "manifest.json"),
      JSON.stringify({ id: "doc.pdf", title: "Doc", kind: "file", original: "doc.pdf" }),
    );
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM, "See src://doc.pdf#p1.\n"),
      date: DATE,
    });
    expect(d.action).toBe("accept");
    if (d.action === "accept") expect(d.content).toContain("src://doc.pdf#p1");
  });
});

describe("gateWrite — refusal (9.5, 9.13)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a page missing a required field and names the field", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM.replace("type: t\n", "")),
      date: DATE,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("type");
  });

  it("refuses a page whose wikilink does not resolve", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM, "See [[no-such-page]].\n"),
      date: DATE,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("no-such-page");
  });

  it("accepts the same wikilink once the target page exists", () => {
    writeFileSync(
      join(root, "wiki", "target.md"),
      page(GOOD_FM.replace("fenix", "target").replace("Fenix", "Target")),
    );
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM, "See [[target]].\n"),
      date: DATE,
    });
    expect(d.action).toBe("accept");
  });

  it("refuses a page whose provenance citation points at no source", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: page(GOOD_FM, "See src://ghost.pdf#p1.\n"),
      date: DATE,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("ghost.pdf");
  });

  it("refuses a page with no frontmatter block", () => {
    const d = gateWrite({
      projectRoot: root,
      filePath: "wiki/fenix.md",
      content: "Just a body, no frontmatter.\n",
      date: DATE,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("frontmatter");
  });
});

describe("gateWrite — path confinement (2.6, the review's HIGH finding)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("denies a write whose path escapes the project via .. — even a non-gated file", () => {
    // A non-gated file outside the project is denied too: `allow` is "no opinion",
    // not "write anywhere". This is the door the PreToolUse hook goes through,
    // so the agent's own tool would otherwise land the write outside the project.
    const d = gateWrite({
      projectRoot: root,
      filePath: join(root, "wiki", "..", "..", "elsewhere.md"),
      content: "x",
      date: DATE,
    });
    expect(d.action).toBe("deny");
    if (d.action === "deny") expect(d.reasons.join(" ")).toContain("outside the project");
  });

  it("denies a write through a junction inside the project that points outside", () => {
    const outside = join(dirname(root), "junction-target");
    mkdirSync(outside, { recursive: true });
    const junction = join(root, "wiki", "junction");
    try {
      symlinkSync(outside, junction, "junction");
    } catch {
      // Some Windows accounts lack even the junction privilege; that is a
      // different failure from the containment logic and should not fail here.
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    try {
      const d = gateWrite({
        projectRoot: root,
        filePath: join(junction, "page.md"),
        content: page(GOOD_FM),
        date: DATE,
      });
      expect(d.action).toBe("deny");
      if (d.action === "deny") expect(d.reasons.join(" ")).toContain("outside the project");
      // And nothing was written through the junction.
      expect(existsSync(join(outside, "page.md"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("formatDenial (9.13)", () => {
  it("renders a header and one bullet per reason", () => {
    const text = formatDenial("wiki/fenix.md", ["updated must be a date", "[[x]] does not resolve"]);
    expect(text).toContain("wiki/fenix.md");
    expect(text).toContain("- updated must be a date");
    expect(text).toContain("- [[x]] does not resolve");
  });
});
import { describe, expect, it } from "vitest";
import { isStoreOnlyChange, STORE_MANAGED_FIELDS } from "../src/store/staleness.js";

function page(frontmatter: string, body = "Body.\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const FM =
  'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: ""';

describe("STORE_MANAGED_FIELDS (5.8)", () => {
  it("names exactly the fields the store fills itself", () => {
    expect([...STORE_MANAGED_FIELDS]).toEqual(["updated", "sources"]);
  });
});

describe("isStoreOnlyChange (5.8)", () => {
  it("treats identical pages as a non-edit", () => {
    const p = page(FM);
    expect(isStoreOnlyChange(p, p)).toBe(true);
  });

  it("a store-filled `updated` is not an external edit (editor path)", () => {
    // The editor saved with `updated` left blank; the store filled the date.
    const author = page(FM.replace("updated: 2026-08-01", 'updated: ""'));
    const disk = page(FM);
    expect(isStoreOnlyChange(author, disk)).toBe(true);
  });

  it("a store-stamped `updated` on a later day is not an external edit", () => {
    const author = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: ""',
    );
    const disk = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-02\nsources: []\nsuperseded-by: ""',
    );
    expect(isStoreOnlyChange(author, disk)).toBe(true);
  });

  it("a store-appended `sources` is not an external edit (hook path)", () => {
    // The agent wrote the citation in the body; the store mirrored it into `sources`.
    const author = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: ""',
      "See src://doc.pdf#p1.\n",
    );
    const disk = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources:\n  - src://doc.pdf#p1\nsuperseded-by: ""',
      "See src://doc.pdf#p1.\n",
    );
    expect(isStoreOnlyChange(author, disk)).toBe(true);
  });

  it("`updated` and `sources` changing together is still store-only", () => {
    const author = page(FM.replace("updated: 2026-08-01", 'updated: ""'));
    const disk = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-02\nsources:\n  - src://doc.pdf#p1\nsuperseded-by: ""',
    );
    expect(isStoreOnlyChange(author, disk)).toBe(true);
  });

  it("frontmatter re-serialised by the store (key order, quoting) is not an edit", () => {
    // complete.ts re-stringifies the whole block, so on-disk key order may differ.
    const author = page(
      'id: t:a\ntitle: "A"\ntype: t\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: ""',
    );
    const disk = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: active\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: ""',
    );
    expect(isStoreOnlyChange(author, disk)).toBe(true);
  });

  it("a real body edit reads as an external edit", () => {
    const author = page(FM, "Old body.\n");
    const disk = page(FM, "New body.\n");
    expect(isStoreOnlyChange(author, disk)).toBe(false);
  });

  it("a change to an author-controlled field reads as an external edit", () => {
    const author = page(FM);
    const disk = page(FM.replace("title: A", "title: B"));
    expect(isStoreOnlyChange(author, disk)).toBe(false);
  });

  it("a change to `status` reads as an external edit", () => {
    const author = page(FM);
    const disk = page(
      'id: t:a\ntype: t\ntitle: A\nstatus: superseded\naliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: "t:b"',
    );
    expect(isStoreOnlyChange(author, disk)).toBe(false);
  });

  it("a new author-controlled key on disk reads as an external edit", () => {
    const author = page(FM);
    const disk = page(`${FM}\nfoo: bar`);
    expect(isStoreOnlyChange(author, disk)).toBe(false);
  });

  it("pages with no frontmatter compare by body", () => {
    expect(isStoreOnlyChange("Same.\n", "Same.\n")).toBe(true);
    expect(isStoreOnlyChange("Same.\n", "Diff.\n")).toBe(false);
  });

  it("frontmatter gained or lost reads as an external edit", () => {
    const withFm = page(FM);
    expect(isStoreOnlyChange(withFm, "Body.\n")).toBe(false);
    expect(isStoreOnlyChange("Body.\n", withFm)).toBe(false);
  });

  it("an unparseable frontmatter is not assumed to be a store correction", () => {
    const broken = page("id: t:a\ntype: t\n  oops: : :\ntitle: A");
    const good = page(FM);
    // Differing and not safely attributable to the store.
    expect(isStoreOnlyChange(broken, good)).toBe(false);
    expect(isStoreOnlyChange(broken, broken)).toBe(true);
  });
});

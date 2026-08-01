import { readFrontmatter } from "./page.js";

/**
 * The staleness exception (plan 5.8). The store fills some fields itself
 * (5.5 / `complete.ts`): `updated` with the write date, and `sources` with the
 * provenance links cited inline in the body. A writer — an agent whose hook
 * rewrote the page through `updatedInput`, or an editor that saved and had
 * `updated` stamped — is left holding a copy that no longer matches the disk,
 * but the only difference is the store's own correction. 8.8 must not read that
 * as somebody else's edit and refuse the write, asking the writer to reconcile a
 * change it did not make.
 *
 * The resolution: two pages differ by "the store only" when, after dropping the
 * store-managed fields from both frontmatters, what remains is equal — the
 * parsed author-controlled fields, order- and quote-independent, and a
 * byte-identical body. The store re-serialises the whole frontmatter block, so
 * key order and quoting on disk are its artifacts too, and comparing parsed
 * values (not the raw text) is what keeps them from reading as edits.
 */
export const STORE_MANAGED_FIELDS = ["updated", "sources"] as const;

/** The frontmatter with the store-managed fields removed, or null when not a mapping. */
function authorControlled(frontmatter: unknown): Record<string, unknown> | null {
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return null;
  }
  const m = { ...(frontmatter as Record<string, unknown>) };
  for (const key of STORE_MANAGED_FIELDS) delete m[key];
  return m;
}

/** Order-independent deep equality for the plain values YAML parses to. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * True when `author` and `disk` differ only in the store-managed fields — i.e.
 * the disk's change since the writer loaded it is the store's own correction,
 * not an edit by somebody else. 8.8 calls this before refusing an overwrite.
 */
export function isStoreOnlyChange(author: string, disk: string): boolean {
  const a = readFrontmatter(author);
  const d = readFrontmatter(disk);

  // No frontmatter on either side: the whole text is the body.
  if (!a && !d) return author === disk;

  // Frontmatter present on one side but not the other is a structural change.
  if (!!a !== !!d) return false;

  const ab = a as Exclude<NonNullable<typeof a>, null>;
  const db = d as Exclude<NonNullable<typeof d>, null>;

  // Unparseable frontmatter cannot be safely attributed to the store.
  if (!ab.parsed || !db.parsed) return author === disk;

  if (ab.body !== db.body) return false;

  const aFm = authorControlled(ab.frontmatter);
  const dFm = authorControlled(db.frontmatter);
  if (!aFm || !dFm) return false;

  return stableStringify(aFm) === stableStringify(dFm);
}

/**
 * True when two pages are semantically the same — the parsed frontmatter
 * (every field, order- and quote-independent) and a byte-identical body. Unlike
 * {@link isStoreOnlyChange} this counts the store-managed fields too, so the
 * gate can tell a completion that actually filled `updated` or `sources` from
 * one that only re-serialised the block it already had, and avoid rewriting a
 * page the writer had already completed (plan 9.5).
 */
export function pagesEqual(a: string, b: string): boolean {
  const ra = readFrontmatter(a);
  const rb = readFrontmatter(b);
  if (!ra && !rb) return a === b;
  if (!!ra !== !!rb) return false;
  const x = ra as Exclude<NonNullable<typeof ra>, null>;
  const y = rb as Exclude<NonNullable<typeof rb>, null>;
  if (!x.parsed || !y.parsed) return a === b;
  if (x.body !== y.body) return false;
  if (
    x.frontmatter === null ||
    typeof x.frontmatter !== "object" ||
    Array.isArray(x.frontmatter) ||
    y.frontmatter === null ||
    typeof y.frontmatter !== "object" ||
    Array.isArray(y.frontmatter)
  ) {
    return false;
  }
  return stableStringify(x.frontmatter) === stableStringify(y.frontmatter);
}

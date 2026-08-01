import { basename, relative, resolve } from "node:path";
import { assertWithin, resolveReal, OutsideProjectError } from "../paths.js";
import { isConfigWrite, configWriteReason } from "./guard.js";
import { completeFrontmatter } from "../store/complete.js";
import { resolveWikilinks } from "../store/wikilinks.js";
import { extractProvenanceLinks, resolveProvenance } from "../store/provenance.js";
import { readFrontmatter, validatePage, NON_ENTITY_PAGES } from "../store/page.js";

/**
 * The write gate (plan 9.5). One pure decision, shared by the `PreToolUse`
 * hook and the `ow write` verb: take a path and the content the writer proposes,
 * and either let it through unchanged, accept it completed, or refuse it with
 * reasons the writer can act on.
 *
 * The gate owns the wiki and codewiki entity pages — the pages that carry the
 * schema of 5.1. Everything else (sources, the non-entity `index.md`/`changelog`
 * /`log.md`, files outside `wiki/` and `codewiki/`) is passed through; it is not
 * the gate's to validate. The gate's own configuration (`.claude/`, `.mcp.json`,
 * `CLAUDE.md`) is refused outright (9.6): a write path that reached it would
 * edit away its own restraint through a change that reads as documentation.
 *
 * The gate does not write. It completes and validates; the caller writes (the
 * agent's own tool on the hook path, `writePage` on the CLI path). Snapshotting
 * is the caller's too, so the hook path snapshots without this module
 * performing the write it is protecting (2.3).
 */
export type GateDecision =
  | { action: "allow" }
  | { action: "accept"; content: string }
  | { action: "deny"; reasons: string[] };

export interface GateInput {
  projectRoot: string;
  filePath: string;
  content: string;
  date: string;
}

/**
 * The project-relative posix path of a page, or null when it is not a gated page.
 *
 * The classification folds case. Windows is case-insensitive by default and is
 * the only platform the product supports, so `Wiki/Page.MD` and `wiki/page.md`
 * are the same file — matching the literal casing would put the gate one
 * keystroke away from being skipped. Folding errs toward gating, which is the
 * safe direction on a case-sensitive filesystem too: at worst a page is
 * validated that need not have been, never one waved through.
 */
function gatedPageRel(projectRoot: string, filePath: string): string | null {
  const rel = relative(resolve(projectRoot), resolve(projectRoot, filePath)).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("..")) return null;
  const folded = rel.toLowerCase();
  if (!folded.endsWith(".md")) return null;
  if (!folded.startsWith("wiki/") && !folded.startsWith("codewiki/")) return null;
  // Non-entity pages are themselves, not validated against the schema.
  if ((NON_ENTITY_PAGES as readonly string[]).includes(basename(folded))) return null;
  return rel;
}

/** A page's slug: its filename without the `.md`, whatever case that carries. */
function slugOf(rel: string): string {
  return basename(rel).replace(/\.md$/i, "");
}

export function gateWrite(input: GateInput): GateDecision {
  const { projectRoot, filePath, content, date } = input;

  // Confine first, with real-path resolution so a Windows junction or symlink
  // inside the project that points outside is refused before any write — and
  // before classification. This is the write path's job (plan 2.6), and it is
  // shared by both doors (the PreToolUse hook and the `ow write` verb), so it
  // lives here rather than in either caller. `allow` is "no opinion", not
  // "write anywhere": a non-gated file outside the project is denied too.
  let landsAt: string;
  try {
    landsAt = assertWithin(projectRoot, resolve(projectRoot, filePath));
  } catch (e) {
    if (e instanceof OutsideProjectError) {
      return { action: "deny", reasons: [e.message] };
    }
    throw e;
  }

  // Classify by where the write *lands*, not by the name it was asked for.
  // `assertWithin` returns the real path, and everything below compares against
  // the real project root, so a junction inside `wiki/` that points at
  // `.claude/` is seen for what it is. Classifying the nominal path instead
  // would read `wiki/link/settings.md` as a wiki page and write it straight
  // through the config guard.
  const realRoot = resolveReal(projectRoot);

  if (isConfigWrite(landsAt, realRoot)) {
    return { action: "deny", reasons: [configWriteReason(filePath)] };
  }

  const rel = gatedPageRel(realRoot, landsAt);
  if (rel === null) return { action: "allow" };

  const slug = slugOf(rel);
  const completed = completeFrontmatter(content, date);

  const reasons: string[] = [];

  const validation = validatePage(completed, slug);
  if (!validation.ok) {
    for (const issue of validation.errors) {
      reasons.push(issue.field ? `${issue.field}: ${issue.reason}` : issue.reason);
    }
  }

  // Wikilink and provenance resolution describe the body, which the frontmatter
  // block delimits. They run when there is a block to read; a page with none is
  // already refused above for that.
  const block = readFrontmatter(completed);
  if (block) {
    for (const issue of resolveWikilinks(projectRoot, block.body, slug)) {
      reasons.push(issue.reason);
    }
    const sources = extractProvenanceLinks(block.body);
    if (sources.length > 0) {
      for (const issue of resolveProvenance(projectRoot, sources)) {
        reasons.push(issue.reason);
      }
    }
  }

  if (reasons.length > 0) return { action: "deny", reasons };
  return { action: "accept", content: completed };
}
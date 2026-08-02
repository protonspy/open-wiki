import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { today } from "../dates.js";
import { assertWithin, OutsideProjectError, resolveReal } from "../paths.js";
import { gatedPageRel, gateWrite } from "../gate/gate.js";
import { appendOperation, type Origin } from "./log.js";
import { atomicWrite, snapshot } from "./atomic-write.js";
import { undo } from "./undo.js";
import { NON_ENTITY_PAGES, readFrontmatter, validatePage } from "../store/page.js";
import { recordWrite } from "../store/record.js";
import { registerInIndex } from "../store/index-write.js";

/**
 * Gated, atomic rename and delete of wiki pages — the access primitives the
 * embedded agent's `rename_page` / `delete_page` tools are built on
 * (`specs/embedded-agent`, R4.2). Each is a single undoable operation that
 * carries the caller's `origin` (the agent passes `"agent"`), so a bad run is
 * one undo rather than an archaeology.
 *
 * **Delete is removal, not supersession** — the codebase convention. A deleted
 * page's record is the changelog entry and the `.state` operation log (whose
 * snapshot lets undo put it back); a dangling reference to it is an expected
 * finding (`checks.ts`). Supersession names a real replacement (`superseded-by`),
 * which a deletion has none of.
 *
 * **Rename is supersession**: the new page is written through the gate and the
 * old page is marked `superseded` by it. The old page stays on disk — visible in
 * history and the supersession chain — and its links still resolve (to the
 * superseded page, which says where the current truth now lives). Wikilinks
 * elsewhere are *not* repointed; that is the editor's move-style rename, a
 * different operation for a different caller.
 *
 * Both refuse the three non-entity pages at the top of `wiki/` — `index.md`,
 * `changelog.md`, `log.md` — and any path that resolves outside the wiki or the
 * project, classified by where it *lands* on disk (not the name it was asked
 * for), the same way the write gate classifies. A junction inside `wiki/`
 * pointing at `.claude/` is refused on delete too, not only on write — the
 * `node:fs` delete the desktop used never asked the gate, so this primitive
 * does.
 */

/** The slug a page path carries: the filename without `.md`. */
function slugOf(pagePath: string): string {
  return basename(pagePath).replace(/\.md$/i, "");
}

/**
 * Re-serialise a page's frontmatter with the given fields overridden, leaving
 * the body verbatim. Used (not `setFrontmatterField`) because a renamed page's
 * `superseded-by` is the empty string while it is active, and a surgical
 * `key: ` line parses as `null` — the schema rejects a non-string. The store
 * itself re-serialises the same way in `completeFrontmatter`, so this is the
 * form a gated write would land in regardless.
 */
function withFrontmatter(markdown: string, overrides: Record<string, unknown>): string {
  const block = readFrontmatter(markdown);
  if (!block || !block.parsed) throw new Error("page has no readable frontmatter block");
  const fm = { ...(block.frontmatter as Record<string, unknown>), ...overrides };
  return `---\n${stringify(fm).trimEnd()}\n---\n${block.body}`;
}

/**
 * The wiki-entity rel of a page path, classified by where it lands on disk —
 * or a refusal. Mirrors the write gate's three-step classification (confine,
 * refuse config writes, gate the wiki entity) so rename and delete refuse
 * exactly what the gate would not own. `reason` distinguishes the protected
 * record pages (R4.6) from a path that is simply not a wiki page.
 */
function classify(
  projectRoot: string,
  pagePath: string,
): { ok: true; rel: string } | { ok: false; reason: string } {
  const realRoot = resolveReal(projectRoot);
  let landsAt: string;
  try {
    landsAt = assertWithin(projectRoot, resolve(projectRoot, pagePath));
  } catch (e) {
    if (e instanceof OutsideProjectError) return { ok: false, reason: e.message };
    throw e;
  }
  // A config write (`.claude/`, `.mcp.json`, `CLAUDE.md`) reached as a rename or
  // delete target — refused outright by 9.6, and `gatedPageRel` would not see
  // it, so it is checked before classification.
  const rel = gatedPageRel(realRoot, landsAt);
  if (rel !== null) return { ok: true, rel };

  // `gatedPageRel` returns null for non-wiki, non-md, and the three top-level
  // record pages. Distinguish the last so R4.6's refusal names them.
  const folded = relative(realRoot, landsAt).replace(/\\/g, "/").toLowerCase();
  const under = folded.startsWith("wiki/") ? folded.slice("wiki/".length) : "";
  if (under && !under.includes("/") && (NON_ENTITY_PAGES as readonly string[]).includes(under)) {
    return {
      ok: false,
      reason: `${pagePath} is a wiki record page (index/changelog/log) and cannot be renamed or deleted`,
    };
  }
  // Also catch the config-write case the gate refused, for a clearer reason
  // than `gatedPageRel`'s null when the path is under `.claude/` etc.
  return { ok: false, reason: `${pagePath} is not a wiki entity page` };
}

/**
 * The wiki's own record pages a rename writes besides the two pages themselves:
 * `recordWrite` appends to `log.md` and `changelog.md`, and `registerInIndex`
 * adds a bullet to `index.md`.
 *
 * They are not in the operation's snapshot on purpose. The snapshot is what
 * `undo` replays, and undoing an old rename must not roll `changelog.md` back
 * over every entry written since. So a rename backs them up separately, for its
 * own failure path only — a rollback restores them, a later `undo` leaves them
 * alone.
 */
const RECORD_PAGES = ["wiki/log.md", "wiki/changelog.md", "wiki/index.md"] as const;

/** One record page as it read before the rename, or `null` when it was not a file. */
interface RecordBackup {
  rel: string;
  before: string | null;
}

/**
 * Read the record pages before the rename touches them. Best-effort by design:
 * a record page that cannot be read is one this cannot restore, and refusing the
 * rename over it would be worse than the leak it protects against.
 */
function backupRecords(projectRoot: string): RecordBackup[] {
  return RECORD_PAGES.map((rel) => {
    let before: string | null = null;
    try {
      const abs = assertWithin(projectRoot, resolve(projectRoot, rel));
      const st = statSync(abs, { throwIfNoEntry: false });
      if (st?.isFile()) before = readFileSync(abs, "utf8");
    } catch {
      /* not readable — nothing to restore, and nothing to lose */
    }
    return { rel, before };
  });
}

/** Put the record pages back as {@link backupRecords} found them. */
function restoreRecords(projectRoot: string, backups: RecordBackup[]): void {
  for (const b of backups) {
    try {
      const abs = assertWithin(projectRoot, resolve(projectRoot, b.rel));
      if (b.before === null) {
        // It was not a file before. Remove it only if the rename created one —
        // never recursively, so a directory standing where the page belongs is
        // left exactly as it was found.
        if (statSync(abs, { throwIfNoEntry: false })?.isFile()) rmSync(abs, { force: true });
      } else {
        writeFileSync(abs, b.before, "utf8");
      }
    } catch {
      /* best effort; the caller already reports the failure that got us here */
    }
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type DeleteResult = { ok: true; operationId: string } | { ok: false; reason: string };

/**
 * Delete a wiki page: gated removal, one undoable operation. The page is
 * snapshotted, unlinked, and logged with the given `origin`. The desktop's
 * `deletePage` calls `node:fs.rmSync` with a hardcoded origin and bypasses the
 * gate; this is its replacement for callers that need the origin named and the
 * target classified.
 */
export function deletePage(projectRoot: string, pagePath: string, origin: Origin): DeleteResult {
  const target = classify(projectRoot, pagePath);
  if (!target.ok) return target;
  const abs = assertWithin(projectRoot, resolve(projectRoot, pagePath));
  if (!existsSync(abs)) return { ok: false, reason: `no such page: ${pagePath}` };

  const slug = slugOf(pagePath);
  // Snapshot first, then log, then unlink — the operation-log entry is the
  // rollback record: undo restores the page from the snapshot. Logging before
  // the unlink means a thrown `rmSync` leaves a logged no-op, not a silent gap.
  const snap = snapshot(projectRoot, [pagePath]);
  const operation = appendOperation(projectRoot, {
    id: snap.id,
    origin,
    pages: snap.pages,
    snapshotId: snap.id,
  });
  rmSync(abs, { force: true });
  // The changelog's vocabulary has no `deleted`; the operation log records the
  // removal precisely, and this line is the human-readable trail beside it.
  recordWrite(projectRoot, { slug, action: "modified", origin, date: today() });
  return { ok: true, operationId: operation.id };
}

export type RenameResult = { ok: true; operationId: string } | { ok: false; reasons: string[] };

/**
 * Rename a wiki page as supersession: write the new page through the gate and
 * mark the old `superseded` by it, in one operation. Refuses to clobber an
 * existing target, refuses the record pages, and refuses any path the gate
 * would not own. Wikilinks are not repointed — the old page stays, superseded,
 * and its links still resolve.
 */
export function renamePage(
  projectRoot: string,
  oldPath: string,
  newPath: string,
  origin: Origin,
): RenameResult {
  const oldRel = classify(projectRoot, oldPath);
  if (!oldRel.ok) return { ok: false, reasons: [oldRel.reason] };
  const newRel = classify(projectRoot, newPath);
  if (!newRel.ok) return { ok: false, reasons: [newRel.reason] };

  const oldAbs = assertWithin(projectRoot, resolve(projectRoot, oldPath));
  if (!existsSync(oldAbs)) return { ok: false, reasons: [`no such page: ${oldPath}`] };
  const newAbs = assertWithin(projectRoot, resolve(projectRoot, newPath));
  if (existsSync(newAbs)) {
    return { ok: false, reasons: [`a page already exists at ${newPath}`] };
  }

  const oldMarkdown = readFileSync(oldAbs, "utf8");
  const block = readFrontmatter(oldMarkdown);
  if (!block || !block.parsed) {
    return { ok: false, reasons: ["the page to rename has no readable frontmatter block"] };
  }
  const oldId = String((block.frontmatter as Record<string, unknown>)["id"] ?? "");
  const colon = oldId.indexOf(":");
  if (colon < 0) {
    return { ok: false, reasons: [`the page's id "${oldId}" is not type:slug`] };
  }
  const type = oldId.slice(0, colon);
  const oldSlug = slugOf(oldPath);
  const newSlug = slugOf(newPath);
  const newId = `${type}:${newSlug}`;

  // The new page is the old page's content with its id following the new slug,
  // active, and cleared of any prior supersession. `updated` is set here so the
  // gate's completion does not keep the old page's date.
  const newMarkdown = withFrontmatter(oldMarkdown, {
    id: newId,
    status: "active",
    "superseded-by": "",
    updated: today(),
  });
  const decision = gateWrite({
    projectRoot,
    filePath: newPath,
    content: newMarkdown,
    date: today(),
  });
  if (decision.action === "deny") return { ok: false, reasons: decision.reasons };
  const settledNew = decision.action === "accept" ? decision.content : newMarkdown;

  // The old page is marked superseded by the new one. Validated, not gated:
  // the gate re-serialises and runs completion, and this is a frontmatter-only
  // change to an already-well-formed page (its body wikilinks and provenance are
  // unchanged), so the schema check is enough — the same call `supersedePage`
  // makes.
  const oldSuperseded = withFrontmatter(oldMarkdown, {
    status: "superseded",
    "superseded-by": newId,
    updated: today(),
  });
  const validation = validatePage(oldSuperseded, oldSlug);
  if (!validation.ok) {
    return {
      ok: false,
      reasons: validation.errors.map((e) => (e.field ? `${e.field}: ${e.reason}` : e.reason)),
    };
  }

  // One operation covers both pages: undo puts the new page away and the old
  // page back to active together, which is what makes it a rename.
  const snap = snapshot(projectRoot, [oldPath, newPath]);
  const operation = appendOperation(projectRoot, {
    id: snap.id,
    origin,
    pages: snap.pages,
    snapshotId: snap.id,
  });
  // Two writes are two chances to fail, and a rename half-applied is worse than
  // one refused: the new page exists while the old one still reads `active`, so
  // one entity is live twice and nothing says which is current. A disk that
  // filled, a Windows file lock (an editor, an antivirus scan) or an EMFILE
  // between the two is enough. The snapshot taken above is the rollback for the
  // two pages — `undo` restores what existed and removes what did not — and
  // `records` is the rollback for everything else this writes, so any throw
  // rewinds all five files before it leaves.
  const records = backupRecords(projectRoot);
  try {
    atomicWrite(projectRoot, newPath, settledNew);
    atomicWrite(projectRoot, oldPath, oldSuperseded);
    recordWrite(projectRoot, { slug: newSlug, action: "created", origin, date: today() });
    recordWrite(projectRoot, {
      slug: oldSlug,
      action: "superseded",
      origin,
      date: today(),
      replacementSlug: newSlug,
    });
    registerInIndex(projectRoot, newSlug);
  } catch (e) {
    // The operation-log entry stays: it is the record that this was attempted
    // and rewound, and `undo` is idempotent for a caller who runs it again.
    const reasons = [`the rename could not be completed and was rolled back: ${messageOf(e)}`];
    restoreRecords(projectRoot, records);
    try {
      undo(projectRoot, operation.id);
    } catch (undoError) {
      // A rollback that itself failed is the one thing the caller must not be
      // told is "rolled back" and nothing more — the pages are in an unknown
      // state and the operation id is how a person gets at them.
      reasons.push(
        `the rollback of the two pages failed as well (operation ${operation.id}): ${messageOf(undoError)}`,
      );
    }
    return { ok: false, reasons };
  }
  return { ok: true, operationId: operation.id };
}

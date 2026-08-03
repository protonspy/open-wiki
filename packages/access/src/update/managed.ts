import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "../harness.js";
import { renderConvention } from "../render.js";
import { assertWithin, refuseSymlink } from "../paths.js";
import type { Language } from "../config/settings.js";

/**
 * What `ow update` can tell about a file this product manages
 * (plan `harness-portability.md` 5.1).
 *
 * **Two comparisons, not one, and that is the whole design.** Disk against what
 * this build renders answers "does it differ" and nothing more — and *differs*
 * covers both "an older build wrote it" and "somebody edited it by hand", which
 * want opposite treatment. Adding disk against *what we recorded writing* tells
 * them apart, because only one of those two changes the file after we wrote it.
 *
 * `adr:0015-the-convention-ships-as-skills` left the ageing question open and
 * this is the answer to it. `scc#6` reached the same shape independently, which
 * is where the plan took it from.
 */

/**
 * Where the record lives. Beside the operation log, which is the other thing
 * `.state` holds about our own writes.
 *
 * ---
 *
 * **What this file is trusted for, said out loud.**
 *
 * It is inside the project, so it is committed and arrives with a `git clone`
 * like the convention it describes. That is a requirement rather than an
 * oversight: `adr:0013-the-project-directory-is-the-unit` put the convention in
 * the repository so it reaches everyone who clones, and a record kept outside —
 * in machine-local state, say — would make every cloned project `unknown`
 * forever and `ow update` useless to the colleague this whole plan is for.
 *
 * So the manifest is **exactly as trusted as the repository**, and a security
 * review asked what an attacker who can write to it gains. The honest answer is
 * *very little*, and it is worth writing down rather than leaving to be
 * re-derived:
 *
 * - Somebody who can commit a forged hash can also **just edit the convention
 *   file directly**, in the same commit. The forgery is not an escalation.
 * - The forged path replaces a user's content with **this product's own
 *   rendered text** — never with anything the attacker chose. It can destroy a
 *   local customisation; it cannot inject instructions into an agent's
 *   convention, which is the attack that would actually matter here and is what
 *   `isConfigWrite` (3.3) exists to stop.
 * - **The confirmation is the control.** `ow update` names every file it is
 *   about to rewrite *before* it rewrites it (5.3), so a customisation that has
 *   been re-labelled `updatable` appears in the "to update" list, under the
 *   user's eyes, on a verb they invoked.
 *
 * Signing the manifest was proposed and is not done. A key that travels with
 * the repository signs nothing; a key that does not travel breaks the clone,
 * which is the case this exists to serve. The trade is deliberate, and stating
 * it here is what stops it being made again by accident.
 */
const MANIFEST = join(".state", "managed.json");

export type UpdateOutcome =
  /** On disk exactly as this build renders it. Nothing to do. */
  | "unchanged"
  /** On disk exactly as we recorded writing it, and the build has moved on. Safe to rewrite. */
  | "updatable"
  /**
   * On disk as neither. Somebody changed it after we wrote it.
   *
   * **This is the bucket the task exists for.** It is never written over: 5.2
   * keeps it and names it, and the recorded hash stays at the version we last
   * wrote — which is the base revision a three-way merge would need later.
   */
  | "edited"
  /**
   * Present, and we have no record of writing it.
   *
   * A project scaffolded before this manifest existed is the ordinary case.
   * **Not folded into `updatable`**: we cannot tell whether its content is ours
   * or somebody's, and guessing "ours" would overwrite an edit in every project
   * that predates the record. Unknown is a real answer and is reported as one.
   */
  | "unknown"
  /** Not on disk. A harness just added, or a file somebody deleted. */
  | "missing";

export interface ManagedManifest {
  /** Hash of what we last wrote, per project-relative path. */
  files: Record<string, { hash: string }>;
}

export interface UpdatePlanFile {
  path: string;
  outcome: UpdateOutcome;
}

export interface UpdatePlan {
  files: UpdatePlanFile[];
  byOutcome: Record<UpdateOutcome, string[]>;
  /**
   * Whether applying would change anything.
   *
   * **`edited` is not work.** It will not be touched, so counting it would make
   * `ow update` report something to do and then decline to do it, on every run
   * forever — a report that cries wolf is one people stop reading.
   */
  hasWork: boolean;
}

const EMPTY: Record<UpdateOutcome, string[]> = {
  unchanged: [],
  updatable: [],
  edited: [],
  unknown: [],
  missing: [],
};

/** The content hash. Only the hash is stored — see `recordManaged`. */
export function hashOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Read the record, degrading to "nothing recorded" rather than throwing.
 *
 * It is a cache of hashes about files that are all still on disk, so a corrupt
 * one costs precision and not data: every managed file becomes `unknown`, which
 * is already a bucket with a defined meaning. Refusing to run would let a
 * damaged state file block the very update that would repair the project.
 */
export function readManagedManifest(projectRoot: string): ManagedManifest {
  const file = join(projectRoot, MANIFEST);
  if (!existsSync(file)) return { files: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ManagedManifest;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return { files: {} };
    const files = parsed.files;
    if (typeof files !== "object" || files === null || Array.isArray(files)) return { files: {} };
    return { files };
  } catch {
    return { files: {} };
  }
}

/**
 * Record what was just written, merging with what is already recorded.
 *
 * **Merged, never replaced.** `ow init --codex` on a Claude Code project writes
 * Codex's files and must not forget Claude Code's; a replace would make every
 * file of the harness it did not touch `unknown` on the next run, and 5.4 —
 * gaining a harness — is exactly that call.
 *
 * Only the hash is kept. Storing the content would put a copy of every managed
 * file in `.state`, which is a second record of something the project already
 * holds, and the copy is the one that goes stale.
 */
export function recordManaged(projectRoot: string, written: Record<string, string>): void {
  const manifest = readManagedManifest(projectRoot);
  for (const [rel, content] of Object.entries(written)) {
    manifest.files[rel] = { hash: hashOf(content) };
  }
  const file = assertWithin(projectRoot, join(projectRoot, MANIFEST));
  // **The lesson `seedWiki` learned, that `applyUpdate` and `writeEntryFiles`
  // learned after it, and that this writer had not.** `assertWithin` resolves a
  // symlink and answers about its *target*, so a link planted at
  // `.state/managed.json` and pointing at any other file in the project passes
  // it — and this write then lands there, replacing that file with the
  // manifest. `refuseSymlink` asks about the name instead of what it points at.
  refuseSymlink(file);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/**
 * What `ow update` would do, per managed file.
 *
 * Reports and changes nothing — 5.3 prints this and asks. Separating the answer
 * from the act is what lets a user see the `edited` list before anything runs,
 * and what makes the report-and-stop mode the same code path as the rest.
 */
export function planUpdate(
  projectRoot: string,
  harnesses: readonly Harness[],
  language: Language = "en",
): UpdatePlan {
  const rendered = renderConvention(harnesses, language);
  const manifest = readManagedManifest(projectRoot);

  const files: UpdatePlanFile[] = [];
  const byOutcome: Record<UpdateOutcome, string[]> = {
    unchanged: [],
    updatable: [],
    edited: [],
    unknown: [],
    missing: [],
  };

  for (const [rel, would] of Object.entries(rendered)) {
    const outcome = outcomeOf(projectRoot, rel, would, manifest);
    files.push({ path: rel, outcome });
    byOutcome[outcome].push(rel);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    byOutcome,
    hasWork: byOutcome.updatable.length > 0 || byOutcome.missing.length > 0,
  };
}

/**
 * What one managed file is, right now.
 *
 * Exported because **`writeEntryFiles` has to ask the same question before it
 * writes** (`specs/opening-an-existing-project`, R1.4). A second classifier
 * beside this one is the bug this file already warns about twice: the read that
 * decides and the write that acts have to resolve the same path the same way,
 * or one file is classified and another is rewritten.
 */
export function outcomeOf(
  projectRoot: string,
  rel: string,
  would: string,
  manifest: ManagedManifest,
): UpdateOutcome {
  // **Classified through the same guards the write uses.** A read that resolved
  // differently from the write would classify one file and rewrite another, and
  // this plan has already shipped that class of bug twice — a raw-string
  // classifier in group 3, a text scanner in group 4. `applyUpdate` calls both
  // of these before it writes; so does this, before it decides.
  let file: string;
  try {
    file = assertWithin(projectRoot, join(projectRoot, ...rel.split("/")));
    refuseSymlink(file);
  } catch {
    // A link, or a path resolving outside the project. Neither is a file this
    // product wrote, and `unknown` is the bucket that is never written over.
    return "unknown";
  }

  let actual: string;
  try {
    actual = readFileSync(file, "utf8");
  } catch {
    return "missing";
  }

  const onDisk = hashOf(actual);
  // Identical to what this build would write. True whatever the manifest says,
  // including a project that predates it — there is nothing to do either way,
  // and calling it `unknown` would put busywork in front of a user for a file
  // that is already correct.
  if (onDisk === hashOf(would)) return "unchanged";

  const recorded = manifest.files[rel]?.hash;
  if (recorded === undefined) return "unknown";
  return onDisk === recorded ? "updatable" : "edited";
}

export { EMPTY as EMPTY_OUTCOMES };

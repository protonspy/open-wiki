import {
  createWriteStream,
  existsSync,
  linkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ZipFile } from "yazl";
import { isWithin, resolveReal } from "../paths.js";
import { INBOX } from "../sources/manifest.js";

/**
 * Export a project as one zip — `specs/wiki-export`.
 *
 * **The archive is a project, not a bundle of pages.** Entries keep their
 * project-relative paths, so unpacking produces a directory `ow` opens and every
 * citation still resolves: `adr:0016-a-page-is-its-slug-wherever-it-sits` and
 * `adr:0022-a-source-is-its-id-wherever-it-sits` mean neither a page nor a source
 * ever encoded a location, which is exactly what lets the whole tree move at
 * once. That property is free and worth naming, because a change that flattened
 * the layout would break it while still producing an archive that opens.
 *
 * One implementation, two callers — `ow export` and the desktop's save dialog —
 * which is 9.1's rule.
 */

/** The two trees an export carries, in the order a reader would want them. */
const TREES = ["wiki", "raw"] as const;

/**
 * The name to offer for the archive — **beside** the project, never inside it.
 *
 * Inside is refused (R3.1), so a default that landed there would be a save
 * dialog whose pre-filled answer is rejected the moment the user presses Save,
 * and a `ow export` with no `--out` that always fails.
 *
 * Here rather than in each door, because there are two doors: a second copy is
 * two answers to one question the day somebody changes the naming scheme in one
 * of them.
 */
export function defaultExportPath(projectRoot: string, today: string): string {
  const root = resolve(projectRoot);
  return resolve(root, "..", `${basename(root)}-wiki-${today}.zip`);
}

export interface ExportOptions {
  /** Include `raw/`. Default true: a wiki whose citations open nothing is prose. */
  sources?: boolean;
}

export interface ExportResult {
  files: number;
  /** Uncompressed, which is the number a user recognises as "the size". */
  bytes: number;
  /** Where it landed; absent on a survey, which has not chosen one. */
  path?: string;
}

export class ExportDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportDestinationError";
  }
}

interface Entry {
  /** Absolute path on disk. */
  from: string;
  /** The `/`-separated name inside the archive. */
  name: string;
  bytes: number;
}

/**
 * Whether a link's real target may be archived: inside the tree being walked,
 * and out of the inbox.
 *
 * **Inside the project is not the test — inside the tree being walked is**, and
 * that difference was a reported leak rather than a hypothetical. A symlink at
 * `wiki/leak.md` pointing to `../.state/snapshots/redacted.md` resolves *inside
 * the project*, so a containment check against the root admits it — and
 * `.state/` holds every page as it was before each write. The export then
 * delivers exactly the text somebody removed, to exactly the audience they
 * removed it from, which is the outcome R1.3 exists to prevent. Git ships
 * symlinks, so a clone is enough to plant one.
 *
 * **Exported so it can be tested without a symlink.** Creating a file symlink
 * on Windows needs `SeCreateSymbolicLinkPrivilege`, which most machines and CI
 * runners do not have — so the end-to-end test of this rule skips exactly where
 * the product ships, and a rule pinned only by a skipped test is not pinned.
 * Taking paths rather than touching the disk is what makes it checkable
 * anywhere; the walk above is its only caller.
 */
export function mayArchive(treeRoot: string, inboxDir: string, real: string): boolean {
  return isWithin(treeRoot, real) && real !== inboxDir && !isWithin(inboxDir, real);
}

/**
 * Every file an export would carry, as archive entries.
 *
 * **An allow-list, not a deny-list.** Only `wiki/` and `raw/` are walked, so
 * `.state/` is out by construction rather than by being remembered — which
 * matters, because `.state/` holds every page as it was *before* each write
 * (task 2.8), and an export is the moment somebody hands the project to another
 * person. Shipping it would deliver exactly the text they removed, to exactly
 * the audience they removed it from. The one carve-out inside an included tree
 * is `raw/_inbox/`, which is a doorway rather than content.
 */
function collect(projectRoot: string, options: ExportOptions): Entry[] {
  const root = resolveReal(projectRoot);
  const trees = options.sources === false ? (["wiki"] as const) : TREES;
  const inbox = resolveReal(join(root, "raw", INBOX));
  const entries: Entry[] = [];

  const permitted = (treeRoot: string, real: string): boolean => mayArchive(treeRoot, inbox, real);

  const walk = (treeRoot: string, dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const from = join(dir, item.name);
      // `/` and never `\`: a zip entry name is `/`-separated by specification,
      // and an archive built with the Windows separator opens on Windows and
      // arrives elsewhere as one flat directory of files named
      // `wiki\topics\fenix.md`. It still opens, which is why nothing catches it.
      //
      // Nothing sanitises `item.name` here, and that rests on **where it comes
      // from**: a live `readdirSync`, so it is one path component, and neither
      // Windows nor POSIX admits a separator inside one — nor does Git store
      // `.` or `..` as a tree entry. So no `..` and no absolute name can reach
      // this concatenation, and no zip-slip archive can come out of it. If an
      // entry name ever starts coming from somewhere else — an import, a
      // manifest, a name a caller supplies — that assumption is gone and this
      // needs a check.
      const name = `${prefix}/${item.name}`;

      // A junction needs no privilege on Windows and is *reported as a
      // symbolic link* by `withFileTypes` — verified, not assumed — so this one
      // branch covers both. A non-link needs no check: the path it was reached
      // through was validated on the way down.
      //
      // In practice this guards a link to a **file**. A link to a *directory*
      // is reported as a link rather than a directory, so it never reaches the
      // recursive branch and is dropped below by `!stat.isFile()` — no
      // directory link is followed, wherever it points. That is defence in
      // depth rather than redundancy: it sits one `isDirectory()` away from
      // being the only thing between a planted link and the archive.
      if (item.isSymbolicLink() && !permitted(treeRoot, resolveReal(from))) continue;

      if (item.isDirectory()) {
        // The doorway, not content: emptied by ingestion, cited by nothing.
        if (prefix === "raw" && item.name === INBOX) continue;
        walk(treeRoot, from, name);
        continue;
      }
      if (!item.isFile() && !item.isSymbolicLink()) continue;
      let size: number;
      try {
        const stat = statSync(from);
        // A link to a directory reaches here too — `withFileTypes` describes the
        // link, not its target — and a directory is not an entry.
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        // Deleted between the listing and the stat, or a dangling link. One
        // vanished file must not cost the export the other nine hundred.
        continue;
      }
      entries.push({ from, name, bytes: size });
    }
  };

  for (const tree of trees) {
    // **The tree root is checked too.** The per-entry guard only fires for
    // things found *while* walking, so `wiki/` being itself a junction to
    // somewhere else was walked without question — and a junction needs no
    // privilege to create. That was reported, with a reproduction, and it made
    // the export a way to read an arbitrary directory into an archive the user
    // then sends to somebody.
    const dir = join(root, tree);
    if (!existsSync(dir)) continue;
    if (!isWithin(root, resolveReal(dir))) continue;
    walk(resolveReal(dir), dir, tree);
  }
  return entries;
}

function totals(entries: readonly Entry[]): { files: number; bytes: number } {
  return { files: entries.length, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
}

/**
 * Put the finished archive at `target`, failing rather than replacing whatever
 * is there.
 *
 * `renameSync` replaces silently on both Windows and POSIX, so checking
 * `existsSync` up front and renaming at the end enforces R3.2 at the moment of
 * the *check* and not at the moment of the *write*. Between the two sits a walk
 * of the whole project and a zip of every byte in it — seconds, for a `raw/`
 * with audio in it — and anything that appears at the destination in that window
 * is destroyed without a word.
 *
 * `link` is the fix: it fails with `EEXIST` if the destination exists, which
 * makes "create only if absent" one atomic operation instead of two racing
 * ones. The caller unlinks the temporary name afterwards.
 *
 * Where hard links are unavailable — a FAT volume, some network shares — it
 * falls back to re-checking and renaming. That is the old race, narrowed to the
 * gap between two adjacent statements, and it is a smaller wrong answer than
 * refusing to export at all onto a USB stick.
 */
function claim(tmp: string, target: string, shown: string): void {
  try {
    linkSync(tmp, target);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ExportDestinationError(
        `refused: ${shown} appeared while the archive was being written — nothing was overwritten`,
      );
    }
    if (code !== "EPERM" && code !== "ENOSYS" && code !== "EXDEV" && code !== "EMLINK") throw err;
  }
  if (existsSync(target)) {
    throw new ExportDestinationError(
      `refused: ${shown} appeared while the archive was being written — nothing was overwritten`,
    );
  }
  renameSync(tmp, target);
}

/**
 * What an export would write, without writing it (R2.2) — what the desktop asks
 * before it offers a save dialog, so the size is a decision rather than a
 * discovery.
 *
 * It can disagree with the export that follows, by however much changed in
 * between. Nothing here locks the directory and nothing should: this number is
 * for a human deciding whether to proceed, and `exportProject` reports what it
 * actually wrote.
 */
export function surveyProject(projectRoot: string, options: ExportOptions = {}): ExportResult {
  return totals(collect(projectRoot, options));
}

/**
 * Write the archive, and return what went into it.
 *
 * The write goes to a temporary name beside the destination and is renamed only
 * once the stream has closed (R3.3). A zip truncated halfway still has a local
 * file header for everything it managed, and some readers will open it and show
 * a plausible subset — so an interrupted export must not be able to leave
 * something that looks whole.
 */
export async function exportProject(
  projectRoot: string,
  destination: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const root = resolveReal(projectRoot);
  const target = resolveReal(destination);

  // Inside the project is refused (R3.1) for two reasons at once: it puts a
  // large binary into a directory that is usually a git repository, and an
  // archive written under `wiki/` or `raw/` while the walk is running is an
  // archive that may contain itself. `isWithin` resolves the real path first,
  // so a junction pointing back inside — which needs no privilege on Windows
  // and is not a symlink — is caught rather than followed (task 2.6).
  if (target === root || isWithin(root, target)) {
    throw new ExportDestinationError(
      `refused: ${destination} is inside the project — an export belongs outside the directory it copies`,
    );
  }
  if (existsSync(target)) {
    throw new ExportDestinationError(
      `refused: ${destination} already exists — name a path that does not, or remove it first`,
    );
  }

  const entries = collect(root, options);
  const zip = new ZipFile();
  for (const entry of entries) zip.addFile(entry.from, entry.name);
  zip.end();

  // A random temporary name rather than `${target}.tmp`: a fixed one is a name
  // something else can plant at, and two exports of one project would share it.
  const tmp = join(resolve(destination, ".."), `.ow-export-${randomUUID()}.tmp`);
  try {
    await new Promise<void>((ok, fail) => {
      const out = createWriteStream(tmp);
      zip.outputStream.on("error", fail);
      out.on("error", fail);
      out.on("close", ok);
      zip.outputStream.pipe(out);
    });
    claim(tmp, target, destination);
  } finally {
    // The temp file is gone either way: `claim` leaves it behind on the link
    // path, and a failure anywhere above must not strand a half-written archive
    // beside the one the user asked for.
    rmSync(tmp, { force: true });
  }

  return { ...totals(entries), path: target };
}

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getFileNameLowLevel, open as openZip, type Entry, type ZipFile } from "yauzl";
import { isWithin, resolveReal } from "../paths.js";
import { requireSourceDir } from "./manifest.js";

/**
 * Unpacking an archive into the source's own directory — plan task 6.1.
 *
 * **This is the one place the application looks inside a file**, which is what
 * `adr:0021-sources-are-stored-not-parsed` just stopped it doing everywhere
 * else, so it is fair to ask whether it is the same mistake in a new coat. It
 * is not, and the test is what comes out: unpacking preserves the bytes exactly
 * and produces the files the author wrote, where extraction produces a *lossy
 * interpretation* whose fidelity nobody can check. The first is reversible and
 * verifiable; the second is the thing an agent does better.
 *
 * The case it exists for is a repository as a source: drop a zip of one into
 * `raw/`, and the codewiki skill narrates it. `check/checks.ts` already
 * resolves `[raw/<id>/contents/src/main.rs:48-64]()` as a project-relative
 * path, so that citation form needs nothing new — *provided the tree is
 * unpacked inside the project*, which is what makes every refusal below the
 * price of the feature rather than a precaution.
 *
 * **Every refusal is per entry.** An archive is not one decision, it is one
 * decision per member, and a check that runs once for the destination has
 * already been passed by the time the hostile entry arrives. One bad member
 * costs itself and nothing else: the other ninety-nine land, and the caller is
 * told which did not and why.
 */

/** Where an unpacked tree lives inside the source directory. */
export const CONTENTS = "contents";

/**
 * The marker that says an unpack is in flight — plan task 6.6.
 *
 * **A half-unpacked archive has to be distinguishable from a whole one**, and
 * nothing else on disk can say which it is: a tree of four hundred files looks
 * exactly like a tree of four thousand that stopped. So the marker is written
 * before the first entry and removed after the last, and a directory still
 * carrying it is a source that was interrupted.
 *
 * The same shape task 4.14 gave a recording, which keeps its WAV and its
 * journal until transcription confirms and deletes both — and for the same
 * reason: the state that matters is *did this finish*, the filesystem is the
 * only thing that survives a crash, and a marker present is the one fact a
 * crash cannot forge. It is not a second record of derived state, which 6.1
 * forbids: nothing else observes it.
 */
export const UNPACKING = "unpacking.json";

/**
 * What this can unpack.
 *
 * Deliberately one format. Everything else is still stored — `adr:0021` means
 * nothing is refused for its extension — so the choice here is only about which
 * files additionally get a readable tree beside them. A `.tar.gz` reads as an
 * ordinary source today, which is honest; claiming to unpack a format this
 * cannot read would be the quiet failure.
 */
const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set([".zip"]);

/** True when this source is one `unpackArchive` can open. */
export function isArchive(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  // `> 0`, so a file *named* `.zip` is a name and not an extension.
  return dot > 0 && ARCHIVE_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

export interface UnpackRefusal {
  /** The entry's name exactly as the archive spelled it. */
  entry: string;
  reason: string;
}

/** An agent-configuration file that arrived in the archive, and where it went. */
export interface InertFile {
  /** The path the archive gave it. */
  original: string;
  /** The path it was stored at, which no harness loads. */
  stored: string;
}

export interface UnpackResult {
  /** Entries written. */
  files: number;
  /** Bytes written, which is what a bound is measured against. */
  bytes: number;
  refused: UnpackRefusal[];
  /** The agent configuration this archive carried (task 6.3). */
  inert: InertFile[];
}

/**
 * What is appended to a harness's configuration file so the harness stops
 * recognising it.
 *
 * Visible, pronounceable and greppable on purpose. Somebody reading the tree
 * has to be able to tell at a glance that this file arrived in the archive and
 * was neutralised, not that the repository shipped an oddly-named file.
 */
export const INERT_SUFFIX = ".inert";

/**
 * The names a harness loads as its own instructions or permissions.
 *
 * **An archive carries whatever the repository had**, and a repository
 * routinely has a `CLAUDE.md`. Unpacking it puts a stranger's prompt text and
 * permission rules inside the user's project tree. Task 9.6 refuses
 * *agent-mediated writes* to these paths at the project root; this is neither
 * — it is the application writing, one directory down — so the gate is not
 * bypassed and is also not protecting anything here, which is exactly the sort
 * of gap that reads as covered.
 *
 * Matched **at any depth**, because the root of the tree is the least
 * interesting case: a harness reads a nested `CLAUDE.md` when it touches a file
 * beside it, and a `.claude/` three directories down carries skills all the
 * same.
 *
 * Matched **exactly**, too. `CLAUDE.md.bak`, `docs/claude.md` and `mcp.json`
 * are somebody's files and renaming them would be a different kind of wrong —
 * the rule is the name a harness actually loads, not everything resembling one.
 */
const AGENT_FILES: ReadonlySet<string> = new Set(["CLAUDE.md", ".mcp.json"]);
const AGENT_DIRS: ReadonlySet<string> = new Set([".claude"]);

/**
 * Where an entry's path lands once agent configuration is neutralised, or
 * `undefined` when there is nothing to neutralise.
 *
 * **The bytes are kept and only the name changes**, because the file is
 * evidence: an agent reading this source should be able to see that the
 * repository shipped a `CLAUDE.md` and what it said. Deleting it would answer
 * the safety question by destroying the thing the source exists to preserve.
 * The suffix goes on the *segment* that a harness matches, so `.claude/skills/
 * evil/SKILL.md` is neutralised once, at the directory, rather than at every
 * file under it.
 */
function neutralise(parts: readonly string[]): string[] | undefined {
  let hit = false;
  const out = parts.map((part, i) => {
    const last = i === parts.length - 1;
    if (last ? AGENT_FILES.has(part) : AGENT_DIRS.has(part)) {
      hit = true;
      return part + INERT_SUFFIX;
    }
    return part;
  });
  return hit ? out : undefined;
}

/**
 * The most an archive may expand to on disk.
 *
 * `raw/` is copied bytes that live in the user's project, so this is a disk
 * decision they should make knowingly rather than discover — the same stance
 * task 2.4 took for the size of a single upload. Generous against a repository
 * and nowhere near a bomb: the archives that hit this are the ones designed to.
 */
export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

/**
 * The most an archive may expand *relative to itself*.
 *
 * A separate bound because it catches a different archive. A file that expands
 * ten thousandfold sits comfortably under any total worth setting and is still
 * the shape of an attack rather than of a repository — source code compresses
 * perhaps five to one, generated text perhaps twenty.
 */
export const MAX_RATIO = 100;

export interface UnpackOptions {
  /**
   * Unpack over a `contents/` that is already there. For the tests that need
   * to plant something in the destination first; nothing in the product passes
   * it, because a source directory is written once.
   */
  force?: boolean;
  /** The total bound for this unpack. Defaults to `MAX_UNPACKED_BYTES`. */
  maxBytes?: number;
  /** The ratio bound for this unpack. Defaults to `MAX_RATIO`. */
  maxRatio?: number;
}

/** Thrown when an archive expands past a bound, part-way through expanding. */
export class ExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpansionError";
  }
}

/** The unix file-type mask and the value that means "symbolic link". */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Whether this entry is a symbolic link.
 *
 * yauzl reads `externalFileAttributes` and never interprets it — its own
 * documentation says symlink detection is left to the consumer — so the unix
 * mode in the high sixteen bits is read here. An archive made on Windows
 * leaves those bits zero, which reads as "not a link" and is correct.
 */
function isSymlink(entry: Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & S_IFMT) >>> 0 === S_IFLNK;
}

/**
 * Where this entry may land, or the reason it may not.
 *
 * Three things are checked and the order matters, because the cheap
 * syntactic ones must not be reached through the filesystem:
 *
 * 1. **The name**, before any path is built. An absolute path, a drive letter
 *    and `..` are refused as text — `join` would happily normalise some of
 *    them into something plausible.
 * 2. **The resolved real path**, which is 2.6's rule and the only one that
 *    catches a Windows **directory junction**. A junction needs no privilege,
 *    is not a symlink, and a string prefix comparison walks straight through
 *    one — and it can be planted by an *earlier entry of the same archive*,
 *    which is precisely why this runs per entry rather than once.
 * 3. **Strictly inside**, so an entry naming the contents directory itself is
 *    refused rather than treated as a write to it.
 */
function placeEntry(
  contentsDir: string,
  name: string,
): { path: string; inert?: string } | { reason: string } {
  if (name === "" || name === "." || name === "..") {
    return { reason: `"${name}" does not name a file inside the archive` };
  }
  // Backslashes are separators on Windows and legal in a zip name, so they are
  // normalised before judging rather than after — otherwise `..\\..\\x` reads
  // as one harmless filename here and as a traversal to the filesystem.
  const parts = name.split(/[\\/]/);
  if (parts.some((p) => p === "..")) {
    return { reason: `"${name}" climbs outside the source directory` };
  }
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) {
    return { reason: `"${name}" is an absolute path, and an entry may only name a relative one` };
  }

  // Neutralised before the path is built, so what is confined is the path that
  // is actually written and not the one the archive asked for.
  const inert = neutralise(parts);
  const target = join(contentsDir, ...(inert ?? parts));
  if (!isWithin(contentsDir, target)) {
    return {
      reason:
        `"${name}" resolves to ${resolveReal(target)}, outside the source directory. ` +
        `A directory junction on the way there is the usual reason.`,
    };
  }
  return { path: target, ...(inert ? { inert: inert.join("/") } : {}) };
}

/**
 * Unpack the archive stored at `raw/<id>/` into `raw/<id>/contents/`.
 *
 * Throws for the archive as a whole — an id that names no source, a file that
 * is not a zip, a tree already there — and *returns* what it refused per entry,
 * because those are about one member each and the rest of the archive is still
 * worth having.
 */
export async function unpackArchive(
  projectRoot: string,
  id: string,
  options: UnpackOptions = {},
): Promise<UnpackResult> {
  // Confined, and found rather than joined: a source filed into a folder is not
  // at the path its id spells (task 8.3).
  const dir = requireSourceDir(projectRoot, id);
  const archive = archiveIn(dir);
  if (archive === undefined) {
    throw new Error(`source "${id}" holds no archive to unpack`);
  }

  const contentsDir = join(dir, CONTENTS);
  if (existsSync(contentsDir) && !options.force) {
    throw new Error(
      `source "${id}" already has an unpacked tree. A source directory is written once — ` +
        `unpacking again would merge two archives into a tree matching neither.`,
    );
  }

  // The bound is measured against the archive's own size as well as against a
  // total, so it is read before anything is opened.
  const maxBytes = options.maxBytes ?? MAX_UNPACKED_BYTES;
  const maxRatio = options.maxRatio ?? MAX_RATIO;
  const archiveBytes = statSync(archive).size;
  const ceiling = Math.min(maxBytes, archiveBytes * maxRatio);

  const zip = await openArchive(archive);
  const result: UnpackResult = { files: 0, bytes: 0, refused: [], inert: [] };
  // Written before the first entry, removed after the last. Between those two
  // moments the source is unfinished, and a crash in the middle leaves the one
  // fact that says so.
  mkdirSync(contentsDir, { recursive: true });
  writeFileSync(
    join(dir, UNPACKING),
    JSON.stringify({ archive: basename(archive) }, null, 2) + "\n",
    "utf8",
  );
  try {
    await eachEntry(zip, async (entry) => {
      const name = entryName(entry);
      // A directory entry: nothing to write, and the directories that matter
      // are created for the files that need them. A zip need not carry them.
      if (name.endsWith("/")) return;

      if (isSymlink(entry)) {
        result.refused.push({
          entry: name,
          reason:
            `"${name}" is a symbolic link. The kind is the rule and not the target: ` +
            `deciding per target would decide against a filesystem that can change afterwards.`,
        });
        return;
      }

      const placed = placeEntry(contentsDir, name);
      if ("reason" in placed) {
        result.refused.push({ entry: name, reason: placed.reason });
        return;
      }

      // **Two entries may name one path**, by carrying the same name twice or
      // by planting the neutralised one. Letting the later win produces a tree
      // matching no archive and saying so nowhere, which is the silent kind of
      // wrong the whole module is arranged against — so the second is refused
      // and reported, and the first stays exactly as it landed.
      if (existsSync(placed.path)) {
        result.refused.push({
          entry: name,
          reason:
            `"${name}" would land where an earlier entry of this archive already did. ` +
            `A source directory is written once, so the first one stays.`,
        });
        return;
      }

      if (placed.inert !== undefined) {
        result.inert.push({ original: name, stored: placed.inert });
      }

      mkdirSync(dirname(placed.path), { recursive: true });
      const stream = await entryStream(zip, entry);
      // **Counted while it is written, not after.** A bomb detected once the
      // disk is full has been detected too late, and an archive's declared
      // sizes are the attacker's to choose — so the meter sits in the byte
      // stream, between the decompressor and the file, and throws part-way
      // through an entry as readily as between two of them.
      result.bytes += await writeBounded(stream, placed.path, result.bytes, ceiling, {
        maxBytes,
        maxRatio,
        archiveBytes,
      });
      result.files += 1;
    });
  } catch (err) {
    // A refused archive leaves nothing: a half-unpacked tree is a source that
    // says it holds a repository and holds part of one, which is worse than a
    // source that failed. The marker goes with it, so what remains is an
    // ordinary stored archive that was never unpacked rather than a source
    // frozen mid-flight.
    discardContents(dir);
    rmSync(join(dir, UNPACKING), { force: true });
    throw err;
  } finally {
    zip.close();
  }

  // Sealed. From here `raw/<id>/` is written once and never again — the freeze
  // every citation into the tree depends on, since nothing can check that a
  // line still says what it said when somebody cited it.
  rmSync(join(dir, UNPACKING), { force: true });
  return result;
}

/**
 * True when this source's unpack never finished.
 *
 * The only thing that reads the marker, and the reason the marker is a fact
 * rather than a cache: a tree of four hundred files and a tree of four
 * thousand that stopped at four hundred are the same directory to everything
 * else on disk.
 */
export function isUnpacking(sourceDir: string): boolean {
  return existsSync(join(sourceDir, UNPACKING));
}

/**
 * Write one entry, stopping the moment the total passes `ceiling`.
 *
 * Returns the bytes written. The counter is the stream's own, not the entry's
 * declared `uncompressedSize`: the header is written by whoever built the
 * archive, so trusting it to decide whether to keep reading is asking the
 * attacker how much to allow. `validateEntrySizes` catches the mismatch too,
 * but only for stored entries and only once the entry has been read.
 */
async function writeBounded(
  source: NodeJS.ReadableStream,
  path: string,
  already: number,
  ceiling: number,
  bounds: { maxBytes: number; maxRatio: number; archiveBytes: number },
): Promise<number> {
  let written = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.byteLength;
      if (already + written > ceiling) {
        callback(new ExpansionError(overBound(ceiling, bounds)));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(source, meter, createWriteStream(path));
  return written;
}

/** Which of the two bounds this archive hit, said in the terms it hit them in. */
function overBound(
  ceiling: number,
  bounds: { maxBytes: number; maxRatio: number; archiveBytes: number },
): string {
  if (ceiling === bounds.maxBytes) {
    return (
      `this archive expands past ${bounds.maxBytes} bytes, and unpacking stopped there. ` +
      `raw/ holds copied bytes inside the project, so a tree this size is a decision to ` +
      `make rather than to discover.`
    );
  }
  return (
    `this archive expands to more than ${bounds.maxRatio} times its own size ` +
    `(${bounds.archiveBytes} bytes), and unpacking stopped there. Source code compresses ` +
    `a few times over; an expansion like this is the shape of an attack rather than of a ` +
    `repository.`
  );
}

/** The archive file inside a source directory, if it holds one. */
function archiveIn(dir: string): string | undefined {
  const name = readdirSync(dir).find((entry) => isArchive(entry));
  return name === undefined ? undefined : join(dir, name);
}

/**
 * `validateEntrySizes` stays on: it catches a stored entry whose declared size
 * does not match its data, which is the cheapest zip-bomb tell there is, before
 * the bytes reach any of the rules above.
 *
 * `lazyEntries` is what makes the walk one entry at a time rather than a flood
 * of events — the refusals are sequential decisions and reading them as a race
 * would be a different program.
 *
 * **`decodeStrings: false` is the load-bearing one, and it is not about
 * encodings.** With it on, yauzl runs its own `validateFileName` as each entry
 * is emitted and raises an *archive-level* error for a name that is absolute or
 * climbs out — which aborts the whole zip. That is one decision for the whole
 * archive, and this task exists to make it one decision per member: a hostile
 * entry must cost itself and leave the other ninety-nine landed. So the names
 * arrive raw and `entryName` below decodes them with yauzl's own decoder, which
 * is exported for exactly this.
 */
function openArchive(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    openZip(
      file,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: false },
      (err, zip) => {
        if (err || !zip) reject(err ?? new Error(`${file} is not a readable archive`));
        else resolve(zip);
      },
    );
  });
}

/**
 * The entry's name, decoded the way yauzl would have.
 *
 * `getFileNameLowLevel` is what yauzl calls internally, exported for callers
 * that turned `decodeStrings` off — so this is the same CP437-or-UTF-8 answer,
 * chosen by the same general-purpose bit and the same extra fields, rather than
 * a second decoder that would disagree on the names that are hardest to read.
 * `strictFileNames: false` matches the default, which turns a backslash into a
 * separator: `..\..\x` has to be judged as the traversal it is on Windows, not
 * as one unusual filename.
 */
function entryName(entry: Entry): string {
  return getFileNameLowLevel(
    entry.generalPurposeBitFlag,
    entry.fileNameRaw,
    entry.extraFields,
    false,
  );
}

/** Walk every entry, awaiting the handler before asking for the next. */
function eachEntry(zip: ZipFile, handle: (entry: Entry) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: Entry) => {
      handle(entry).then(
        () => zip.readEntry(),
        (err: unknown) => reject(err),
      );
    });
    zip.readEntry();
  });
}

function entryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error(`cannot read "${entry.fileName}"`));
      else resolve(stream);
    });
  });
}

/** Remove a partially written tree, so a refused unpack leaves nothing behind. */
function discardContents(dir: string): void {
  rmSync(join(dir, CONTENTS), { recursive: true, force: true });
}

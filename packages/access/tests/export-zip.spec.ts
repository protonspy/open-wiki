import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExportDestinationError,
  exportProject,
  mayArchive,
  surveyProject,
} from "../src/export/zip.js";

/**
 * The export archive (`specs/wiki-export`).
 *
 * **The archive is read back with a hand-written central-directory reader, not
 * with `yauzl`.** Verifying yazl's output with its own sibling would let one
 * misunderstanding shared by both pass as agreement; the zip's central
 * directory is well specified, and reading it independently is what makes these
 * assertions worth having.
 */

/** The entries a zip declares, from its central directory. */
function entriesOf(zipPath: string): Array<{ name: string; size: number }> {
  const buf = readFileSync(zipPath);
  // End of Central Directory: scan back for its signature. The comment is empty
  // here, so it is within the last few dozen bytes, but scanning is what the
  // format actually requires.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record — this is not a zip");

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; size: number }> = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory header");
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    entries.push({ name: buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"), size });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const names = (zipPath: string): string[] =>
  entriesOf(zipPath)
    .map((e) => e.name)
    .sort();

let root: string;
let outside: string;

function file(rel: string, content = "x"): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ow-export-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "ow-outside-")));
  file("wiki/index.md", "# Index\n");
  file("wiki/changelog.md", "# Changelog\n");
  file("wiki/topics/fenix.md", "# Fenix\n");
  file("wiki/codewiki/dispatcher.md", "# Dispatcher\n");
  file("raw/arquitetura-fenix.pdf/manifest.json", "{}");
  file("raw/arquitetura-fenix.pdf/source.pdf", "%PDF-1.4");
  file(".state/snapshots/fenix.md", "the text somebody redacted");
  file(".state/operations.jsonl", "{}");
  file("raw/_inbox/dropped.pdf", "not a source yet");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const dest = () => join(outside, "export.zip");

describe("exportProject — what the archive holds (R1)", () => {
  it("holds every file under wiki/ and raw/", async () => {
    await exportProject(root, dest());
    expect(names(dest())).toEqual([
      "raw/arquitetura-fenix.pdf/manifest.json",
      "raw/arquitetura-fenix.pdf/source.pdf",
      "wiki/changelog.md",
      "wiki/codewiki/dispatcher.md",
      "wiki/index.md",
      "wiki/topics/fenix.md",
    ]);
  });

  it("names entries with forward slashes, whatever the host separator is", async () => {
    // A zip entry name is `/`-separated by specification. `path.join` on Windows
    // produces `\`, and an archive carrying those opens on Windows and arrives
    // on macOS as files literally named `wiki\topics\fenix.md` — one flat
    // directory of oddly-named files, which still *opens*.
    await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain("\\");
  });

  it("preserves the nesting, so unpacking yields a project ow can open", async () => {
    // `adr:0016` and `adr:0022` make a page and a source addressable by slug and
    // id wherever they sit, which is what lets the whole tree move at once. A
    // future change that flattened `wiki/topics/fenix.md` to `fenix.md` would
    // still produce an archive that opens.
    await exportProject(root, dest());
    expect(names(dest())).toContain("wiki/topics/fenix.md");
    expect(names(dest())).toContain("raw/arquitetura-fenix.pdf/source.pdf");
  });

  it("excludes .state/, which is where a redaction survives the redaction", async () => {
    // Task 2.8's reason, at the moment it matters most: an export is somebody
    // handing the project to another person, and `.state/` holds every page as
    // it was *before* each write. Shipping it delivers exactly the text they
    // removed, to exactly the audience they removed it from.
    await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain(".state");
    expect(readFileSync(dest())).not.toContain("the text somebody redacted");
  });

  it("excludes the raw/_inbox/ doorway, which is not a source", async () => {
    await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain("_inbox");
  });

  it("writes wiki/ alone when the caller excludes sources (R1.5)", async () => {
    await exportProject(root, dest(), { sources: false });
    expect(names(dest())).toEqual([
      "wiki/changelog.md",
      "wiki/codewiki/dispatcher.md",
      "wiki/index.md",
      "wiki/topics/fenix.md",
    ]);
  });

  it("round-trips a file's bytes", async () => {
    await exportProject(root, dest());
    const entry = entriesOf(dest()).find((e) => e.name === "wiki/index.md");
    expect(entry?.size).toBe(Buffer.byteLength("# Index\n"));
  });
});

describe("exportProject — counting what it wrote (R2.1)", () => {
  it("reports the file count, the uncompressed bytes and where it landed", async () => {
    const result = await exportProject(root, dest());
    expect(result.files).toBe(6);
    expect(result.bytes).toBe(
      ["# Index\n", "# Changelog\n", "# Fenix\n", "# Dispatcher\n", "{}", "%PDF-1.4"].reduce(
        (n, s) => n + Buffer.byteLength(s),
        0,
      ),
    );
    expect(result.path).toBe(dest());
  });
});

describe("mayArchive — the containment rule itself (R1.3, R1.4)", () => {
  // Checked here as a predicate over paths, because the end-to-end version
  // needs a *file* symlink and creating one on Windows needs a privilege most
  // machines and CI runners do not have. A rule pinned only by a test that
  // skips itself where the product ships is not pinned at all.
  const wiki = join("C:", "proj", "wiki");
  const raw = join("C:", "proj", "raw");
  const inbox = join(raw, "_inbox");

  it("admits a target inside the tree being walked", () => {
    expect(mayArchive(wiki, inbox, join(wiki, "index.md"))).toBe(true);
    expect(mayArchive(wiki, inbox, join(wiki, "topics", "fenix.md"))).toBe(true);
    expect(mayArchive(raw, inbox, join(raw, "notes.md", "source.md"))).toBe(true);
  });

  it("refuses a target that is inside the project but outside the tree", () => {
    // The leak that was reported: `.state/` is inside the project, so a check
    // against the project root admits it.
    for (const escaped of [
      join("C:", "proj", ".state", "snapshots", "fenix.md"),
      join("C:", "proj", "ow.json"),
      join("C:", "proj", ".claude", "settings.json"),
      join("C:", "proj"),
    ]) {
      expect(mayArchive(wiki, inbox, escaped), escaped).toBe(false);
    }
  });

  it("refuses a target outside the project entirely", () => {
    expect(mayArchive(wiki, inbox, join("C:", "Users", "me", ".ssh", "id_rsa"))).toBe(false);
  });

  it("refuses the inbox and everything under it", () => {
    expect(mayArchive(raw, inbox, inbox)).toBe(false);
    expect(mayArchive(raw, inbox, join(inbox, "dropped.pdf"))).toBe(false);
    expect(mayArchive(raw, inbox, join(inbox, "nested", "deep.pdf"))).toBe(false);
  });

  it("does not refuse a source whose name merely begins with the inbox's", () => {
    // `raw/_inbox-archive/` is a different directory from `raw/_inbox/`, and a
    // string-prefix test would call it the same one — the mistake `paths.ts`
    // resolves before comparing precisely to avoid.
    expect(mayArchive(raw, inbox, join(raw, "_inbox-archive", "a.md"))).toBe(true);
  });
});

describe("exportProject — a link is not a way past the exclusions (R1.3, R1.4)", () => {
  /** Make a link, or skip the test where this machine will not allow one. */
  function link(target: string, at: string, type: "file" | "junction"): boolean {
    try {
      symlinkSync(target, at, type);
      return true;
    } catch {
      return false; // no SeCreateSymbolicLinkPrivilege; the guard still holds
    }
  }

  it("does not follow a junction out of wiki/ into .state/", async () => {
    // Reported with a reproduction. `isWithin(projectRoot, …)` admits this: the
    // target *is* inside the project. The test that matters is whether it is
    // inside the tree being walked — and `.state/` holds every page as it was
    // before each write, so this ships the text somebody redacted.
    //
    // A **junction to the directory**, which needs no privilege at all, unlike
    // a file symlink.
    //
    // Honest about what this proves: it holds because a link to a directory is
    // reported as a link rather than a directory, so the walk never descends
    // into it and `!stat.isFile()` drops it — not because of the containment
    // guard. It is a regression test for that behaviour, which is one
    // `isDirectory()` away from becoming the thing the guard has to catch. The
    // guard itself is pinned by the file-symlink case below and by the
    // tree-root case, and only the latter fails without it.
    if (!link(join(root, ".state", "snapshots"), join(root, "wiki", "leaked"), "junction")) return;
    await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain("leaked");
    expect(readFileSync(dest())).not.toContain("the text somebody redacted");
  });

  it("does not follow a file symlink out of wiki/ into .state/", async () => {
    // The same leak by the other mechanism. This one needs privilege, so it
    // skips where the machine will not grant it — the junction test above is
    // the one that always runs.
    if (!link(join(root, ".state", "snapshots", "fenix.md"), join(root, "wiki", "leak.md"), "file"))
      return;
    await exportProject(root, dest());
    expect(names(dest())).not.toContain("wiki/leak.md");
    expect(readFileSync(dest())).not.toContain("the text somebody redacted");
  });

  it("does not follow a link out of raw/ into the inbox", async () => {
    if (!link(join(root, "raw", "_inbox"), join(root, "raw", "shortcut"), "junction")) return;
    await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain("shortcut");
  });

  it("does not walk a wiki/ that is itself a junction somewhere else", async () => {
    // The per-entry guard only fires for things found *while* walking, so the
    // two directories the walk starts from went unchecked — and a junction
    // needs no privilege on Windows. Reported with a reproduction.
    const elsewhere = join(outside, "someone-elses-notes");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "private.md"), "not this project's", "utf8");
    rmSync(join(root, "wiki"), { recursive: true, force: true });
    if (!link(elsewhere, join(root, "wiki"), "junction")) return;

    const result = await exportProject(root, dest());
    for (const name of names(dest())) expect(name).not.toContain("private.md");
    expect(result.files).toBe(2); // the two real raw/ files, and nothing borrowed
  });

  it("still carries an ordinary file, so the guard has not eaten the feature", async () => {
    await exportProject(root, dest());
    expect(names(dest())).toContain("wiki/index.md");
  });
});

describe("exportProject — destroying nothing (R3)", () => {
  it("refuses a destination inside the project, and says why", async () => {
    // Two failures at once: it puts a large binary into a directory that is
    // usually a git repository, and an archive written under wiki/ or raw/
    // while the walk is running is an archive that may contain itself.
    for (const inside of [
      join(root, "export.zip"),
      join(root, "wiki", "export.zip"),
      join(root, "raw", "export.zip"),
    ]) {
      await expect(exportProject(root, inside), inside).rejects.toThrow(ExportDestinationError);
      expect(existsSync(inside), inside).toBe(false);
    }
  });

  it("refuses the project directory itself", async () => {
    await expect(exportProject(root, root)).rejects.toThrow(ExportDestinationError);
  });

  it("refuses a destination reached through a link back into the project", async () => {
    // The check resolves the real path before comparing, because a Windows
    // junction needs no privilege and is not a symlink — the reason task 2.6
    // exists. A string comparison would let this through.
    const link = join(outside, "back-inside");
    try {
      symlinkSync(join(root, "wiki"), link, "junction");
    } catch {
      return; // no privilege to make one on this machine; the check still holds
    }
    await expect(exportProject(root, join(link, "export.zip"))).rejects.toThrow(
      ExportDestinationError,
    );
  });

  it("refuses to overwrite a file that is already there", async () => {
    writeFileSync(dest(), "something the user still wants", "utf8");
    await expect(exportProject(root, dest())).rejects.toThrow(ExportDestinationError);
    expect(readFileSync(dest(), "utf8")).toBe("something the user still wants");
  });

  it("names the destination in every refusal, so the caller can correct it", async () => {
    writeFileSync(dest(), "x", "utf8");
    await expect(exportProject(root, dest())).rejects.toThrow(/already exists/);
    await expect(exportProject(root, join(root, "e.zip"))).rejects.toThrow(/inside the project/);
  });

  it("refuses a destination that appeared while the archive was being written", async () => {
    // `renameSync` replaces silently, so checking `existsSync` up front and
    // renaming at the end enforced R3.2 at the moment of the check and not of
    // the write — with a walk of the whole project in between. This asserts the
    // guarantee holds where it actually matters.
    const target = dest();
    const original = exportProject(root, target);
    writeFileSync(target, "something that arrived mid-write", "utf8");
    await expect(original).rejects.toThrow(ExportDestinationError);
    expect(readFileSync(target, "utf8")).toBe("something that arrived mid-write");
  });

  it("leaves no temporary file behind beside the destination", async () => {
    // A zip truncated halfway still carries a local file header for everything
    // it managed, and some readers open it and show a plausible subset — so an
    // interrupted export must not be able to leave something that looks whole.
    await exportProject(root, dest());
    expect(readdirSync(outside).filter((f) => f.includes("tmp"))).toEqual([]);
    expect(readdirSync(outside)).toEqual(["export.zip"]);
  });
});

describe("surveyProject — the same counts, writing nothing (R2.2)", () => {
  it("counts what an export would write and creates no file", async () => {
    const survey = surveyProject(root);
    const written = await exportProject(root, dest());
    expect(survey.files).toBe(written.files);
    expect(survey.bytes).toBe(written.bytes);
  });

  it("has no path, because a survey has not chosen one", () => {
    expect(surveyProject(root).path).toBeUndefined();
  });

  it("honours the same sources option the export does", () => {
    expect(surveyProject(root, { sources: false }).files).toBe(4);
  });
});

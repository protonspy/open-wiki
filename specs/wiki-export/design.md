# Wiki export — design

## What changes

Serves R1.1, R1.2, R1.3, R1.4, R1.5, R2.1, R2.2, R3.1, R3.2, R3.3, R4.1, R4.2, R4.3.

One new module, `packages/access/src/export/zip.ts`, and two callers. It walks
`wiki/` and `raw/`, streams each file into a zip under its project-relative
path, and returns what it wrote. `ow export` and a desktop menu item call it;
neither reimplements any of it, which is 9.1's rule and the same shape task 4.1
gave the manifest writer.

**The archive is a project, not a bundle of pages.** Preserving project-relative
paths (R1.2) is what makes unzipping it produce a directory `ow` opens — the
citations then resolve because they always did: `adr:0022-a-source-is-its-id-wherever-it-sits`
means `src://<id>#p12` never encoded a location, so it survives being moved
wholesale. That property is free here and worth naming, because a future change
that started writing absolute paths, or flattening `wiki/topics/x.md` to `x.md`,
would break it silently — the archive would still open.

## Boundaries and contracts

**`.state/` is excluded, and that is a privacy decision rather than a size one
(R1.3).** Task 2.8 wrote the ignore entries so `.state/` is out of git by
default, with the reason stated there: it "holds every page as it was before
each write, which is where a redaction survives the redaction". An export is
the moment somebody hands the project to another person, so shipping the
snapshot directory would deliver precisely the text they removed, to precisely
the audience they removed it from.

**`raw/_inbox/` is excluded because it is not content (R1.4).** It is a doorway,
emptied by ingestion; `listSources` already skips it, nothing cites it, and a
file sitting in it is work that has not happened yet.

## Data

```
open-wiki-<project>-<date>.zip
  wiki/index.md · wiki/changelog.md · wiki/log.md
  wiki/projects/*.md · wiki/people/*.md · wiki/topics/*.md · wiki/codewiki/*.md
  raw/<id>/manifest.json · raw/<id>/source.pdf
  raw/<id>/mic.opus · raw/<id>/timeline.json · raw/<id>/timeline.vtt · raw/<id>/text.md
```

The result the module returns, and both doors report:

```ts
interface ExportResult {
  files: number;
  bytes: number; // uncompressed, which is what a user recognises as "the size"
  path: string; // absent on a survey
}
```

## Alternatives considered

**Hand-roll the zip writer.** Rejected, and the precedent is in this
repository's own `docs/stack.md`: `hound` was adopted because "a WAV header is
simple enough to hand-roll and easy enough to get subtly wrong — a header
claiming zero frames is what an unfinished file looks like, and every reader
believes it." A ZIP central directory is strictly harder than a WAV header, and
ZIP64 — which `raw/` reaches, because that is where the bytes are — is the part
that is plausible and wrong. A malformed archive is discovered by the person we
handed it to.

**`archiver` rather than `yazl`.** Both stream. `archiver` brings six
transitive dependencies against `yazl`'s one (`buffer-crc32`), and
`@open-wiki/access` currently runs on two runtime dependencies in total. `yazl`
also has a sibling, `yauzl`, which is the natural reader for plan task 6.1 —
and 6.1 needs a reader that does **not** extract for you, because it must refuse
per entry what escapes the destination. Choosing the pair now is choosing it
once.

**No ADR.** The library sits behind one module and the output format is what the
user actually asked for, so swapping it is a contained change. What would have
warranted a record is the format, and "a zip" was the request.

## Risks

**The survey and the write can disagree.** R2.2's count is taken by walking, and
the write walks again — a file added between the two makes the reported size a
lie by however much. Nothing here locks the directory and nothing should: the
number is for a human deciding whether to proceed, not a checksum. The write
reports what it actually wrote (R2.1), which is the number that is true.

**Excluding by prefix is the kind of check that rots.** `.state/` and
`raw/_inbox/` are excluded by name. A future directory holding something private
would be included by default, silently, because the rule is a deny-list. The
alternative — an allow-list of `wiki/` and `raw/` — is what R1.1 already
describes, so the exclusions are a second line rather than the only one, and
`raw/_inbox/` is the only carve-out inside an included tree.

**A link is a way around an allow-list, and the first version had two.** Both
were found by review, with reproductions, and both are worth recording because
the wrong containment check reads exactly like the right one:

- A link inside `wiki/` was checked against the **project root**, so a symlink
  to `../.state/snapshots/redacted.md` resolved _inside the project_ and was
  admitted. The test is containment in the **tree being walked**, not in the
  project. Git ships symlinks, so a clone is enough to plant one.
- The two tree roots were never checked at all, because the per-entry guard only
  fires for entries found _while_ walking. Replacing `wiki/` itself with a
  junction — no privilege required on Windows — exported an arbitrary directory.

What the tests can prove differs by platform, and pretending otherwise would be
the same overclaiming. A link to a _directory_ is reported as a link rather than
a directory, so it is never descended into and never archived, whatever it
points at — that holds without the containment guard. A link to a _file_ is what
the guard actually catches, and creating one on Windows needs
`SeCreateSymbolicLinkPrivilege`, which CI does not necessarily have; that test
skips itself where it cannot run.

So the rule is pinned **as a predicate** rather than only end to end.
`mayArchive(treeRoot, inboxDir, real)` takes paths and touches no disk, which is
what lets it be checked on any machine — and reverting it to the old root-only
containment fails two of its tests. A rule pinned only by a test that skips
itself where the product ships is not pinned at all, and that is the honest
description of what the end-to-end coverage was before.

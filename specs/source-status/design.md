# Source status — design

## What changes

Serves R1.1, R1.2, R1.3, R1.4, R2.1, R2.2, R2.3, R2.4, R3.1, R4.1, R4.2.

One field, one writer, one consumer changed.

**The field is `processed`, in `manifest.json`, holding the date it was
declared.** Absent means unprocessed, so there is no state where the declaration
and its date can disagree, and a manifest written before this change is a valid
manifest of an unprocessed source (R1.2, R1.3). `parseManifest` reads it the way
it already reads `original` — checking rather than asserting, because
`manifest.json` arrives with a `git clone` and is not necessarily something this
application wrote.

**The writer is `updateManifest` in `@open-wiki/access`**, and it is the only
thing in the product that writes a `manifest.json` after registration (R2.1). It
takes the fields to change, reads the manifest, refuses an id that names no
source, and writes through the package's own `atomicWrite`.
`retitleSource` moves out of `apps/desktop/src/main/edit.ts` and becomes a call
into it: the CLI cannot correct a title today, and a status verb built beside a
desktop-only mutator would be the second manifest mutator that 9.1's
one-implementation rule exists to prevent.

**The consumer is the uncited check.** `source.uncited` stops meaning "no page
cites this" and starts meaning "nobody has finished with this": neither declared
processed nor cited (R4.1, R4.2). The finding's `fix` offers both ways out,
because a reader who discarded the source deliberately needs to be told they may
record that — not told a second time to distil it. It names `ow source mark <id>`
now that plan task 4.2 has built the verb; while the verb did not exist it stated
the judgement instead, because a `fix` naming a command nobody can run is the
same noise a `fix` exists to avoid.

`sourceState` carries the declaration beside the derived stage rather than inside
it. Folding `processed` into the `SourceStage` union would put a declared value
and four derived ones in one field, and every reader would have to know which of
its members it may not trust the filesystem for.

## Data

```json
{
  "id": "fnd348r34nr483r.txt",
  "title": "Q3 incident timeline",
  "kind": "file",
  "original": "fnd348r34nr483r.txt",
  "processed": "2026-08-02"
}
```

`SourceState` gains `processed?: string` — the date, absent when it is not
declared. `SourceStage` is untouched.

A `processed` that is present and is not a `YYYY-MM-DD` string degrades to
unprocessed rather than refusing the manifest (R1.4). The direction is chosen: an
unreadable declaration that reads as _unprocessed_ costs a re-read, and one that
reads as _processed_ drops a source out of the queue and out of the uncited check
at once — a source silently never read again. `title` is refused rather than
degraded because there is no safe default for it; here there is.

## Boundaries and contracts

**`source.uncited` is an interface**, not an internal predicate: `ow check
--json` prints it, the findings panel groups by it and a CI job greps it. The
code and the severity are unchanged and the population it reports shrinks, which
is the point — a project with deliberately-discarded sources gets fewer findings
after this than before, and none that it did not already have.

**`raw/` still has two things in it and only one is frozen.** The source —
`source.pdf`, `mic.opus`, an unpacked tree — is written once and never again. The
manifest is the application's record _about_ the source and has been mutable
since task 6.7 made the title correctable. Nothing cites a manifest by position:
no `src://<id>#manifest` exists and no citation resolves into one, so changing a
field here cannot invalidate a reference. Changing a byte of the source can,
which is why one is frozen and the other is not.

## Alternatives considered

**Name the field `status`, with `unprocessed` and `processed` as its values.**
Rejected: plan task 8.5 supersedes a source by reusing the shape task 5.2 gave a
page, which is `status: superseded` plus `superseded-by` plus the date. Spending
`status` on processing now would force 8.5 to invent a second vocabulary for an
idea the wiki already has one for — and the two axes are genuinely independent, a
superseded source having been read or not.

**Exclude cited sources from the unprocessed queue.** A citation looks like proof
that somebody read the source, which would make marking unnecessary on the common
path. Rejected because a citation is not proof of a _complete_ read — a page
about source B may cite source A in passing — and the queue's whole job is to say
what nobody has finished with. A source that leaves the queue because somebody
mentioned it is a source silently never read, which is the failure this feature
exists to remove rather than to relocate. The uncited check uses both facts,
because there the question is different.

**Derive `processed` from something.** There is nothing to derive it from; that
is the finding `adr:0021` records and the only reason this feature exists.

## Risks

**`text.md` has two doors, and the rule has to be on both.** `writeSourceText`
is one. The other is `finishRecording`, which writes through `@open-wiki/audio`
— a package that deliberately does not depend on `@open-wiki/access`, so it
cannot withdraw anything itself. The withdrawal is therefore made by
`transcribe-run.ts`, which imports both, through the same `withdrawProcessed`
the first door calls. The first draft of this had only the upload door, which
left the rule missing from the exact case it was written for: a recording
declared processed before its transcript landed.

That second door is pinned by a source-level assertion rather than a run, because
`runTranscription` needs a configured provider and an ffmpeg binary and CI has
neither — the same gap plan tasks 4.1 and 4.6 already carry. It catches the call
being deleted; it does not prove the call runs.

**R3.1 covers the application's write of `text.md`, not the agent's.**
`adr:0021` makes `text.md` an artifact the agent may write with its own tools,
and `raw/` is not gated the way `wiki/` is — so an agent that writes a transcript
itself leaves a declaration standing over material that changed under it. The
residue is why plan task 8.2 makes the CLI the sanctioned path for touching a
manifest at all.

**A declaration is trusted exactly as far as the project directory is.** A
manifest arrives with a `git clone`, so a repository can ship a source already
marked processed and it will not be reported as uncited. That is deliberate and
not a hole this feature opens: `wiki/`, `raw/` and `ow.json` all arrive the same
way, and a repository that wanted to hide a source could simply not ship it. The
check is hygiene over the user's own work, not an audit against whoever wrote the
repository. What the code does guarantee is the narrower thing worth
guaranteeing: nothing a manifest says can make this application write outside
`raw/`, destroy a field it did not understand, or fail on anything but a refusal.

**A date is not a clock.** The declaration records the day, which is what the
page frontmatter's `updated` records too. Two declarations on one day are
indistinguishable, and nothing here needs to tell them apart.

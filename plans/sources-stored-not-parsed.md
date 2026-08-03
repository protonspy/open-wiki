---
autonomy: auto
ci: wait
worktree: per-group
merge: auto
---

# Sources are stored, not parsed

The application takes four file extensions and refuses everything else. For two of
them it runs a text extractor and writes the result to `text.md`, which is what every
downstream reader consumes. That was decided task by task — 3.2, 3.3, 3.4 each named
a format and an adapter — and never as one decision anybody looked at whole.

Looked at whole, it contradicts the thing the product is:

> **Out of scope** — Extraction, summarisation or page writing by the application.
> That is the agent's.
>
> — [[open-wiki]]

A PDF extractor is extraction by the application. It was built anyway, because "reduce
each source to text with provenance anchors" read like plumbing rather than like the
clause it sits next to.

**The correction: the application stores the original and records what happened to it.
Reading it is the agent's job.** An agent that can open a PDF as a document and an
image as an image gets a better answer than any text extractor hands it — layout,
tables, diagrams and figures survive, and those are exactly what a text extraction
drops. And the set of things a source can be stops being a list somebody maintains.

## What is there today

| Fact | Where |
| --- | --- |
| Four extensions, hard refusal outside them | `packages/access/src/sources/upload.ts:35-40` |
| **A second copy of that table**, in the desktop | `apps/desktop/src/main/ingest.ts:24-29` |
| PDF and DOCX extracted to `text.md` on ingest | `sources/pdf.ts`, `sources/docx.ts` |
| `text-ready` derives from `text.md` existing | `sources/state.ts:120` |
| MCP hands the agent `text.md`, never the original | `packages/mcp/src/tools.ts:98` |
| A document citation checks its **shape only** | `store/provenance.ts:37` — `/^p\d+$/` |
| The manifest is already mutated after write — but only by the desktop | `apps/desktop/src/main/edit.ts:408` |

Two of those are worth stating plainly before anything is built on them.

**Document provenance was never validated.** `FILE_FRAGMENT` checks that a fragment
looks like `p12`; nothing checks that page 12 exists. So `src://report.pdf#p999`
resolves today. The gap 3.4 recorded for DOCX — "citable only as `src://<id>#p1`,
which resolves to the source but to no place inside its `text.md`" — was never
specific to DOCX. **This plan does not weaken document provenance, because there is
none to weaken**, and pretending otherwise would be the wrong reason to reject it.

**`retitleSource` lives in the desktop process**, not in `@open-wiki/access`. So the
CLI cannot correct a title, and a CLI verb that marks a status would be a second
manifest mutator in a second place — against 9.1's one-implementation rule. The move
comes with this work rather than after it.

## The one thing that has to be persisted, and why 6.1 still holds

6.1 decided source state is **derived, never persisted**: `manifest.json` says
received, `text.md` says the text is ready, the pages say what is cited. "A state file
beside those would be a second record of one fact, and the copy is the one that goes
stale."

That rule is right and it is not what this breaks. The question is whether
*processed* is derivable, and it is not:

- The agent read the source and wrote pages from it → derivable, it is `cited`.
- The agent read the source and **found nothing worth writing** → leaves no trace
  anywhere on the filesystem.

The second case is not hypothetical, it is common, and today it is indistinguishable
from a source nobody ever opened. 6.6 reports "a source in `raw/` that no page cites"
— so every deliberately-discarded source becomes a permanent finding. A check that
cries wolf is a check people stop reading, and that is the actual cost of leaving this
underived.

So: **one declared fact, and everything else stays derived.** `processed` is a
judgement somebody made, which is exactly the class of thing a filesystem cannot
observe. It is not a cache of `text.md`, and nothing derivable moves into it.

## Where this widens the risk, honestly

**For the application it narrows.** Today `pdf.ts` parses a stranger's bytes in the
privileged main process — the exact risk 3.7 refused for the inbox, running on the
drop path. Storing bytes and never opening them removes a parser from the trusted
process entirely.

**For the agent it widens.** The agent already reads untrusted source text — 4.13
found a fabricated `## 3:00` heading inside a transcript passage that survived the
provenance check. Handing it PDFs and images extends that from text somebody
extracted to files nobody looked at. This is not a reason to refuse; it is a reason
the skill has to say that a source is evidence, not instructions.

**"Any file" needs a stance on size.** `raw/` is copied bytes and the ignore entries
(2.8) keep audio out of git by default, so a dropped 4 GB video is a disk decision the
user should make knowingly rather than discover.

## The case that proves the rule: a repository as a source

Drop a zip of a repository into `raw/`, and let the agent narrate it with the codewiki
skill. It is the sharpest test of "any file", because a zip is not a document — nothing
reads it as one, and the agent cannot open it the way it opens a PDF.

Three things turned out to be true, and two are good news.

**The codewiki citation form already resolves.** `check/checks.ts:370` matches
`[path/to/file.ts:12-40]()` and resolves the target as a path **relative to the
project**. So `[raw/acme-api-zip/contents/src/main.rs:48-64]()` resolves today, with no
new fragment form and no change to `provenance.ts` — provided the tree is unpacked
inside the project. The anchor question this plan leaves open for PDF and DOCX stays
open and stays theirs; codewiki does not need it.

**`listSources` reads only the top level of `raw/`** (`sources/manifest.ts:138-155`), so
an unpacked repository is one source and not four thousand. Nothing enumerates into it.

**But unpacking is where this stops being free.** Storing opaque bytes is safe precisely
because nothing interprets them. Unpacking interprets structure, and archive formats
have a well-worn set of ways to abuse that: entries whose paths escape the destination,
entries that are symbolic links, and compression ratios that turn a small upload into a
full disk. `assertWithin` and 2.6's real-path resolution are the right primitive, and
they have to run **per entry** rather than once for the destination.

**And an archive carries whatever the repository had — including `CLAUDE.md`,
`.claude/` and `.mcp.json`.** Unpacking puts a stranger's prompt text and permission
rules inside the user's project tree. 9.6 refuses *agent-mediated writes* to those paths
at the project root; this is neither — it is the application writing, one directory
down. The gate is not bypassed and it is also not protecting anything here, which is
exactly the sort of gap that reads as covered. What lands from an archive has to arrive
inert.

## A filename is not a description, and the agent is the only thing that knows better

`fnd348r34nr483r.txt` is a real filename and it says nothing. `adr:0011-sources-are-named-by-what-they-are`
freezes the id from that name, so the id says nothing either, permanently. 6.7 answers
half of it — the title stays editable, which is what made the freeze bearable — and the
other half was never asked: **what this source is about, and why it matters here.**

The agent is the only party that can answer, because answering requires having read the
file. So it should be able to write the answer down, and everything downstream should
be able to read it without opening the source again. That is the whole feature: an
agent that has read `fnd348r34nr483r.txt` records that it is the Q3 incident timeline
and matters to the cutover page, and the next agent, the sources screen and a consulting
project all get that for free.

**It goes in `manifest.json`, and there is no second file.** The manifest already exists,
is already mutated after write (6.7), is already what MCP hands back, and adding a
sibling means two records of one thing — the failure this plan's own 6.1 section is
built around avoiding. A description is a field, and it may be a short paragraph.

**Where the line sits:** if what the agent has to say about a source needs sections, it
is a wiki page citing that source, and writing pages is the entire product. `raw/`
holding prose with structure would be a second wiki that nothing validates, nothing
indexes and no wikilink reaches.

### The bytes are immutable; the record about them is not

Adding fields to `manifest.json` must not read as loosening `raw/`. Two different
things live in that directory and only one of them is frozen:

- **The source** — `source.pdf`, `mic.opus`, an unpacked tree — is written once and
  never again. Nothing edits it, ever.
- **The manifest** — the application's record *about* the source — is already mutable,
  and has been since 6.7 made the title correctable. Metadata joins it there.

The test is whether anything cites it by position. Nobody writes `src://<id>#manifest`,
and no citation resolves into a manifest, so changing a field cannot invalidate a
reference. Changing a byte of the source can, which is why one is frozen and the other
is not.

**And this is where immutability stops being tidiness.** Group 6 puts *line* references
into `raw/` — `[raw/<id>/contents/src/main.rs:48-64]()` — and 7.5 checks such a citation
resolves and does not run past the end of its file. It does not, and cannot, check that
the lines still say what they said. So an edited source file of the same length leaves a
citation that resolves, passes every check, and points at the wrong code, reading
perfectly the whole time. That is precisely the silent-failure class this plan reserves
`(TDD)` for, and the only thing that closes it is the file never changing.

### A correction is a new source that supersedes the old one

"Fix it by uploading another file, then delete the old one" is right, and the wiki
already has the shape for it. 5.2 records supersession as *data* — `status`,
`superseded-by`, and the date — on the page that was replaced, so that "what replaced
this, and when" is answerable by a traversal rather than by reading.

**Sources get the same treatment, for the same reason.** A corrected upload is a new
source that supersedes the old, and every citation into the old one keeps resolving —
at something that now says it was replaced, and by what. Deleting outright is still
allowed and is the last step rather than the mechanism: it breaks every citation into
that source, 7.3 reports each one, and that is the honest cost of removing evidence
somebody built on.

## `raw/` gets a shape, on the model that already exists

Organising `raw/` into folders collides with a frozen id and a citation that spells it —
unless the same decision is made here that `adr:0016-a-page-is-its-slug-wherever-it-sits`
already made for `wiki/`: **a folder is organisation, the id is the name, and uniqueness
of the id is the one rule the model needs.**

That is not an analogy, it is the same decision applied twice, and it buys the same
things: a source can be filed and refiled without a citation changing, `src://<id>` keeps
resolving because it never encoded a location, and the one failure worth reporting is a
duplicate id rather than a guess about which of two was meant.

It costs the enumeration. `listSources` reads only the top level of `raw/` and requires a
`manifest.json` beside each entry (`sources/manifest.ts:138-155`) — the same shape
`listEntityPages` had before `adr:0016`, and the same fix: walk, and address by id. The
unpacked tree of group 6 is what makes getting this right non-optional, because that
directory is full of subdirectories that are emphatically not sources.

## What this changes in [[open-wiki]]

Ticked tasks whose design this supersedes. They are not un-ticked — they shipped and
were correct against what was decided then:

- **3.2, 3.3, 3.4** — the adapters. `text.md` stops being written on ingest for PDF
  and DOCX. For `.md` and `.txt` it is a copy rather than an extraction, so it stays.
- **3.5** — the drop reports what was recognised and what was not. There is almost
  nothing left to refuse; the report becomes what was stored.
- **6.1, 6.6** — derived state gains one declared field, and the uncited check learns
  the difference between unread and read-and-discarded.
- **9.10** — MCP read tools hand back `text.md`. For a source with none, they have to
  say so rather than return nothing.

---

## 1 — The decision, recorded

- [x] 1.1 (Unit) An ADR: the application stores sources and does not parse them, the agent reads the original, and `text.md` becomes an artifact the agent may write rather than one the application always writes. It is hard to reverse — it changes the shape of `raw/`, what every downstream reader consumes, and the contract with the agent — so it is a record and not a paragraph in this file

- [x] 1.2 (Unit) A second ADR: a source is its id wherever it sits under `raw/`, the same decision `adr:0016` made for `wiki/`. It is hard to reverse — it decides what a citation encodes, and a citation that encoded a path would have to be rewritten in every page the day somebody refiles a source

## 2 — Accept any file

- [x] 2.1 (Unit) Collapse the two adapter tables into one place in `@open-wiki/access`. The desktop's copy is drift waiting to happen, and this work would otherwise edit both
- [x] 2.2 (TDD) Store any file: the original is preserved under `raw/<id>/`, the id is still derived and frozen per `adr:0011`, and nothing is refused for its extension. Test-first because it is the write path where a mistake is silent — a file accepted and stored under the wrong name, or outside `raw/`, is not visible until somebody goes looking
- [x] 2.3 (Unit) Stop extracting on ingest. `.md` and `.txt` still get a `text.md`, because copying text that is already text is not extraction; PDF and DOCX no longer do
- [x] 2.4 (Unit) A size stance, said out loud at the moment of the drop rather than discovered in `git status`
- [x] 2.5 (Unit) The drop and inbox reports say what was **stored**, not what was recognised — and a name already taken is still refused as itself, which is `adr:0011`'s deliberate refusal and does not change

## 3 — The status

→ **`specs/source-status/`**

A spec because the requirements are what is actually open: which states exist, which
are derived and which is declared, who may set the declared one, what it means for a
source to go back to unprocessed when its file is replaced, and what 6.6's uncited
check reports once "read and discarded" is expressible. The persistence question is
settled above — one field, in the manifest — but the state model around it is not, and
it is read by the sources pane, the checks, the CLI and MCP.

**Settled.** The field is `processed`, holding the date it was declared, and absent
means unprocessed — so there is no state where the declaration and its date can
disagree, and every manifest written before this is a valid manifest of an
unprocessed source. It is not called `status` because 8.5 needs that name for
supersession, reusing the shape 5.2 gave a page. Nothing else moved out of derived
state. `source.uncited` now takes two facts rather than one, which is what stops a
deliberately-discarded source being a permanent finding.

*A file is never replaced*, so nothing silently goes back to unprocessed: `raw/`'s
bytes are frozen and a correction is a new source that supersedes the old (8.5). The
one way readable content arrives at a source somebody already finished with is
`text.md` landing afterwards — a recording's transcript — and that withdraws the
declaration. It withdraws at **both** doors: `writeSourceText`, and the transcription
pipeline, which writes through `@open-wiki/audio` and so has to withdraw from the
caller that imports both packages. A code review caught the second one missing, which
was the exact case the rule was written for.

## 4 — The CLI, and one manifest mutator

- [x] 4.1 (Unit) Move `retitleSource` from the desktop main process into `@open-wiki/access`, so there is one thing that mutates a manifest — 9.1's rule, and the reason the next task is not a second implementation
  - **Done by `specs/source-status/`**, which needed the mutator to write the declared status and could not build one beside `retitleSource` without creating the second writer this task exists to prevent. It is `updateManifest` in `packages/access/src/sources/update.ts`; `retitleSource` is a call into it.
  - It **keeps the fields it does not model**. `parseManifest` narrows a manifest to the five keys this module knows, so merging a change onto *that* deleted everything else the file held — silently, on a write that returned success, and now on every `text.md` write. A manifest arrives with a `git clone`, and 8.1 is about to put a description in the same file. A security review caught it.
- [x] 4.2 (TDD) `ow source mark <id>` writes the declared status. Test-first for the same reason as 2.2: it is a write, it is the record the agent's own loop depends on, and a status written to the wrong source is a source silently dropped from the queue
  - **Red observed** first: 15 assertion failures across `packages/cli/tests/source.spec.ts` against a signature-only stub.
  - **`mark` and `unmark`, two verbs rather than one verb with a flag.** `--unprocessed` would have meant the opposite of the verb it modified, and it collides with `ow source list --unprocessed`, where the same word *selects* rather than negates. Adding and removing a declaration is what the model actually is: absent **is** unprocessed.
  - **Idempotent, and it keeps the original date.** The loop marks the same source twice for ordinary reasons — a crash mid-run, a retry after a refusal elsewhere. The declaration records *when somebody read the source*, so re-stamping it on a repeat would lose the only fact it carries. It says `already` rather than `marked` when nothing changed, because reporting a write it did not make would train a loop to trust one.
  - The date comes from the CLI's own `today()`, which is local time, not `@open-wiki/access`'s UTC one — so a source marked and a page written in one session carry the same date.
- [x] 4.3 (Unit) `ow source list`, printing JSON, with the unprocessed ones answerable on their own — this is what the agent's loop reads
  - `--unprocessed` is **exactly** "carries no declaration", and deliberately does not also exclude what pages cite. A citation is not proof of a *complete* read — a page about one source may cite another in passing — and a source that left the queue because somebody mentioned it is a source silently never read, which is the failure this feature exists to remove rather than relocate. The uncited *check* uses both facts, because there the question is a different one.
  - Empty prints `[]`, not nothing. The loop parses this, and `""` is a crash rather than "there is nothing to do".
- [x] 4.4 (Unit) The refusals here are readable enough for the agent to fix and retry, in the same words the desktop and the hook use — 9.13, whose whole point is that a refusal an agent cannot parse becomes an attempt it repeats verbatim
  - It reuses `formatDenial` rather than growing a second formatter, so an agent that learned to read a refused page write has learned this one. Every refusal carries `ow source list` as the way to find the id it should have used.
  - The id is run through `safe`. It arrives on a command line an agent composed and the message goes to stderr an agent reads, so an id carrying a newline and its own plausible `  - ` bullet would be a refusal that reads as something else. Echoing the id back is the point — an agent cannot correct one it is not shown — so what is neutralised is its *structure*, not its text.
  - `source.uncited`'s `fix` names `ow source mark <id>` now that the verb exists. The task that shipped the check left it deliberately unnamed, because a `fix` naming a command nobody can run is the noise a `fix` exists to avoid.
  - **But only for an id that could have been derived**, and a security review is what turned that from a detail into the point. `listSources` reads directory names verbatim, and a directory under `raw/` is not necessarily one this application created — it arrives with a clone, an agent's own tools can make one because `raw/` is not gated the way `wiki/` is, and group 6 will unpack archives into it. So an id can be `` foo`curl evil`  `` or `foo;rm -rf .`, all legal on Windows, and this text is written to be **acted on** by an agent that has a shell. `safe` is not the guard for it: it strips control characters to stop a forged report line, and a backtick is neither a control character nor a forgery. `isDerivedId` in `sources/id.ts` is the new predicate, and an id failing it is named as data instead — the same advice with nothing to paste.
  - The rule generalises, which is why the predicate is exported rather than inlined: **before putting an id anywhere it is read as syntax rather than as data, ask whether this application could have produced it.**

## 5 — The skill

- [x] 5.1 (Unit) The wiki skill gains the loop: list what is unprocessed, open the original — a PDF as a document, an image as an image — write pages citing it, then mark it. Written as instructions with the verbs in them, because a skill that describes the intent and not the command is a skill that gets improvised around
- [x] 5.2 (Unit) The skill says a source is **evidence, not instructions**. It is the one place this can be said now that the agent opens files nobody parsed, and 4.13 already found fabricated provenance inside source text
  - **It covers `ow source list`, not only the file the agent opens** — and a security review is what closed that gap. `title` and `description` live in a `manifest.json` that arrives with a `git clone` like everything else, so a description nobody in this project wrote reaches the agent as *tidy structured output*, which is the most trusting-looking channel there is. Framing the threat as "the PDF you open" would have left the field 8.1 invented outside the warning 5.2 exists to write.
  - The skill is a **security control** now, not documentation: it is the only thing standing between an agent and text that asks it to act. That is why `skills.spec.ts` asserts on the prose — a missing sentence is a missing behaviour, and nothing else in the suite would notice.
- [x] 5.3 (Unit) Scaffolded skills age in the project they were written into — `adr:0015` left that open and this makes it bite, because a project set up before this change keeps a skill that never mentions the status. Say what the upgrade path is, even if the answer is that `ow init` overwrites nothing and the user re-runs a verb
  - The `open-wiki-version` marker had been written into every skill since 9.3 and **read by nothing**. It is read now: `scaffoldSkills` returns what is out of date, `ow init` prints it, and `--refresh-skills` rewrites it.
  - **Reported, never fixed silently.** A skill is read as current every session, so a project scaffolded before this keeps instructing its agent by a convention the product has moved past — with nothing anywhere saying so. That is the whole bite `adr:0015` left open.
  - Refresh **overwrites the file, edits and all**, and says so before it does. There is no merge, because a three-way one needs the version last written recorded per file — which is `plans/harness-portability.md` 5.1 and 5.2. All-or-nothing stated plainly beats a merge invented here.
- [x] 5.4 (Unit) The codewiki skill learns that its subject can be a source. Today it narrates *this project's* code; an unpacked repository under `raw/` is code too, and its citations are ordinary project-relative paths that 7.5 already resolves. What it needs said is which tree it is narrating, and that the unpacked tree must not be deleted afterwards
- [x] 5.5 (Unit) The skill describes the source it just read, in the same breath as marking it processed. Reading the file is the expensive part and it has already happened; a description written then costs nothing and a description written later costs the whole read again
  - **8.1 and 8.2 were pulled forward to do this**, and the reason is this group's own subject: a skill is scaffolded *into* a project and ages there (5.3). Writing the loop without `describe` and rewriting it a fortnight later would put the stale version into every project set up in between — which is exactly the failure 5.3 exists to name. One loop, written once.
  - `SKILLS_VERSION` moved to `0.3.0`, so a project on the older convention is reported rather than left quietly wrong.
  - The description is carried on `SourceState` too, so `ow source list` answers it. The point of writing one is that the next reader gets it **without opening the source again**, and a description the loop could not read back would have missed that entirely.

## 6 — Archives, so a repository can be a source

Depends on group 2 and on nothing else. It is last because it is the only part where
the application interprets structure, and everything before it is the reason that is
now a bounded exception rather than the rule.

- [x] 6.1 (TDD) Unpack an archive into the source directory, refusing **per entry** what escapes it: a path that resolves outside after 2.6's real-path check, an entry that is a symbolic link, and an entry that is a Windows directory junction. Test-first without hesitation — this is the boundary class the plan reserves it for, and the failure is that something got through
  - **Red observed** first: 16 assertion failures across `sources-archive.spec.ts` against a signature-only stub.
  - **`decodeStrings: false` is what makes "per entry" possible, and it is not about encodings.** With yauzl's default on, it runs its own `validateFileName` as each entry is emitted and raises an *archive-level* error for a name that is absolute or climbs out — which aborts the whole zip. That is one decision for the whole archive, and this task exists to make it one per member. Names arrive raw and are decoded with `getFileNameLowLevel`, yauzl's own decoder, exported for exactly this — so the answer is the same CP437-or-UTF-8 one rather than a second decoder that would disagree on the hardest names.
  - **The junction is the case the string comparison misses.** It needs no privilege on Windows and is not a symlink, so `isWithin`'s real-path resolution is what catches it. The test creates a real one, and junction creation was confirmed to work on this machine rather than assumed — a security test that silently skips is worse than none. **The first version of this note said the junction could be planted by an earlier entry of the same archive; a code review showed it cannot**, since every symlink-typed entry is refused before anything is written. What the check defends is a junction that was already there, which is a real threat and a different one.
  - **A symbolic link is refused for its kind, not its target.** Deciding per target decides against a filesystem that can change after the decision.
  - **Two entries may name one path** — by carrying the same name twice, which a zip is free to do, or by planting the neutralised name of 6.3. The second is refused and reported rather than overwriting the first, because a tree where a later entry won matches no archive and says so nowhere.
  - The bytes of the fixtures are hand-built (`tests/zip-fixture.ts`): `yazl` validates every path it is given, so it cannot produce `../../escape.txt`, and it exposes nothing for the unix mode that marks a link. The archives an attacker sends are exactly the ones no writer library will build.
  - **A filesystem refusal about one entry is one entry's problem too.** The `existsSync` guard catches a file landing where a file already is, but not the other order — an archive carrying `src` as a file and then `src/x.txt` makes `mkdirSync` throw `ENOTDIR`, and letting that reach the outer catch discarded the whole tree over one member. A code review found it. The bound is still rethrown, because a bomb is a fact about the archive rather than about an entry.
  - **And that per-entry catch had to clean up after itself**, which a second review round caught. A failure part-way through the write — a disk that filled, a path past `MAX_PATH` — has already flushed bytes, and the first version left them: a truncated file under a name the caller was told was refused, uncounted by `bytes`, and enough to make a later entry aimed at the same path read as a collision with something that never landed. `contents/` is meant to be an exact reflection of the archive, so a refused entry now takes its half-written bytes with it. The branch is exercised only for the failure that happens *before* any byte is written (`ENOTDIR`); inducing a real mid-pipeline I/O error in-process needs mocking, and that is said here rather than left to look covered.
- [x] 6.2 (TDD) Refuse an archive that expands beyond a bound, on total size and on ratio, and stop while unpacking rather than after — a bomb that is detected once the disk is full has been detected too late
  - **Red observed** first: 5 assertion failures before the bounds existed.
  - **The meter sits in the byte stream, between the decompressor and the file.** Counting an entry's declared `uncompressedSize` would be asking the attacker how much to allow, and checking after the entry would let one 4 GB member through. It throws part-way through an entry as readily as between two of them, which is what "stop while unpacking" has to mean.
  - **Two bounds, because they catch different archives.** A total (256 MiB) is the disk decision 2.4 already made for a single upload; a ratio (100×) catches the small file that expands ten thousandfold and sits under any total worth setting.
  - The bounds are injectable so the suite does not write a quarter of a gigabyte to prove arithmetic, and one test pins the product's real values so lowering them by accident is a failing test rather than a quieter machine.
  - A refused archive leaves **nothing**: a half-unpacked tree is a source that says it holds a repository and holds part of one.
- [x] 6.3 (TDD) Agent configuration inside an archive lands inert: `CLAUDE.md`, `.claude/` and `.mcp.json` anywhere in the unpacked tree are stored so that no harness loads them as its own, and the source says they were there. Test-first because a miss here is silent and it is somebody else's prompt text inside the user's project
  - **Red observed** first: 6 assertion failures before the rule existed.
  - **The bytes are kept and only the name changes.** The file is evidence — an agent reading this source should see that the repository shipped a `CLAUDE.md` and what it said — so deleting it would answer the safety question by destroying the thing the source exists to preserve. `.inert` is appended to the segment a harness matches, so `.claude/skills/evil/SKILL.md` is neutralised once at the directory rather than at every file under it.
  - **At any depth, and matched exactly.** The root of the tree is the least interesting case: a harness reads a nested `CLAUDE.md` when it touches a file beside it. But `CLAUDE.md.bak`, `docs/claude.md` and `mcp.json` are somebody's files, and renaming them would be a different kind of wrong.
  - The manifest of what arrived is returned as `inert`, so the source says where each one was.
  - **Defeated twice by a security review, and the two ways are worth keeping.** `claude.md` — Windows and default macOS resolve names case-insensitively at the OS layer, so a harness reading `CLAUDE.md` reads it, and nothing fired. `CLAUDE.md::$DATA` — on NTFS that names the *default data stream* of `CLAUDE.md`, the same bytes under the exact name a harness loads. Both landed a hostile file with the archive reporting clean. The rule matches what the filesystem will answer to now: one case-folded set checked on every segment, trailing dots and spaces trimmed, and any colon refused outright in `placeEntry` — a colon in a portable archive entry has no legitimate use, and normalising one would have to guess what was meant.
  - A directory *named* `CLAUDE.md` was the third gap, and it closed itself once the two position-split sets became one checked on every segment.
  - The old test asserting `docs/claude.md` was left alone was **asserting the hole**. It is neutralised now, because it is loadable as `docs/CLAUDE.md` anywhere the filesystem folds case.
- [x] 6.4 (Unit) The unpacked tree is provenance and is kept, the way `adr:0006` keeps the Opus. Deleting it to save space breaks every codewiki citation into it — 7.5 would report them, which is the check working and the evidence gone
  - Nothing deletes the tree, and that is the whole task: `adr:0006` keeps the Opus for the same reason, and deleting this to save space would break every codewiki citation into it — 7.5 reporting those is the check working with the evidence gone.
  - The citation form needed nothing new. `[raw/<id>/contents/src/main.rs:48-64]()` is an ordinary project-relative path that `check/checks.ts` already resolves, **provided the tree is inside the project** — which is what every refusal in 6.1 buys.
- [x] 6.5 (Unit) A stance on what an unpacked archive does to git, written as ignore entries at `ow init` the way 2.8 wrote them for audio. A repository unpacked into `raw/` is thousands of files somebody did not choose to commit
  - `raw/**/contents/` joins the managed block, beside the audio entries 2.8 wrote. The archive itself stays committed and is the thing that actually arrived; the tree is a reading convenience `ow` can produce again from it.
  - The opt-in is the case worth naming: a project whose codewiki pages cite into the tree needs those citations to resolve for everyone, and a negation below the closing marker is how the file says so.
- [x] 6.6 (Unit) Seal the source when unpacking finishes, so `raw/<id>/` is immutable once written and a half-unpacked archive is distinguishable from a whole one — the same shape 4.14 gave a recording, which keeps its WAV until transcription confirms
  - A marker file (`unpacking.json`) written before the first entry and removed after the last, the shape 4.14 gave a recording. Nothing else on disk can express the difference: a tree of four hundred files and a tree of four thousand that stopped at four hundred are the same directory to every other reader.
  - It is **not** a second record of derived state, which 6.1 forbids — nothing else observes it, and *did this finish* is not observable anywhere else after a crash.
  - A refusal removes the marker along with the partial tree, so a refused archive reads as an ordinary stored source rather than as one frozen mid-flight. Those are different states and only one of them asks somebody to act.
  - **The marker is written before `contents/`, not after.** A code review found the other order reachable: a marker write that failed once `mkdirSync` had succeeded left a `contents/` with nothing to say it was never filled, and every later attempt met "already has an unpacked tree" for ever, over a tree nobody had unpacked. The only in-between state now is a marker with no directory, which reads as exactly what it is.

## 7 — What reads it

- [ ] 7.1 (Unit) The sources pane shows each source as what it is: title, description, kind, size, status, and what cites it — and offers the two actions that are not the agent's, correcting a title and marking something processed by hand. A row whose only readable field is `fnd348r34nr483r.txt` is the row this whole group exists for
- [ ] 7.2 (Unit) 6.6's uncited check reports only what is unprocessed *and* uncited, so a source somebody read and discarded stops being a permanent finding
- [ ] 7.3 (Unit) MCP says what it has: a source with no `text.md` reports its status and its filename rather than returning nothing, so a consulting agent knows the difference between empty and unread. It cannot read the original — that project is not on its disk — and saying so is the honest answer
- [ ] 7.4 (Unit) The provenance viewer opens what it is given: an image as an image, a PDF at its page, an unpacked tree as a file listing, anything else named and offered to the system handler. The renderer's CSP is `default-src 'none'` and `img-src 'self' data:`, so this is a real constraint and not a formality
- [ ] 7.5 (Unit) Browse into a source: the files it holds, and an unpacked tree as a tree. Reading one is the agent's job, but *seeing what arrived* is how somebody knows the upload was what they meant
- [ ] 7.6 (Unit) A superseded source says so wherever it is shown, and points at what replaced it — the same thing 8.5 and 6.5 already do for a page and for a broken citation. A citation into a replaced source resolving silently is the outcome supersession exists to prevent

## 8 — Metadata, and the shape of `raw/`

- [x] 8.1 (TDD) The manifest carries what the agent learned: a description, and the fields the status work adds. Test-first because it is a schema other things now read, and because the manifest is the one mutable thing beside immutable bytes — a write that lands in the wrong source, or that truncates a field it did not understand, is silent
  - **Red observed** first: 7 assertion failures across `sources-manifest.spec.ts` and `sources-update.spec.ts` before the field existed. (A code review caught that the note was missing — the red was watched, the record was not written, and `methodology.md` asks for both.)
  - **Bounded on write, unbounded on read**, and the asymmetry is the point. The bound is where this plan's line sits — "if what the agent has to say needs sections, it is a wiki page citing the source" — so it governs what *this application* writes. Applying it on the read path would truncate somebody's data on a file that arrived with a clone, destroying it where nothing asked for a write at all. `ow source list` bounds its own *rendering* instead, which destroys nothing.
  - A blank description is refused rather than stored: a source that reports having one and says nothing is worse than one with none.
  - **The bound on the view lives in `sourceState`, and it took three reviews to put it there.** It went into `ow source list` first; a security review found the MCP tools, which serve the same text to a *consulting* project; a second pass found three desktop call sites. Each fix was correct and each was a copy, so each left the next caller uncovered. It is one function now (`boundedText`), applied where the view is built — the MCP tools bound separately only because they serve `readManifest` directly and never build a `SourceState`.
  - The desktop finding was graded **low** rather than assumed equal to the MCP one: that reader is a human GUI, not an agent, and `description` is not rendered there yet — 7.1's work. Bounding it now is cheaper than rediscovering it during 7.1's own review.
- [x] 8.2 (Unit) `ow source describe <id>` writes it, through the one manifest mutator of 4.1. The CLI is the sanctioned path because `raw/` is not gated the way `wiki/` is: an agent writing `manifest.json` with its own tools would meet no schema at all
- [x] 8.3 (TDD) A source is its id wherever it sits under `raw/`: walk for sources instead of reading one level, address by id, and report a duplicate id as a finding rather than resolving it by picking one. Test-first for the reason `adr:0016` gives — the pre-`adr:0016` `listEntityPages` read one level and made whole directories invisible to the index, the checks and MCP, and nothing failed loudly
  - **Red observed** first: 17 assertion failures across `sources-locate.spec.ts` against a signature-only stub.
  - **The walk stops at a source and does not go inside it**, which is the rule group 6 makes non-optional. An unpacked repository lives under `raw/<id>/` and routinely carries a `manifest.json` of its own — an npm package, an extension — so descending would enumerate somebody else's file as a source of this project, under an id colliding with whatever shared that directory name.
  - It cost the enumeration the plan said it would, across `listSources`, `readManifest`, `sourceExists`, `sourceState`, `writeSourceText`, `updateManifest`, `isIdTaken`, `readTimeMap`, MCP's `sourceTextPath` and the desktop's `locateCitation`. `updateManifest` was the sharp one — writing to `raw/<id>/manifest.json` for a *filed* source would have **created** a second directory carrying that id, so this application would have manufactured the very duplicate the model exists to report.
  - **The first version of this note claimed the fix reached every such place. It did not — and the corrected version was still wrong.** Three sites were missing at the first review, a fourth at the second. The worst was a security finding rather than a loose end: MCP's `sourceTextPath` joined `raw/<id>` while `readManifest` walked, so the two answered about *different directories* for one id — and since the joined path needed no `manifest.json`, a cloned repository could ship a bare `raw/weekly/text.md` and have it served as the text of the real, filed `raw/archive/2026/weekly`. The duplicate-id check cannot see that, because the walk only registers directories holding a manifest. The quietest was `waveformOf`, where `readManifest` walked and confirmed the kind while the directory beside it was joined — so a filed recording drew no waveform and looked exactly like one not yet transcribed.
  - **The fix for that is one function, not more diligence.** `resolvedSourceDir` is the single place the rule lives — find it, or fall back to `raw/<id>`, confined against `raw/` either way — and all six sites call it. The first version hand-rolled that at each site in two different confinement shapes, which is the same lesson this branch had already learned twice in `boundedText` and `readManifestAt`: a rule copied per caller is a rule the next caller does not get. Two reviews finding two more copies each is the evidence, not the anecdote.
  - `isIdTaken` now asks the whole tree. Checking only the top level would let a new upload take an id a filed source already holds, which is the same manufacture by a different door.
  - `INBOX` moved into `locate.ts`. The walk that must skip it now sits *below* `manifest.ts` rather than above it, and leaving the constant where it was made the two modules import each other.
  - **`@open-wiki/audio` still resolves `raw/<id>` and does not walk**, deliberately: access imports audio and never the reverse, so the walk is not reachable from there. The cost is bounded and loud — a recording filed into a folder *before* its transcription finishes fails with ENOENT — and a recording is created at `raw/<id>` and filed, if ever, once it is done. Recorded at `packages/audio/src/seal.ts` rather than left to be rediscovered.
  - **Resolving by id per source made a listing quadratic.** `listSourceStates` called `sourceState` per id, and each of those walked `raw/` twice — once in `readManifest` and once again for the directory. `checkRecords` had the same shape. Both now walk once and carry the directory into `readManifestAt`, which is the hoist `checkLinks` already does for `linkableSlugs` and for the same reason. A security review raised it as a denial-of-service angle on the read-only MCP surface, which is the framing that makes it worth fixing rather than noting.
  - **The hoist introduced a `blocker`, and the shape of it is worth keeping.** Answering existence from the index was not equivalent to `sourceExists`, because `sourceExists` also treated a literal `raw/<id>` join as authoritative — so a *path-shaped* id like `2026/q3/weekly`, which the walk names nothing for because the id is `weekly` wherever it sits, landed on a filed source's real directory and resolved. The wrong answer was old; what was new is that only one caller had it. The write gate resolves without an index and `ow check` always builds one, so the gate accepted a page the check refused a moment later — same page, same project, two verdicts. `sourceExists` asks the walk now, which also stops it counting a symlinked directory or the `_inbox` doorway, and the two callers are one rule rather than two rules argued to coincide.
  - **And it was still there in two more places, found by the review of this branch.** `checkProvenance` resolved a source *per citation, per page*, so `ow check` — which the skill tells the agent to run every loop iteration — walked the whole tree once for every citation in the project. `requireSourceDir` asked `sourceDirOf` twice, so every manifest write walked twice. `sourceDirIndex` is the walk hoisted once for the run and threaded through `resolveProvenance`, and `confine` is the confinement rule shared by `resolvedSourceDir` and `requireSourceDir` so fixing the second walk did not hand-roll a second copy of it. Four instances of one regression on one branch is the measurement: resolving by id reads as free and is not.
- [x] 8.4 (Unit) Moving a source between folders changes no citation and no id, which is the property 8.3 exists to give and the one worth a test that would notice if it were lost
  - Asserted as a `mv` and not a migration: the id, the title, the stage, the declaration, the description and `text.md` all survive, `src://<id>` still resolves, and a write after the move lands at the new home rather than recreating the old one.
- [x] 8.5 (TDD) Supersede a source: `superseded-by` and the date on the one replaced, reusing 5.2's shape rather than inventing a second vocabulary for the same idea. Test-first because it is the path that keeps a citation into replaced evidence honest, and the failure mode is that it silently resolves to the old bytes
  - **Red observed** first: 15 assertion failures across `sources-supersede.spec.ts` before the field existed. The CLI verb that follows it was written after that red rather than before its own tests, which is Unit inside a TDD task and is said here rather than left to be assumed.
  - **`status` and `superseded-by` are 5.2's names; the date is `superseded`, not `updated`.** The first two are the vocabulary the glossary's supersession entry defines and `specs/source-status` deliberately left free by not calling its own field `status`. The third diverges on purpose: `updated` on a manifest reads as *when this file last changed*, and correcting a title or writing a description would falsify it within the hour. A field named for the event, holding the day it happened, is the idiom `processed` already set in this same file.
  - **Read as one fact from up to three keys, and either of the two that can carry it is enough.** A manifest arrives with a `git clone`, so `status` without a pointer and a pointer without `status` both occur. Both read as superseded, because the alternative reading is a citation resolving silently to evidence somebody withdrew — which is the whole failure this task exists to close. An unrecognised `status` degrades to active instead, in the same direction and for the same reason as a malformed `processed`: an unknown word is not a claim of supersession.
  - **One `ManifestChange` field for three keys.** They are only meaningful together, so a caller that could set the pointer without the status could leave a manifest asserting two different things about one fact — the disagreement the model is built to make unreachable.
  - **It refuses a replacement that names no source, and `supersedePage` deliberately does not.** The divergence is the point. A page's replacement may legitimately not exist yet, and a dangling `superseded-by` there is a finding something walks every page to report; nothing walks a manifest for one. A source's replacement is bytes already uploaded — `raw/` is frozen, so a correction *is* a new source — which makes this the only place a wrong id is ever caught.
  - **Nothing is scrubbed when the source is not superseded.** `status` is the one modelled name whose unrecognised values are not necessarily this application's garbage: `status: "draft"` in a cloned manifest is somebody's vocabulary, and deleting it the way a malformed `processed` is deleted would destroy data on a write that asked to change a title.
  - **The new field went out unbounded on two surfaces, and that is the third time this exact failure has landed.** A security review found `superseded-by` printed in full by MCP's `listSourcesState` — over HTTP, into a *consulting* project's agent, from a `manifest.json` a clone could have planted — and by `ow graph superseded`. `sourceState` had it right, which is what made the gap invisible: each of the three bounds *a list of fields it knows*, and a field added later is a field the list does not have. The fix is `boundedManifest`, one function that bounds the manifest rather than named fields, and all three views call it. The same shape as `resolvedSourceDir` at 8.3 and `boundedText` at 8.1 — every time, the copy was correct on the day it was written.
    - **And the first `boundedManifest` still missed `original`**, while its own doc claimed every field was cut. A second security round found it, served by MCP's `ow_sources` beside the title. Writing the rule in one place does not by itself make the rule complete; it only makes completing it a single edit. That is the fourth instance of this miss on this branch and worth stating as the measurement it is.
- [x] 8.6 (Unit) `ow graph superseded` walks sources as well as pages, since 9.12's walk already depends on exactly these fields
  - **Two lists, not one flattened array**, and the shape change is deliberate. A page and a source are addressed in different vocabularies — a `slug` against an id, a `type:slug` pointer against a bare source id, `updated` against `superseded` — so merging them would force one onto the other, which is the second-vocabulary mistake 8.5 spends its whole design avoiding, in reverse. The page half is byte-identical to what this printed before; only the top level moved, and the four assertions that pinned the old top level moved with it.
  - Walked from `listSourceRefs`, not `listSourceStates`: the latter reads every journal and every `text.md`, and needs the wiki read as well to fill in `citedBy`, to answer a question about three fields.
  - A manifest that will not parse is skipped rather than fatal, for the reason `listSourceStates` skips one — `raw/` is not gated the way `wiki/` is, and one directory that arrived with a clone must not take the answer about every other source with it.
  - **The skill learned the verb, so `SKILLS_VERSION` moved to `0.4.0`.** A correction path an agent cannot name is a correction path nobody takes — it would go on editing `raw/` in place, which is the silent-citation failure 8.5 exists to close. That is exactly what 5.3 built the staleness report for: a project on the older convention is now reported rather than left quietly wrong.

---

## Notes

**How this plan's loop runs, decided after group 8 stopped it.** The frontmatter's
four answers govern; on top of them, **a review agent returning `blocked` is a finding
to fix and disclose in the PR, not a reason to stop the loop.** Group 8 stopped on
exactly that and the developer's answer was that the decisions in this file already
covered it. So: fix it, say in the PR body that the fix did not go through a further
review round, and carry on to the next group. The other stop conditions in
`plan-run` — CI red twice on one cause, a non-mechanical conflict with `main`, a
decision the plan never made — are unchanged and still stop the loop.

**Provenance for documents is an open question this plan does not close.** Nothing
validates that page 12 exists, before or after. What changes is that the application no
longer even holds the page count, so closing it later means either a metadata probe
that reads structure without extracting text, or accepting that a document is cited
whole. Worth deciding when somebody cites a document wrongly, not before — but worth
writing down now, because "we removed the parser" is otherwise the story of how it
became unfixable.

**Unpacking a container is not extracting text, and the line is worth defending.**
Group 6 is the one place the application looks inside a file, which is what everything
above it just stopped doing — so it is fair to ask whether it is the same mistake in a
new coat. It is not, and the test is what comes out: unpacking preserves the bytes
exactly and produces the files the author wrote, where extraction produces a *lossy
interpretation* whose fidelity nobody can check. The first is reversible and verifiable;
the second is the thing an agent does better. That is also why group 6 is where all the
`(TDD)` in this plan is concentrated: interpreting structure is where the failures are
silent.

**The order that matters.** 2.1 before anything else touches ingest, or the same edit
is made twice in two places. 4.1 before 4.2, or the CLI grows the second manifest
mutator this plan exists partly to prevent. Group 6 after group 2, because unpacking is
a special case of storing and not a parallel path. 8.3 before 6.1, or the walk that
finds sources is written against a `raw/` that has no subdirectories in it yet and then
meets an unpacked repository. The rest is independent.

**Immutability is what makes the checks sufficient, not a preference about tidiness.**
7.5 can tell that a codewiki citation resolves and does not run past the end of its
file. Nothing can tell that the lines still say what they said when somebody cited
them. So a mutable `raw/` would leave a class of wrong citation that passes every check
and reads perfectly — and the whole point of provenance is that it is the thing you can
trust when the prose is wrong.

**What this does not do.** It does not add extraction back under a flag. An adapter
that runs only when asked is still an adapter to maintain, and the agent that could
not read a PDF is a harness limitation the product should not carry a second
implementation for. If that turns out to be wrong, it is an `ow` verb and not an
ingest path — the original is on disk either way, which is the property that makes the
decision cheap to revisit.

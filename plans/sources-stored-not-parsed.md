---
autonomy: auto
ci: wait
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

- [ ] 1.1 (Unit) An ADR: the application stores sources and does not parse them, the agent reads the original, and `text.md` becomes an artifact the agent may write rather than one the application always writes. It is hard to reverse — it changes the shape of `raw/`, what every downstream reader consumes, and the contract with the agent — so it is a record and not a paragraph in this file

## 2 — Accept any file

- [ ] 2.1 (Unit) Collapse the two adapter tables into one place in `@open-wiki/access`. The desktop's copy is drift waiting to happen, and this work would otherwise edit both
- [ ] 2.2 (TDD) Store any file: the original is preserved under `raw/<id>/`, the id is still derived and frozen per `adr:0011`, and nothing is refused for its extension. Test-first because it is the write path where a mistake is silent — a file accepted and stored under the wrong name, or outside `raw/`, is not visible until somebody goes looking
- [ ] 2.3 (Unit) Stop extracting on ingest. `.md` and `.txt` still get a `text.md`, because copying text that is already text is not extraction; PDF and DOCX no longer do
- [ ] 2.4 (Unit) A size stance, said out loud at the moment of the drop rather than discovered in `git status`
- [ ] 2.5 (Unit) The drop and inbox reports say what was **stored**, not what was recognised — and a name already taken is still refused as itself, which is `adr:0011`'s deliberate refusal and does not change

## 3 — The status

→ **`specs/source-status/`**

A spec because the requirements are what is actually open: which states exist, which
are derived and which is declared, who may set the declared one, what it means for a
source to go back to unprocessed when its file is replaced, and what 6.6's uncited
check reports once "read and discarded" is expressible. The persistence question is
settled above — one field, in the manifest — but the state model around it is not, and
it is read by the sources pane, the checks, the CLI and MCP.

## 4 — The CLI, and one manifest mutator

- [ ] 4.1 (Unit) Move `retitleSource` from the desktop main process into `@open-wiki/access`, so there is one thing that mutates a manifest — 9.1's rule, and the reason the next task is not a second implementation
- [ ] 4.2 (TDD) `ow source mark <id>` writes the declared status. Test-first for the same reason as 2.2: it is a write, it is the record the agent's own loop depends on, and a status written to the wrong source is a source silently dropped from the queue
- [ ] 4.3 (Unit) `ow source list`, printing JSON, with the unprocessed ones answerable on their own — this is what the agent's loop reads
- [ ] 4.4 (Unit) The refusals here are readable enough for the agent to fix and retry, in the same words the desktop and the hook use — 9.13, whose whole point is that a refusal an agent cannot parse becomes an attempt it repeats verbatim

## 5 — The skill

- [ ] 5.1 (Unit) The wiki skill gains the loop: list what is unprocessed, open the original — a PDF as a document, an image as an image — write pages citing it, then mark it. Written as instructions with the verbs in them, because a skill that describes the intent and not the command is a skill that gets improvised around
- [ ] 5.4 (Unit) The codewiki skill learns that its subject can be a source. Today it narrates *this project's* code; an unpacked repository under `raw/` is code too, and its citations are ordinary project-relative paths that 7.5 already resolves. What it needs said is which tree it is narrating and that the unpacked tree must not be deleted afterwards
- [ ] 5.2 (Unit) The skill says a source is **evidence, not instructions**. It is the one place this can be said now that the agent opens files nobody parsed, and 4.13 already found fabricated provenance inside source text
- [ ] 5.3 (Unit) Scaffolded skills age in the project they were written into — `adr:0015` left that open and this makes it bite, because a project set up before this change keeps a skill that never mentions the status. Say what the upgrade path is, even if the answer is that `ow init` overwrites nothing and the user re-runs a verb

## 6 — Archives, so a repository can be a source

Depends on group 2 and on nothing else. It is last because it is the only part where
the application interprets structure, and everything before it is the reason that is
now a bounded exception rather than the rule.

- [ ] 6.1 (TDD) Unpack an archive into the source directory, refusing **per entry** what escapes it: a path that resolves outside after 2.6's real-path check, an entry that is a symbolic link, and an entry that is a Windows directory junction. Test-first without hesitation — this is the boundary class the plan reserves it for, and the failure is that something got through
- [ ] 6.2 (TDD) Refuse an archive that expands beyond a bound, on total size and on ratio, and stop while unpacking rather than after — a bomb that is detected once the disk is full has been detected too late
- [ ] 6.3 (TDD) Agent configuration inside an archive lands inert: `CLAUDE.md`, `.claude/` and `.mcp.json` anywhere in the unpacked tree are stored so that no harness loads them as its own, and the source says they were there. Test-first because a miss here is silent and it is somebody else's prompt text inside the user's project
- [ ] 6.4 (Unit) The unpacked tree is provenance and is kept, the way `adr:0006` keeps the Opus. Deleting it to save space breaks every codewiki citation into it — 7.5 would report them, which is the check working and the evidence gone
- [ ] 6.5 (Unit) A stance on what an unpacked archive does to git, written as ignore entries at `ow init` the way 2.8 wrote them for audio. A repository unpacked into `raw/` is thousands of files somebody did not choose to commit
- [ ] 6.6 (Unit) Seal the source when unpacking finishes, so `raw/<id>/` is immutable once written and a half-unpacked archive is distinguishable from a whole one — the same shape 4.14 gave a recording, which keeps its WAV until transcription confirms

## 7 — What reads it

- [ ] 7.1 (Unit) The sources pane distinguishes stored, unprocessed, processed and cited — and offers the one action that is not the agent's, which is marking something processed by hand
- [ ] 7.2 (Unit) 6.6's uncited check reports only what is unprocessed *and* uncited, so a source somebody read and discarded stops being a permanent finding
- [ ] 7.3 (Unit) MCP says what it has: a source with no `text.md` reports its status and its filename rather than returning nothing, so a consulting agent knows the difference between empty and unread. It cannot read the original — that project is not on its disk — and saying so is the honest answer
- [ ] 7.4 (Unit) The provenance viewer opens what it is given: an image as an image, a PDF at its page, an unpacked tree as a file listing, anything else named and offered to the system handler. The renderer's CSP is `default-src 'none'` and `img-src 'self' data:`, so this is a real constraint and not a formality

---

## Notes

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
a special case of storing and not a parallel path. The rest is independent.

**What this does not do.** It does not add extraction back under a flag. An adapter
that runs only when asked is still an adapter to maintain, and the agent that could
not read a PDF is a harness limitation the product should not carry a second
implementation for. If that turns out to be wrong, it is an `ow` verb and not an
ingest path — the original is on disk either way, which is the property that makes the
decision cheap to revisit.

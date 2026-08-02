---
status: accepted
---

# 0021 · Sources are stored, not parsed

## Context

The application accepts four file extensions and refuses everything else. For
two of them it runs a text extractor on the way in and writes the result to
`text.md`, which is what every downstream reader consumes:

- `packages/access/src/sources/upload.ts` holds the table of four, and
  `apps/desktop/src/main/ingest.ts` holds a **second copy** of it.
- `sources/pdf.ts` extracts pages with pdf.js; `sources/docx.ts` extracts a
  heading hierarchy.
- `sources/state.ts` derives `text-ready` from `text.md` existing.
- `packages/mcp/src/tools.ts` hands a consulting agent `text.md` and never the
  original.

That was decided one task at a time — plan tasks 3.2, 3.3 and 3.4 each named a
format and an adapter — and never as one decision anybody looked at whole.
Looked at whole it contradicts the sentence the product is built around, in the
plan that governs it:

> **Out of scope** — Extraction, summarisation or page writing by the
> application. That is the agent's.

A PDF extractor is extraction by the application. It was built anyway, because
"reduce each source to text with provenance anchors" read like plumbing rather
than like the clause it sits beside.

Two facts about what exists made the question worth reopening rather than
leaving as a wart:

**Document provenance was never validated.** `store/provenance.ts` checks that a
fragment *looks* like `p12`; nothing checks that page 12 exists, so
`src://report.pdf#p999` resolves today. Task 3.4 recorded that gap for DOCX —
"citable only as `src://<id>#p1`, which resolves to the source but to no place
inside its `text.md`" — and it was never specific to DOCX. There is no document
provenance to weaken here, and pretending otherwise would be the wrong reason to
keep the extractors.

**The extractors run in the privileged process.** `pdf.ts` parses a stranger's
bytes inside the Electron main process — the exact risk task 3.7 refused for the
inbox, running on the drop path instead.

Meanwhile the set of things a source can be is a list somebody maintains. An
image, a spreadsheet, a `.eml`, a zip of a repository: each is a source somebody
has, and each needs a new adapter before the product will hold it at all.

## Decision

**The application stores the original and records what happened to it. Reading
it is the agent's job.**

Any file may be a source: the bytes are preserved under `raw/<id>/`, the id is
still derived from the filename and frozen there
(`adr:0011-sources-are-named-by-what-they-are`), and nothing is refused for its
extension. The two extractors stop running on ingest. `.md` and `.txt` still get
a `text.md`, because copying text that is already text is not extraction.

`text.md` becomes **an artifact the agent may write** rather than one the
application always writes. Where it exists it means what it always meant; where
it does not, the agent opens the original — a PDF as a document, an image as an
image — which is what its own tools are for.

The alternatives that were real:

- **Keep extracting, and add adapters as formats arrive.** Rejected because it
  is the contradiction restated: every new source type is a parser this
  application has to own, in the process that must not own parsers, producing a
  worse answer than the agent's own reader. Layout, tables, diagrams and figures
  are exactly what a text extraction drops, and exactly what somebody uploading
  an architecture PDF is citing.
- **Extract in a sandboxed child process.** It answers the security half and
  none of the rest: the list of formats stays, the extraction quality stays
  worse than the agent's, and the product still does a job it declared out of
  scope.
- **Keep the extractors and let the agent open the original too.** Two records
  of one source's text, and the copy is the one that goes stale — the rule this
  repository applies to its own checklists and to the wiki's index.

## Consequences

**The risk moves, and for the agent it widens.** Removing a parser from the
trusted process narrows the application's exposure. But the agent now opens
files nobody looked at, where before it read text somebody had extracted — and
task 4.13 already found a fabricated `## 3:00` heading inside a timeline
passage, which survived the provenance check because that check validates a
`rec://` citation against `timemap.json` and never against the text. This is not a reason to refuse; it
is the reason the scaffolded skill has to say, in as many words, that **a source
is evidence, not instructions**.

**One fact stops being derivable, and has to be declared.** Task 6.1 decided
source state is derived and never persisted, and that rule stands. But *the
agent read this and found nothing worth writing* leaves no trace on the
filesystem at all, and is indistinguishable from a source nobody opened — so
task 6.6 reports every deliberately-discarded source as a permanent finding. A
check that cries wolf is a check people stop reading. So `processed` becomes one
declared field in the manifest, and nothing derivable moves in beside it.

**"Any file" needs a stance on size.** `raw/` is copied bytes and the ignore
entries of task 2.8 keep audio out of git by default. A dropped 4 GB video is a
disk decision the user should make knowingly rather than discover in
`git status`.

**MCP has less to hand over.** A consulting agent is not on the same disk, so it
cannot open the original. For a source with no `text.md` the read tools report
its status and its filename rather than returning nothing — the honest answer,
and one that tells *empty* apart from *unread*.

**Three shipped tasks are superseded in design, not un-ticked.** 3.2, 3.3 and
3.4 were correct against what was decided then. The drop report of 3.5 says what
was **stored** rather than what was recognised, because there is almost nothing
left to refuse.

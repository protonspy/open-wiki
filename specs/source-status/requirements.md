---
autonomy: auto
ci: wait
---

# Source status — requirements

## Purpose

`adr:0021-sources-are-stored-not-parsed` left exactly one fact underived. Every
other thing worth knowing about a source is observable on disk — `manifest.json`
says it was received, `text.md` says there is readable text, the pages say what
cites it, `journal.json` says how far a transcription got — and plan task 6.1
decided that a state file beside those would be a second record of one fact.

_The agent read this source and found nothing worth writing_ is observable
nowhere. It is a judgement somebody made, and it is indistinguishable from a
source nobody ever opened — so today every deliberately-discarded source is a
permanent `source.uncited` finding, and a check that cries wolf is a check people
stop reading.

This settles the model around that one declared fact: what it is, where it lives,
who may write it, what withdraws it, and what the uncited check reports once
"read and discarded" is expressible. It is read by the sources pane, the checks,
the CLI and MCP, which is why it is decided once here rather than four times.

## R1 · One declared fact, everything else derived

- **R1.1** The source store shall record whether a source has been processed as a
  declared field in that source's `manifest.json`, and shall derive every other
  fact it reports about a source from the filesystem.
- **R1.2** While a source's manifest carries no declaration, the store shall report that
  source as unprocessed.
- **R1.3** The source store shall record, with the declaration, the date on which
  the source was declared processed.
- **R1.4** If a manifest's declaration is not a date, then the store shall report that
  source as unprocessed and shall not refuse the manifest.

## R2 · Who declares it

- **R2.1** The project access module shall provide exactly one function that
  writes to a source's `manifest.json`, used by every caller that corrects a
  title or declares a status.
- **R2.2** When a caller declares a source processed, the module shall write the
  declaration and leave every other manifest field unchanged.
- **R2.3** When a caller declares a source unprocessed, the module shall remove the
  declaration from that source's manifest.
- **R2.4** If the id names no source under `raw/`, then the module shall refuse the
  write and name the id.

## R3 · What withdraws a declaration

- **R3.1** When `text.md` is written for a processed source, the store shall remove
  its declaration.

## R4 · What the checks report

- **R4.1** The check module shall report a source that is neither declared
  processed nor cited by any page.
- **R4.2** While a source is declared processed, the check module shall not
  report it as uncited.

## Out of scope

- **The CLI verbs.** `ow source mark`, `ow source list` and their refusals are
  plan tasks 4.2–4.4. This settles what they write; it does not build them.
- **A source's description.** Plan task 8.1 adds it to the same manifest. It is a
  different field answering a different question, and pulling it forward would
  decide its schema here without the work that needs it.
- **Supersession.** Plan task 8.5 gives a source `superseded-by` and a status,
  reusing the shape task 5.2 gave a page. That is why the field named here is not
  called `status`.
- **A third declared value.** _Read and wrote pages_ and _read and found nothing
  worth writing_ are the same declaration seen against the citations, which are
  derived. Declaring the difference would persist something observable.

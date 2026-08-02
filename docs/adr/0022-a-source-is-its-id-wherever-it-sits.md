---
status: accepted
---

# 0022 · A source is its id, wherever it sits under raw/

## Context

`raw/` is flat. `listSources` reads only the top level and requires a
`manifest.json` beside each entry (`packages/access/src/sources/manifest.ts`),
so a source is a directory one level down and nothing else can be.

That was fine while a project had six sources. It stops being fine on two
fronts at once:

- **Sources accumulate and want filing.** A year of weekly recordings, the
  documents from three vendors, the material for one feature — the same pressure
  that produced `wiki/projects/`, `wiki/people/` and `wiki/topics/`.
- **`adr:0021-sources-are-stored-not-parsed` puts trees under `raw/`.** An
  archive unpacked into its source directory is full of subdirectories that are
  emphatically not sources, and an enumeration that walks naively would report
  every one of them.

Organising `raw/` into folders collides with a frozen id
(`adr:0011-sources-are-named-by-what-they-are`) and with a citation that spells
that id — `src://arquitetura-fenix.pdf#p12` — unless the addressing question is
answered first.

It has been answered once already.
`adr:0016-a-page-is-its-slug-wherever-it-sits` faced the same collision in
`wiki/` and settled it: a folder is organisation, a link is a name, and slug
uniqueness is the one rule that model needs. That record also documents what the
flat enumeration cost while it lasted — pages filed by type were invisible to
the index, the orphan check, `ow graph` and the MCP read tools, and every
`[[link]]` to one read as broken, while the gate went on validating writes to
them. The contradiction was quiet because nothing failed loudly.

## Decision

**A source is its id, wherever it sits under `raw/`.** A folder is organisation;
the id is the name.

`listSources` walks the tree instead of reading one level, and a directory is a
source when it holds a `manifest.json` — which is what keeps an unpacked
archive's subdirectories from being mistaken for sources. Addressing is by id
and never by path, so `src://<id>` and `rec://<id>` keep resolving after a
source is filed or refiled, and moving one changes no citation.

**A duplicate id is a finding, not something resolved by picking one** — the
same choice `adr:0016` made for `page.duplicate-slug`, and for the same reason:
`src://checkout` cannot mean two sources, and silently choosing is how a
citation starts pointing at the wrong evidence.

The alternatives that were real:

- **Leave `raw/` flat.** It is the status quo and it does not survive
  `adr:0021`: unpacked trees have to live somewhere, and "somewhere" is under
  the source they belong to.
- **Let a citation encode the path.** Then filing a source rewrites every page
  that cites it, and `adr:0011`'s frozen id buys nothing. This is the option
  that looks harmless and is not.

## Consequences

**Two decisions now share one shape, which is the point.** Pages and sources are
addressed the same way, so a reader who has learned one has learned both, and
the two enumerations can be wrong in the same way — which means a test written
for one is a test somebody knows to write for the other.

**Uniqueness has to be reported, and the report has somewhere to be.** The
checks gain a duplicate-id finding beside `page.duplicate-slug`.

**The id derivation is unchanged, and so is the refusal it carries.** A filename
already taken in the project is still refused rather than given a suffix
(`adr:0011`), and that refusal now has to consider every source in the tree
rather than the ones at the top.

**Enumeration costs a walk.** It is the same cost `adr:0016` accepted for
`wiki/`, over a directory that holds bytes rather than markdown — so a project
with an unpacked repository under `raw/` walks a great many files to list a
handful of sources. If that stops being cheap the answer is an index with an
invalidation story, not a return to one flat level.

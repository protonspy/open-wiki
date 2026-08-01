---
status: accepted
---

# 0016 · A page is its slug, wherever it sits under wiki/

## Context

Two documents described the wiki's shape and did not agree, and the code
implemented a third thing.

- The plan's directory diagram files pages by type:
  `wiki/projects/*.md`, `wiki/people/*.md`, `wiki/topics/*.md`,
  `wiki/codewiki/*.md`.
- The `wiki` skill scaffolded into every project tells the agent to write the
  page at `wiki/<slug>.md`, flat.
- `listEntityPages` read only the **top level** of `wiki/`, and
  `resolveWikilinks` resolved `[[target]]` by testing for `wiki/<target>.md`.

So a project that followed the plan's layout had no pages at all as far as the
store was concerned: nothing appeared in the index, no orphan was ever reported,
`ow graph` returned an empty list, the MCP read tools served nothing, and every
`[[link]]` to such a page read as broken. The gate still validated writes to
them, which is what kept the contradiction quiet — pages were being checked on
the way in and then losing their existence.

Plan task 7.5 recorded a narrower version of this as a design gap to settle
here: it named codewiki, whose pages the gate accepted at the project's top
level while the skill's prose put them under `wiki/`. Building the integrity
checks is what showed the gap was not about codewiki. It was about every
subdirectory.

Whatever settles it has to answer one question — what does `[[checkout]]` name?
— because the whole convention rests on that link resolving.

## Decision

**A page is addressed by its slug: the filename without `.md`, wherever the file
sits under `wiki/`.** A folder is organisation; a link is a name.

- `wiki/checkout.md` and `wiki/topics/checkout.md` are both reached as
  `[[checkout]]`. The flat layout the skill teaches and the typed layout the
  plan draws are the same model, differently filed.
- **A slug is unique across the wiki.** `[[checkout]]` cannot mean two files.
  This is reported as a finding (`page.duplicate-slug`), not resolved by
  picking one — a link silently pointing at the wrong page is worse than a link
  that says it is ambiguous.
- `index.md`, `changelog.md` and `log.md` are the wiki's own pages only at the
  top of `wiki/`. A `wiki/topics/index.md` is an ordinary page called "index".
- **Codewiki lives at `wiki/codewiki/`.** The gate no longer treats a top-level
  `codewiki/` as part of the wiki, because it is not: nothing indexes it,
  nothing links it, nothing can cite it. `ow check` reports it as misplaced
  rather than letting it look right.

This is the model Obsidian uses, which is where `[[wikilink]]` comes from. It is
also the only one that leaves both existing documents true, which matters more
than usual here: the skill is scaffolded into projects and ages there, so a
convention that contradicts the code cannot be fixed by editing one file.

## Consequences

- Pages filed by type become visible: indexed, checked, walked by `ow graph`,
  served over MCP. For a project that already followed the plan's layout this
  looks like a sudden crop of `page.orphan` findings — they were always orphans;
  nothing could see them.
- `resolveWikilinks` walks `wiki/` once per validated write instead of doing one
  `existsSync` per link. It runs on the gate's hot path, so this is a real cost,
  bounded by the number of pages — a few milliseconds for a wiki of hundreds.
  If that ever stops being true, the answer is a cache with an invalidation
  story, not a return to path-shaped links.
- Renaming a page still means fixing the links that pointed at it, but moving
  one between folders now costs nothing — the slug did not change. That is the
  property worth having, and it is why the alternative (path-shaped links like
  `[[topics/checkout]]`) was rejected: it makes filing a decision that breaks
  links, and it breaks the `^[a-z0-9-]+$` slug rule the page schema validates.
- Slug uniqueness is enforced by a check, not by the gate. A write that creates
  a collision is accepted and then reported. Moving it into the gate would be
  better — a collision would never land — and is worth doing when the gate can
  afford the lookup it already does for wikilinks.

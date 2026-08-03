---
status: accepted
---

# 0023 · A finding carries what it found

## Context

`Finding` is what every integrity check reports: a code, a severity, a message,
a fix, and — where the check could point at one — a page, a source and a line.
It is read in three places that are not this repository's to change at will:
`ow check --json` prints it, the MCP tools serve it to a *different* project's
agent, and a CI job greps the codes. It is an interface.

The desktop draws a fix button per finding. Three of the five it draws could not
be built (`plans/desktop-ui.md` 5.3): *Create the page* needs the slug a broken
wikilink names, *Open at 58:04* needs the last instant a recording actually
contains, and *Replace* needs the pair of words a synonym finding is about. Each
of those values **exists at the moment the check reports** — `resolveWikilinks`
has the target, the time map has the duration, the vocabulary check holds both
terms — and each was then formatted into `message` and dropped.

The obvious alternative is to cut the value back out of the sentence. This
repository has already been bitten by that and says so at the site where it
happened: the wikilink check carries `target` on its issue *"rather than being
cut back out of the sentence, which produced garbage the moment the wording
changed"*. A *Create the page* button built that way creates a page called
"Cutover window, which is not a page" the first time somebody rewords a check.

## Decision

**A finding carries the values it found, as fields, beside the sentence it wrote
them into.** Three are added:

- `target` — the slug a broken wikilink names.
- `endsAt` — the last instant a recording contains, when a citation named one
  past it.
- `replace: { avoid, use }` — the word to stop using and the term to use
  instead.

All optional, in the shape `page`, `source` and `line` already established:
present where the check could point at one, absent where it could not. A caller
branches on presence, never on prose.

The general rule this states, for the checks not yet written: **a check that
formats a value into its message puts that value on the finding.** The message
is for a person; the field is for whatever acts on it.

## Consequences

- `ow check --json`, MCP and any CI job reading findings see three new optional
  keys. Additive, so nothing that reads the old shape breaks — but it is a
  published shape, which is why this is a record and not a field somebody added.
- The desktop can build the three buttons `desktop-ui` 5.3 had to leave out, and
  build them from data rather than from parsing.
- *Replace* additionally needs a write that did not exist — rewriting a word
  inside a page, through the gate. It shares one definition of *what counts as
  prose* with the check that reports it (`store/prose.ts`), because a rewrite
  that matched differently from the check would change a word nobody complained
  about and leave the finding standing.
- The cost is that a check now has two places to keep honest, the sentence and
  the field. That is the trade: the sentence may be reworded freely, which is
  precisely what it could not be while a button parsed it.

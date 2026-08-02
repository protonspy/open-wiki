---
autonomy: auto
ci: wait
---

# Wiki pane — requirements

## Purpose

Where the wiki is read. The pane holds a tree of the project's pages grouped by
folder, a warm paper reader for the open page, and a side panel for where that
page came from and what it needs. The reader and its routing are settled
(`markdown.ts`, `specs/desktop-shell`); this spec is the surface the draft drew
and the one question the draft left open — how the tree groups. (Search was the
second; it is now agentic and deferred to the embedded agent — see Out of
scope.)

## R1 · The tree

- **R1.1** The wiki pane shall show every page in the project, grouped by the
  folder it sits in under `wiki/`.
- **R1.2** Where a page sits directly under `wiki/`, the wiki pane shall list it
  without a group header.
- **R1.3** The tree shall show each page's title, or its slug when the page has
  no title.
- **R1.4** When the user chooses a page in the tree, the wiki pane shall open it
  by its slug.
- **R1.5** The tree shall mark the page the reader is showing.
- **R1.6** If two pages share a slug, then the tree shall show both, so the
  duplicate is visible rather than hidden.

## R2 · The reader

- **R2.1** The wiki pane shall show the open page on a warm surface, distinct
  from the chrome around it.
- **R2.2** The reader shall show the page's frontmatter as one chip per entry.
- **R2.3** The reader shall show the page's title as a heading, or its slug when
  the page has no title.
- **R2.4** The reader shall render the page's body with its wikilinks and
  citations as links the application handles.
- **R2.5** Where a wikilink does not resolve, the reader shall show it as broken
  where it appears.
- **R2.6** The reader shall offer editing, renaming and deleting the open page.
- **R2.7** The reader shall render a citation as an amber chip showing its
  fragment, with an icon distinguishing an audio source from a document source.

## R3 · The side panel

- **R3.1** The wiki pane shall show, beside the reader, where the open page came
  from: each source that cites it, as a card.
- **R3.2** When the user chooses a source card, the wiki pane shall open that
  source at the citation's fragment.
- **R3.3** Where a citing source is missing, the side panel shall show it as
  broken, not hide it.
- **R3.4** The wiki pane shall show, beside the reader, the integrity findings
  that concern the open page.
- **R3.5** When a side-panel section would be empty, the wiki pane shall omit the
  section rather than show an empty header.

## R4 · Empty and absent states

- **R4.1** When no page is selected, the reader shall say so, rather than show
  nothing.
- **R4.2** While a page is being read, the reader shall say so, rather than show
  nothing.
- **R4.3** When the wiki has no pages, the wiki pane shall say that the agent
  writes the pages, not the window.

## Out of scope

- **Search.** The plan's group 4 framed search as lexical, reaching
  `ow search`. That is superseded: search will be orchestrated by the embedded
  agent (`specs/embedded-agent/`), which is not yet built, or by an external
  harness over MCP (`adr:0018`, not yet built). This spec ships the pane without
  search and adds it when the agent lands.
- **Claim blocks** (`.claim` / `.decision`). The draft's reader is built around
  them, but they need a markdown syntax and a scaffolded convention the agent
  writes to — a content-model spec, not a pane layout. The reader renders
  standard markdown plus the existing wikilink and citation tokens.
- **The page subtitle.** The draft draws one; the page schema has no field for
  it, and this plan does not change `@open-wiki/access`'s schema.
- **A count on each tree entry.** The draft draws one but gives it no meaning;
  building it would invent one.
- **The provenance viewer** (following a citation) — group 5.4 of
  `plans/desktop-ui.md`.
- **Editing, renaming and deleting.** Already built (8.7–8.9); this spec keeps
  them reachable, it does not rebuild them.
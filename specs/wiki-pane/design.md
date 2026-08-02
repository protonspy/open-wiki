# Wiki pane — design

## What changes

Serves R1.1–R1.6, R2.1–R2.7, R3.1–R3.5, R4.1–R4.4.

The wiki pane replaces the single `<ul>` page list and the `PageBar` /
`Frontmatter` rendering in `App.tsx` with the three-column grid the draft draws —
tree | reader | side — under a pane-bar. The routing (`Shell`, `Location`) and
the markdown rendering (wikilinks, citations) are settled (`specs/desktop-shell`,
`markdown.ts`); this spec does not revisit either. What is new is the surface,
the two open questions the draft left, and the one read the index has to do.

The shell's `<main>` gains a **bleed mode** — no padding, no scroll — so the
pane fills it edge to edge, and each column scrolls itself. The other panes
(sources, checks) keep the padded `<main>` they have today until their own
groups rebuild them the same way.

### The tree is a view of the index, addressed by slug (R1)

A page is its slug wherever it sits under `wiki/`
(`adr:0016-a-page-is-its-slug-wherever-it-sits`), so the tree groups by folder as
**presentation only** and selecting a page carries its slug alone — never its
path. The group is the first path segment after `wiki/`, derived from
`PageRef.path` with no file read; a page directly under `wiki/` has no group and
is listed without a header (R1.2). Two pages sharing a slug are both shown
(R1.6); the duplicate is a finding, not something the tree resolves by picking
one.

The tree shows **titles**, which `PageRef` does not carry. `wikiIndex` in
`apps/desktop/src/main/api.ts` is enriched to read each page's frontmatter
`title` (via the existing `readFrontmatter`) with the slug as the fallback, and
to derive the group from the path. `PageRef` (in `@open-wiki/access`) is
unchanged — the title and group live on a richer type the desktop's `api.ts`
returns, not on the store's type.

### The reader (R2)

The reader is the one warm surface (`--paper`). Frontmatter renders as one chip
per entry (`key <b>value</b>`); an array value renders as its length, the way the
draft's `sources` chip shows a count. The title is an `<h1>` from
frontmatter `title`, falling back to the slug. The body is `renderPageBody`, the
existing token rules unchanged.

The one markdown change is the **citation chip** (R2.7). Today the provenance
rule emits the raw `src://id#p12` as the visible text. The draft's chip shows the
fragment (`14:32`, `p.12`) with an icon by source kind. The rule is changed to
emit the formatted fragment as the visible label and to stamp the existing
`provenance--rec` / `provenance--src` class, from which CSS paints the icon. The
`data-ow-source` and `data-ow-fragment` attributes are untouched — the seek uses
them, not the label, and `renderer.spec` asserts them, so it stays green.

`markdown.ts` cannot render React, so the icon is a CSS `::before` mask keyed on
`provenance--rec` / `provenance--src`, not a lucide component in the token.

**Edit, rename and delete** (R2.6) stay reachable: the existing 8.7–8.9 flows
move into the pane-bar as ghost icon buttons shown when a page is open. The
draft's reader has no such row, but the editor plate the draft _does_ draw is
unreachable without one, so the pane-bar carries them — the draft wins on the
reader surface, and the entry to it is the smallest chrome that does the job.

### The side panel (R3)

Two sections, both fed by data the backend already serves. **Where this page
came from** reuses `sourcesOfPage` (6.5) — rendered inline above the body in
`Panels.tsx` until now — as source cards; choosing one opens the existing
provenance overlay at the citation's fragment, and a missing source is shown
broken, as it is today. It moves out of `Panels.tsx` rather than being copied:
the side column is now the only place the question is answered, and two
renderings of one question drift.

**Needs attention** is the findings the checks already return, each with the
`fix` it already carries (7.6), **filtered by the page's path** — a finding's
`page` is `wiki/topics/retention.md`, never the slug, so matching on the slug
would find nothing at all, on every page, and silently. A section with nothing to
show is omitted, not rendered empty (R3.5).

### Search is deferred

The plan's group 4 framed search as lexical, reaching `ow search`. That is
superseded: search will be orchestrated by the embedded agent
(`specs/embedded-agent/`), which is not yet built, or by an external harness
over MCP (`adr:0018`, not yet built). This spec ships the pane without a search
surface and adds one when the agent lands, so the pane is not blocked on a
larger dependency and does not grow a lexical search the product has decided
against.

### Empty and absent states (R4)

No selection → the reader says so; loading → the reader says so; an empty wiki
shows the existing `EmptyWiki` (1.4) in the reader area. These are the pane's
own structural states; the cross-pane discipline of distinguishing them from
failure is 8.3's job, not this spec's.

One state is decided rather than rendered, in `readerState`, and it is there
because the window opens with an empty index and fills it a moment later: **a
wiki nobody has read yet is not an empty wiki** (R4.4). Collapsed into one
state, every launch of a real project would open on _this wiki is empty, and
this window is not what fills it_ — the same "nothing rendered means nothing is
here" failure this group exists to end, arrived at from the other side. So the
count is `number | null`, and only a successful index read makes it a number.

## Alternatives considered

**The tree shows the slug, not the title.** Rejected: the draft's tree shows
titles and the plan says the draft wins on everything visual. The title read is
bounded — the index already walks every file — and the slug is the fallback
when there is no title.

## Risks

- **Reading frontmatter for every page on every index reload** is O(pages) file
  reads, and the index reloads on each coalesced folder change. Bounded by the
  page count; if it ever stops being, the answer is a cache with an invalidation
  story, not dropping titles.
- **The pane-bar carrying edit/rename/delete** is a placement the draft does not
  draw. Kept to ghost icon buttons so it does not invent chrome the draft
  refused to draw on the reader itself.
- **The side panel makes the checks run while a page is open.** "Needs
  attention" reads the same `findings()` the checks pane does, so a project walk
  now happens whenever a page is open and the folder changed, rather than only
  when that pane is. It is coalesced with every other redraw (120 ms) and
  bounded by the project's size; if it stops being cheap, the answer is one
  fetch shared by both readers, not a panel that stops saying what is wrong with
  the page in front of the reader.

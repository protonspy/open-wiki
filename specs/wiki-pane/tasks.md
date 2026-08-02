# Wiki pane — tasks

## 1 · The index the tree reads

- [x] 1.1 (Unit) Pure helpers `groupOfPage(path)` (the folder under `wiki/`, or `null` for a top-level page) and `titleOfPage(frontmatter, slug)` (the `title` field, or the slug), with unit tests asserting a page under `wiki/topics/x.md` groups as `topics`, a top-level page has no group, and a missing title falls back to the slug — R1.1, R1.2, R1.3
- [x] 1.2 (Unit) Enrich `wikiIndex` in `apps/desktop/src/main/api.ts` so each page carries its `title` and `group` from those helpers, keeping `slugs` and the existing `pages` fields so `shell.spec`'s `wikiIndex` assertions still pass — R1.1, R1.3

## 2 · The pane layout

- [x] 2.1 (Unit) A bleed mode for `<main>` (no padding, no scroll) and a `WikiPane` grid component — a pane-bar over three columns, tree | reader | side — that fills it, replacing the inline wiki rendering in `App.tsx` — R1.1, R2.1
- [x] 2.2 (Unit) The `Tree` component: pages grouped by folder with top-level pages ungrouped, each entry showing its title (fallback slug), the open page marked, and selection navigating by slug; duplicate slugs shown both — R1.4, R1.5, R1.6

## 3 · The reader

- [x] 3.1 (Unit) The `Reader`: the page on a warm `--paper` surface, frontmatter as one chip per entry (arrays as a count), the title as an `<h1>` (fallback slug), and the body via `renderPageBody`; a broken wikilink shown broken where it appears — R2.1, R2.2, R2.3, R2.4, R2.5
- [x] 3.2 (Unit) The citation chip: `markdown.ts`'s provenance rule emits the formatted fragment as the visible label and keeps `data-ow-source` / `data-ow-fragment`, and CSS paints an icon from the `provenance--rec` / `provenance--src` class — amber for audio, document for `src`; `renderer.spec`'s citation attribute assertions stay green — R2.4, R2.7
- [x] 3.3 (Unit) Edit, rename and delete as ghost icon buttons in the pane-bar when a page is open, wired to the existing 8.7–8.9 flows — R2.6

## 4 · The side panel

- [x] 4.1 (Unit) "Where this page came from" as source cards from `sourcesOfPage`, a missing source shown broken, choosing a card opening the provenance overlay at the citation's fragment — R3.1, R3.2, R3.3
- [x] 4.2 (Unit) "Needs attention": the findings about this page, each with its `fix`, omitted when there are none. Matched on the page's **path** — a finding's `page` is `wiki/topics/retention.md`, so the slug this task was first written against would have matched nothing, on every page, silently — R3.4, R3.5

## 5 · Empty and absent states

- [x] 5.1 (Unit) The reader's no-selection and loading states say so rather than showing nothing — including a wiki whose index has not come back yet, which is not an empty wiki and greeted every launch as one — R4.1, R4.2, R4.4
- [x] 5.2 (Unit) The empty wiki (1.4's `EmptyWiki`) shown in the wiki pane when there are no pages — R4.3

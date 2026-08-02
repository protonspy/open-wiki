---
autonomy: auto
ci: wait
---

# Desktop UI — porting the draft, and making the frontend work

`design/desktop-draft.html` is 4,359 lines of settled visual argument: a titlebar, an
icon rail, three panes, a warm reading surface inside a cold instrument, amber for
provenance. `apps/desktop/src/renderer` is 2,639 lines of a different application —
a flat row of text buttons over a single column, a blue accent, and four controls
that do nothing at all in a packaged build.

Group 8 of [[open-wiki]] is ticked all the way down. It is ticked honestly: every
task named a behaviour, and each behaviour exists somewhere reachable. What no task
in group 8 said is **what any of it looks like or how it is arranged**, and 8.1 —
the one that could have — was scoped to "tokens only, in one file" and delivered
exactly that. So the draft was never the acceptance criterion for anything, and the
gap between it and the build was never a finding.

This plan closes that gap, and fixes the four controls first.

## What is actually broken

Three findings, in the order a user meets them.

**1. Every `prompt()` in the renderer is dead.** Electron does not implement
`window.prompt`. `apps/desktop/src/renderer/Launcher.tsx:91` says so, in a comment
written when 8.12 found it and rebuilt the language picker as a form. The other four
call sites were never touched:

| Site | Control | What happens |
| --- | --- | --- |
| `App.tsx:434` | **New page** | nothing — the throw is outside the `try`, so no error appears either |
| `App.tsx:476` | **Rename** | nothing, same shape |
| `Sources.tsx:96` | **retitle a source** (6.7) | nothing |
| `App.tsx:183` | **Record** | starts, but never named — every recording falls back to the timestamp (4.16) |

So **there is no way to create a page in the shipped application.** That is the
literal answer to "where are the wiki pages".

**2. A new project's `wiki/` is empty and stays empty.** `scaffold()` creates the
directory and nothing in it — no `index.md`, no `changelog.md`. Meanwhile
`packages/access/src/skills.ts:108` instructs the agent to "link it from
`index.md`", `checks.ts:123` reports pages unreachable from a file that does not
exist, and the screen says *This wiki has no pages yet* with no hint that the pages
are the agent's job to write. Nothing here is a crash; it is four components each
assuming somebody else made the first move.

**3. The application does not call an LLM, and the UI never says so.** That is the
central architectural decision of the product — the agent writes the pages, this
window validates and records them — and a user who installs the binary and finds an
empty wiki has no way to learn it. The empty state is where that sentence belongs.

None of the three is a backend defect. The backend is real: `@open-wiki/access`
validates, snapshots, logs and undoes; the checks run; the store refuses a bad
citation. The user's reading is right about the symptom and worth correcting on the
cause — **the frontend was built, but built as a harness for the backend rather
than as the application in the draft.**

## Where the draft is stale, and what wins

The draft is dated before the pivot recorded in
`adr:0013-the-project-directory-is-the-unit`. Four things it draws are wrong, and
porting them faithfully would resurrect an architecture that was deliberately
dropped. **The plan wins over the draft on those four**; the draft wins on everything
visual — and on a fifth thing it turned out to be right about all along.

| The draft draws | Settled reality | What gets built |
| --- | --- | --- |
| MCP as an HTTP server on `127.0.0.1:7331` with a Bearer token, agents connecting to it | **the draft was right.** `adr:0018-mcp-over-http-serving-every-project` puts the address and the token back — one resident `ow serve`, one route, every permitted project | the pane broadly as drawn: running state, the address, the token to paste, connected agents |
| `origin mcp` on writes in History | MCP cannot write at all (9.9) | origins are `editor`, `cli`, `hook`, `agent` |
| Onboarding step 1: pick a **workspace folder** holding projects | a project *is* the directory `ow` opened; the registry is a cache, never truth (2.2, `adr:0013`) | step 1 picks or opens **a project**; there is no workspace |
| Settings backed by a `config.json` with a workspace path | project settings in `ow.json`, closed schema, no local path; secrets only in the app data dir (2.7, `adr:0007`) | the sheet shows the two files it actually writes, and the draft's "show the file underneath" idea is kept |
| 8.8 offering **"Save mine as a copy"** | the current gate refuses and shows both versions, on the ground that picking one silently is the only unrecoverable outcome | keep the refusal; add the copy as a third explicit button, since a named copy is not a silent pick |

Everything else in the draft — the palette, the type scale, the rail, the three
panes, the paper reader, the claim blocks, the amber citation chips, the tables, the
check groups with their fix buttons, the provenance transport — is the specification
and is built as drawn.

## Two dependencies this adds

Per `.claude/rules/project.md`, adding one is a two-step act, and both steps are in
the tasks below.

- **`lucide-react`** — the draft's sprite is Lucide, one symbol per icon, so the port
  is one import per symbol. Writing them by hand instead would be re-drawing an icon
  set to avoid a tree-shaken dependency.
- **`clsx`** — class composition for the primitives. Small enough to hand-roll and
  hand-rolled badly often enough to be worth not doing.

No shadcn/ui runtime dependency: shadcn is copied-in source, not a package. What the
draft means by "token names match shadcn/ui" is that the CSS variables are named
`--background`, `--primary`, `--muted-foreground` — so the palette copies straight
into `globals.css`, which is task 2.1.

---

## 1 — The application does not work

First, because it is the complaint, and because every later group is built on top of
a renderer nobody can create a page in.

- [x] 1.1 (Unit) A `Prompt` and a `Confirm` dialog in the renderer, focus-trapped and Escape-dismissable, and every `window.prompt` / `window.confirm` call site converted to them — `App.tsx` new page, `App.tsx` rename, `App.tsx` record occasion, `Sources.tsx` retitle. The record occasion is the one that must keep 4.16's fallback: cancelling names the recording by timestamp rather than refusing to record
- [x] 1.2 (Unit) A lint rule banning `prompt(`, `confirm(` and `alert(` under `src/renderer`, so the next one is a failed build rather than a dead button found by a user. The three are one class: Electron implements `alert` and `confirm` as native modals that block the main process, and does not implement `prompt` at all
- [x] 1.3 (Unit) Seed `wiki/index.md` and `wiki/changelog.md` in `scaffold()`, so the file the skills tell the agent to link from and the file `checks.ts` reads both exist from the first run. `log.md` stays absent until there is a write to record, because it is a log and an empty one is noise
- [x] 1.4 (Unit) An empty wiki explains itself: this application does not write pages, the agent does; the project was scaffolded with skills and a `CLAUDE.md` that say how; and here is the path to open in the harness. Replaces *This wiki has no pages yet*
- [x] 1.5 (Unit) Errors reach the user where they happened. Today every failure in the shell renders as one `<p class="error">` at the top of `main`, so a failed rename and a failed drop are indistinguishable and a failure inside a pane is reported outside it

## 2 — The design system

The draft's tokens, verbatim, and the primitives every later group is assembled
from. `8.1` shipped tokens only; this is the other half.

- [x] 2.1 (Unit) Port `tokens.css` to `globals.css` with the draft's names and values: `--background`/`--foreground`/`--card`/`--popover`/`--muted`/`--border`, the warm `--paper` triple, `--primary` amber `#d99a4e`, the semantic four kept separate from the accent, the 10→32px type scale, `--row: 30px` and `--control: 28px`. Every existing `--surface-*`/`--ink-*` reference migrates in the same task, because a half-migrated palette is two palettes
- [x] 2.2 (Unit) Adopt `lucide-react` and `clsx` — manifest **and** `docs/stack.md`, one line each on why
- [x] 2.3 (Unit) The primitives, one file each, matching the draft's Components plate: `Button` (default, primary, ghost, sm), `IconButton`, `Pill` (neutral, ok, error, cited), `Card`, `Table`, `Switch`, `Dialog`, `Sheet`, `Drawer`, `SearchInput`
- [x] 2.4 (Unit) Focus is visible on every one of them. 8.1 named this and it is the thing a component rewrite silently loses: `outline: none` with nothing in its place is how a desktop UI stops being usable by keyboard

## 3 — The shell

→ **`specs/desktop-shell/`**

Titlebar with the project picker and the recording indicator, the icon rail, the
pane switch, the status bar. It is a spec rather than a checklist because the
routing model genuinely changes: `navigation.ts` today is one `Location` with a view
and a slug, and the draft needs a pane, a selection within it, and overlays (the
settings sheet, the history drawer, the provenance viewer) that are not panes and
must not enter the back stack the way a page does. Getting that wrong makes Back
stop meaning "where I came from", which 8.5 already paid attention to once.

## 4 — The wiki pane

→ **`specs/wiki-pane/`**

The tree, the paper reader, the side panel, and search. A spec because two questions
were open. The tree groups by folder — Projects, People, Topics — while
`adr:0016-a-page-is-its-slug-wherever-it-sits` says a folder is organisation and
nothing more, so the grouping is presentation and must not become a second
addressing scheme. And search had an owner already: `ow search` (9.12) is lexical
over the files, so the pane either reaches it or grows a second implementation that
disagrees with the CLI.

**Both are settled in the spec, and search went the third way**: it is out of
scope there, waiting on the embedded agent (`specs/embedded-agent/`) or on a
harness over MCP (`adr:0018`), rather than the pane growing a lexical search the
product has since decided against. The pane ships without one.

The reader itself is mostly settled: `markdown.ts` already renders wikilinks and
citations as tokens with `data-ow-page`, which is what the amber chips and the
`wikilink` styling hang off.

## 5 — Sources, checks and provenance

The three panes whose behaviour is built and whose surface is a debug list.

- [x] 5.1 (Unit) The sources table as drawn: source with its icon and frozen id, state pill, per-chunk progress, cited count, row actions. Replaces the `<ul>` in `Sources.tsx`
- [x] 5.2 (Unit) The checks pane grouped by check family with the task tag, severity, the `where`, and the `fix` the finding already carries — 7.6 shipped the rendering, this gives it the draft's shape
- [ ] 5.3 (Unit) The fix buttons the draft draws — *Create the page*, *Add to index*, *Open the source*, *Open at 58:04*, *Replace*. Each one is an existing operation; what is new is reaching it from the finding that named it
- [ ] 5.4 (TDD) The provenance viewer: transport, the instant, seek-to-citation, copy this citation. Test-first because it is the time map's last mile — 8.6 seeks to an instant, and an off-by-one here points a citation at the wrong moment while reading perfectly, which is the failure family the plan's own notes reserve TDD for
- [ ] 5.5 (Unit) The waveform, drawn from the Opus. Static and rendered once per source, not live — the draft is explicit that a waveform earns its keep here and nowhere else

## 6 — Settings, history and first run

- [ ] 6.1 (Unit) The settings sheet as drawn, over the two files that actually exist — `ow.json` in the project, secrets in the app data directory — with the file shown underneath, which is the draft's point and is truer here than in the draft because there is no backend to ask
- [ ] 6.2 (Unit) The history drawer, reached from the status bar rather than the rail, with the origin, the time, what changed, and Undo per line. Keeps 8.11's honesty note visible in the drawer: this covers what was observed
- [ ] 6.3 (Unit) First run as the draft's four steps — project, language, transcription, done — with step 1 picking a project directory rather than a workspace, per the table above. The language step already exists in `Launcher.tsx` and moves here rather than being rewritten
- [ ] 6.4 (Unit) The dialogs of the "moments something can be lost" plate, each saying what will happen and each button saying the same thing as the sentence above it. **Three, not the draft's four** — "Serve atlas instead of fenix?" was a consequence of one server holding one current project, and `adr:0018` serves every permitted project at once, so there is nothing to switch and nobody to disconnect

## 7 — The MCP pane

→ **`specs/mcp-pane/`**

Still a spec, but for the opposite reason it was one when this plan was written. The
requirements stopped being contested — `adr:0018-mcp-over-http-serving-every-project`
settled them — and what is left open is what the pane can honestly *show*, which
depends on a server that does not exist yet.

What it answers: whether `ow serve` is running and on which address, the token to
paste into a harness and when it expires, which projects the caller may reach, and
which agents are connected. A project whose directory moved is shown rather than
hidden — the registry stays a cache, `resolve` raises rather than guesses, and 8.4
already decided that such an entry is shown.

**The server itself is not in this plan.** `ow serve`, the JWT and its rotation, the
tool surface (`project_list`, and `project_id` on every other tool), the read-surface
split that keeps read-only a property of the process, and the installer registering a
service and — the part that gets forgotten — deregistering it on uninstall: that is a
body of work of its own, and it blocks this pane rather than living inside it.

## 8 — UX beyond the draft

Things the draft does not draw and the application needs. Each is small; together
they are the difference between a port and an application.

- [ ] 8.1 (Unit) Keyboard: pane switching, focus the search, Escape closes an overlay, and a visible focus path through the tree. A dense window read beside a harness is a window somebody keeps their hands off the mouse for
- [ ] 8.2 (Unit) The page type is chosen when a page is created, instead of `template()` hardcoding `type: topic` for every page the UI makes
- [ ] 8.3 (Unit) Loading and empty states per pane, distinguishable from failure. Every pane today renders nothing while it waits, which reads as "there is nothing here"
- 8.4 → **`specs/desktop-shell/`** (R3.2, R3.3). The recording indicator earning the draft's persistence — elapsed time, and the pause/stop controls in the titlebar — is the titlebar's own requirement, and a titlebar built without them would have had to be built twice. Moved rather than duplicated: two records of one fact disagree
- 8.5 → **`specs/desktop-shell/`** (R5). The status bar is the shell's third row, and the same argument applies: it cannot be assembled empty and filled in later

---

## Notes

**Order matters once.** Group 1 ships on its own and can merge before anything else
lands — it is the difference between an application that cannot create a page and
one that can, and none of it is touched by the repaint. Group 2 blocks 3 through 8,
because every one of them is assembled from those primitives; building a pane
against the old tokens means building it twice.

**The three specs are ordinary specs.** They live at `specs/<feature>/`, not nested
under this plan, and they are built by the same rules as one somebody asked for
directly — `requirements.md`, `design.md`, `tasks.md`, EARS, citations both ways.

**Group 8 of [[open-wiki]] is not reopened.** Its tasks named behaviours and the
behaviours exist. This plan is the surface those behaviours were supposed to have,
which no task there ever asked for — which is worth recording as the actual lesson:
**a checklist of behaviours cannot notice that nobody drew the application.** The
draft existed the whole time and was never anything's acceptance criterion.

**What this plan does not do.** It does not add a light theme — the draft is
deliberately dark-only and says so. It does not touch `@open-wiki/access`, except
for `scaffold()` in 1.3, because the backend is not what is wrong. And it does not
revisit whether the agent writes the pages; it makes the application say so.

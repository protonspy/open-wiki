---
autonomy: gated
ci: wait
---

# Desktop UI — what a driven pass over the renderer found

[[desktop-ui]] ported the draft: the titlebar, the rail, three panes, amber for
provenance, a warm reading surface inside a cold instrument. That landed, and this
plan does not re-argue any of it. What it records is what shows up once the screens
are **driven** rather than read — a Playwright pass over every pane, overlay and
dialog at four window sizes, with the preload bridge stubbed so the renderer runs in
a plain Chromium.

## How this was validated, and what it could not see

`apps/desktop/src/renderer` was served by Vite and driven in Chromium with a stand-in
for `window.ow` — the shapes taken from `src/main/api.ts`, `sources.ts`,
`settings.ts`, `check/findings.ts` and `agent/chat-events.ts`, filled with a
seven-page wiki, five sources across all five stages, six findings across four
families, three operations and a scripted agent run including an `edit_file`
interrupt.

**What that reaches:** every pane, the settings sheet, the history drawer, the three
dialogs, the editor, the launcher, the guided first run, the streaming chat and its
approval card — layout, type, colour, focus order, roles, and behaviour at 1280×800,
1024×700, 860×560 and 720×480 (`minWidth`/`minHeight` are 720×480,
`src/main/index.ts:56`).

**What it does not reach, and is therefore unjudged here:** the frameless titlebar's
drag region and window controls, native file/folder choosers, real drag-and-drop of
files onto the window, the recorder's live levels and the `RecordingIndicator`, IPC
refusals, and anything about how the packaged binary starts. Nothing below is a
claim about those.

## What is good, and should not be touched

Said first because a list of findings reads as a verdict on the whole, and this one
is not.

- **Contrast passes everywhere it was measured.** Body prose 15.0:1, muted rail
  labels 5.9:1, the status bar 6.2:1, citation chips 7.7:1. Not one text node under
  4.5:1. This is unusual and it was clearly done on purpose.
- **The focus ring is one ring.** 2px `--primary`, every control, no exceptions.
- **The tree is a roving tabindex** — one tab stop, Arrow/Home/End inside, no wrap.
  Exactly what `keyboard.ts` says it built, and it works.
- **Severity is never colour alone.** `ChecksPane.tsx:145` draws two different icons
  for error and warning, with the reason in a comment.
- **The dialogs are right.** Real `<dialog>`, modal, Escape closes, focus lands on
  the field in *New page* and on **Keep it** in the delete confirmation, and the
  destructive action carries `btn--danger`. The prose in them explains consequences
  instead of naming buttons.
- **The approval card discloses what matters** — path, replace, with, occurrence
  count (*"Replaces 1 match of 2 matches in this page"*), the sites, and the
  resulting page. That is the hard part of a human-in-the-loop surface and it is done.
- **`prefers-reduced-motion` is honoured** (`globals.css:145`).
- **The launcher redesign holds up.** It is the most finished screen in the app.

## The findings

### 1. The window has no answer below about 1100px wide

The shell is `grid-template-columns: 220px minmax(0, 1fr) 250px` (`globals.css:802`)
over a 52px rail, and `globals.css` contains **exactly one `@media` rule** — the
reduced-motion one. There is no breakpoint, no container query, nothing that drops a
column.

So the fixed furniture is 522px and the content gets the remainder:

| Window | Reader column |
| --- | --- |
| 1280×800 | 690px |
| 1024×700 | 434px |
| 860×560 | 255px |
| **720×480** (the app's own minimum) | **115px** |

At 720×480 the page title wraps across two lines, the frontmatter chips break
mid-token (`2026–` / `07–28`), prose runs three words to a line, and the *Needs
attention* rail is nearly twice as wide as the article it annotates. One element
overflows the viewport. Nothing is clipped or unreachable — it is simply not usable,
and the application permits that size itself.

This is the most severe finding and the one everything else in a narrow window is
downstream of.

### 2. The editor gets 17% of the width it is given

`.editor__panes` is `grid-template-columns: 1fr 1fr` (`globals.css:1533`). `1fr` is
`minmax(auto, 1fr)`, so a preview containing anything with a wide minimum — a fenced
code line, a table — pushes past its half and takes the difference from the source
box.

Measured on a page with one `ow check --json | jq …` fence, in a 1228×738 pane:
**textarea 207×383, preview 468×383.** Markdown wraps at roughly 22 characters. The
textarea also stops 355px short of the pane's bottom.

The fix is `minmax(0, 1fr)` and a height that fills. The rest of the editor's
problems sit on top of that one:

- **Save/Cancel float above the source box**, left-aligned, while the pane bar four
  rows up carries its own cluster — two competing action rows for one screen.
- **Edit, Rename and Delete stay enabled while editing.** All three were confirmed
  `disabled: false` mid-edit. *Delete this page* is one click away from an unsaved
  draft.
- **There is no dirty state.** Save is always enabled, nothing marks unsaved work,
  and navigating away is unguarded.
- **No wikilink or citation completion.** The renderer holds every slug (`index()`
  returns `slugs`) and every source id, and an editor whose entire value is
  `[[links]]` and `src://…#p12` offers neither. The single largest missed
  opportunity in the app.

### 3. Wikilinks and citations are unreachable from the keyboard

`markdown.ts:123` emits `<a class="wikilink" data-ow-page="…">` with **no `href`** —
deliberately, and the reasoning at `markdown.ts:40` is sound: a scheme is something a
page author can mint, `data-ow-*` is not. The consequence was not carried through.
An `<a>` without `href` is not focusable and has no `link` role.

Measured on a page with a wikilink and a citation chip: `a.wikilink` 1,
`a.provenance` 1, **focusable elements inside `<article>`: 0**. The whole reader is a
single tab stop (`div.reader`), and every navigation target inside it is invisible to
assistive technology and unreachable without a mouse.

The `data-ow-*` decision does not have to change. `tabindex="0"` plus
`role="link"` plus an Enter/Space handler on the existing delegated click handler
(`Reader.tsx:111`) closes it.

### 4. Nothing in the application is announced

**Zero `aria-live` regions, zero `role="status"`, zero `role="alert"`** across every
screen driven. The things that change without the user acting are exactly the things
that need it:

- the agent's streaming answer, and the moment it pauses for approval;
- notices from `notices.ts` — a failed save, a replaced synonym, a stale finding;
- the findings count changing in the status bar after a write;
- transcription progress on the sources table.

Related and smaller: the transcription progress bar is `<div>`s with no
`role="progressbar"`; the empty actions `<th>` in the sources table has no
visually-hidden label; `<html lang>` is hard-wired `en` while the project's content
language may be `pt-BR` or `es`; and the rail is a `tablist` whose four tabs are four
separate tab stops rather than one with arrow keys.

### 5. The reading surface

- **Every page renders its title twice.** `Reader.tsx:144` draws
  `<h1>{titleOfPage(...)}</h1>`, and the body's own `# Heading` renders straight
  after it. Two `<h1>` in one `<article>`, confirmed on every page. Either strip a
  leading H1 that matches the title, or stop drawing the title when the body opens
  with one.
- **Markdown tables have no styling at all.** `globals.css` styles `.table` (line
  518) — a class, which markdown-it never emits. Computed on a rendered table: cell
  padding **1px**, borders **0**. Columns run together; three-column tables read as
  one paragraph of fragments.
- **The heading scale collapses.** h1 24px → h2 15px → h3 **13px**, which is body
  size; an h3 differs from a paragraph only by weight. The 24→15 jump is a cliff and
  15→13 is not a step.
- **A link is not a colour.** `a.wikilink` computes to the same
  `rgb(236,231,222)` as body text; a live link and a dead one differ only by solid
  vs dotted underline. Nothing tells a reader a word is a link until they hover it.
- **GFM task lists are not enabled** — `- [ ] item` renders the brackets literally.
- **Headings have no `id`s**, so there is no in-page anchoring and no table of
  contents for a long page.
- **Body prose is 13px** (`--text-base`), and there is no text-size control. For a
  window people read in for an hour that is the low end.

### 6. The chat pane

- **No pane bar.** Every other pane has one; chat has no title, no model shown, no
  way to start a new conversation. The model is chosen in Settings and never
  displayed where it is used, though `agentModels()` is on the bridge.
- **The assistant bubble is a fixed-width bordered box** (910px at 1280) regardless
  of content, so a short answer is a mostly-empty rectangle that reads as an input
  field, and a long answer runs ~140 characters to the line — while the reader two
  panes over is capped near 70.
- **The approval card shows two blocks of near-identical prose** under *Replace* and
  *With*, and asks the reader to spot the difference by eye. A word-level diff is the
  single highest-value change in this pane.
- **The composer stays enabled during an interrupt** (confirmed `disabled: false`),
  so a new message can be sent into a run that is paused waiting for a decision.
- **Focus does not move to the approval card** and there is no shortcut for
  approve/reject — for a repeated approve loop that is the whole ergonomics of the
  feature.
- **Working state lives in the placeholder** (*"The agent is working…"*), which
  disappears the moment anyone types.
- Tool activity renders as a detached `read_page done` chip below the answer, merging
  start and end into one label.

### 7. Design-system drift

The system exists — `ui/Button`, `IconButton`, `Pill`, `Segmented`, `Dialog`,
`Sheet`, `Drawer` — and half the app routes around it.

- **28 raw `<button>` against 28 `<Button>`.** `Chat.tsx` alone has 10 raw ones;
  `Launcher.tsx` puts `<Button>` in one half of a screen and `<button>` in the other.
- **There is no input component.** Ten raw `<input>`s, and the class they borrow is
  **`editor__source`** — the markdown editor's mono textarea style — on the project
  name field, the directory field, the API key and the New page slug.
- **`ui/Card.tsx` and `ui/SearchInput.tsx` have zero importers.** Dead components.
- **There is no `Select`.** The model picker in Settings is a bare `<select>` with
  native Windows chrome, sitting under two `Segmented` controls in the same panel.
- **`.seg` stretches inside `.ask__field`.** `.seg` is `inline-flex`
  (`globals.css:1829`) but `.ask__field` is a grid, so the item fills its track: in
  the New page dialog the track measures **406px holding 170px of segments** — 236px
  of empty bordered box.
- **The Settings toggle is inverted against its own heading.** The section reads
  *Keep the WAV after transcribing*; the control reads *Delete it once transcription
  succeeds*; ON (and green — the only green in an amber app) means delete.
- **In the checks pane, `create-page` renders ghost while `add-to-index` and
  `replace` render solid** (`App.tsx:911`). All three write to disk; two look like
  it.

### 8. Empty states, and the space around them

Every empty state in the app is one grey sentence pinned to the top-left of an
otherwise empty pane — *"Pick a page on the left to read it."* over 650px of void,
and *"Ask the agent to read the project and write a page."* over 570px more. The
launcher and the first run put a ~500px column against the top of a 1280×800 window
and leave 380px below it.

Three smaller things in the same territory:

- The launcher's footer explains that *"a project whose directory moved is shown
  here"* — and shows it on the empty screen too, where no project can have moved.
- A project marked **not where it was** offers only **Forget**. There is no
  *Locate…*, so a moved project is a dead end.
- Inline `<code>` at a line end breaks badly: *"the same way `code` ."* leaves the
  period orphaned across a gap. And the first run's help text ends
  *"…or use Choose…."* — the label's own ellipsis plus a full stop.

### 9. Two counts that overstate

- `ChecksPane.tsx:89` sets the pill tone from `findings.length > 0 ? "error" : "ok"`.
  A wiki with five warnings and no errors shows a red **5**.
- The status bar reads **not checked yet** until something opens the checks pane.
  It is honest, and it means the default state of the window says nothing about the
  wiki's health.

## What this does not propose

- **A search box.** `keyboard.ts:16` records the decision — the wiki pane ships
  without one until the agent or MCP answers it, and a shortcut for a control that
  does not exist is the dead-button class group 1 removed. Worth revisiting when a
  project passes a couple of hundred pages; not worth reopening here.
- **A light theme.** There is no `prefers-color-scheme` and no light token set, which
  is a real gap for a long-read desktop app — but it is a design decision with a
  whole palette behind it, not a defect, and it belongs to whoever owns the draft.

## Tasks

Numbered by the finding they close. Each is verifiable on its own; the ones that end
in a rendered measurement say so, because a CSS change with no assertion behind it is
a change nobody can keep.

### 1 — the window at every size it allows

- [x] 1.1 (Unit) Give the shell a breakpoint that drops the right rail to a
      toggleable overlay below ~1000px, asserting the reader column stays above 380px
      at 860×560
- [x] 1.2 (Unit) Collapse the page tree to an overlay below ~820px, asserting the
      reader column stays above 380px at 720×480
- [x] 1.3 (Unit) Assert no element overflows the viewport at 720×480 on every pane

### 2 — the editor

- [x] 2.1 (Unit) Change `.editor__panes` to `minmax(0, 1fr) minmax(0, 1fr)` and make
      the source box fill the pane height, asserting the two columns measure within
      10% of each other on a page containing a wide code fence
- [x] 2.2 (Unit) Disable Edit, Rename and Delete in the pane bar while the editor is
      open
- [x] 2.3 (Unit) Track a dirty state: mark it in the pane bar, disable Save when
      clean, and confirm before navigating away with unsaved changes
- [x] 2.4 (Unit) Move Save/Cancel into the pane bar so one screen has one action row
- [x] 2.5 (Unit) Complete `[[` from the wiki's slugs and `src://`/`rec://` from the
      project's source ids, inside the source textarea

### 3 — links from the keyboard

- [x] 3.1 (Unit) Give wikilink and provenance anchors `tabindex="0"`, `role="link"`
      and Enter/Space activation through the existing delegated handler, asserting a
      focusable count greater than zero inside a rendered article
- [x] 3.2 (Unit) Give a broken wikilink an accessible name that says it is broken,
      rather than a `title` alone

### 4 — announcements

- [x] 4.1 (Unit) Put the notices region behind `role="status"`, and failures behind
      `role="alert"`
- [x] 4.2 (Unit) Announce the agent's turn boundaries and the approval request
- [x] 4.3 (Unit) Give the transcription progress a `role="progressbar"` with
      `aria-valuenow`/`aria-valuemax`, and the sources table's actions column a
      visually-hidden header
- [x] 4.4 (Unit) Set `<html lang>` from the project's content language
- [x] 4.5 (Unit) Make the rail one tab stop with Left/Right arrow movement, per the
      tablist pattern the markup already claims

### 5 — the reading surface

- [x] 5.1 (Unit) Render the page title once — drop the body's leading H1 when it
      matches, or the reader's own when the body opens with one
- [x] 5.2 (Unit) Style tables inside the reader by element, asserting a rendered cell
      has non-zero padding and a visible row rule
- [x] 5.3 (Unit) Restate the heading scale so h2 and h3 are distinguishable from body
      and from each other
- [x] 5.4 (Unit) Give live and broken wikilinks distinct colour as well as underline
- [x] 5.5 (Unit) Enable GFM task lists in the renderer
- [x] 5.6 (Unit) Give headings stable ids, and the right rail a table of contents for
      pages above a threshold

### 6 — the chat pane

- [x] 6.1 (Unit) Give chat a pane bar: title, the model in use, and a new
      conversation
- [x] 6.2 (Unit) Size the assistant bubble to its content and cap its measure to the
      reader's
- [x] 6.3 (Unit) Render a word-level diff between `old_string` and `new_string` in
      the approval card
- [x] 6.4 (Unit) Disable the composer while a run is paused on an interrupt, and say
      why in place of the placeholder
- [x] 6.5 (Unit) Move focus to the approval card when it appears, and bind
      approve/reject
- [x] 6.6 (Unit) Show working state as a persistent element rather than a placeholder

### 7 — the design system

- [x] 7.1 (Unit) Add `ui/Input` and `ui/Select`, and replace every raw `<input>` and
      the model `<select>` with them
- [x] 7.2 (Unit) Replace the remaining raw `<button>`s with `ui/Button`
- [x] 7.3 (Unit) Constrain `.seg` to its content inside `.ask__field`, asserting the
      rendered track width equals the sum of its segments
- [x] 7.4 (Unit) Restate the WAV setting so heading, label and toggle polarity agree,
      and take the toggle into the amber palette
- [x] 7.5 (Unit) Give every fix that writes to disk the same emphasis in the checks
      pane
- [x] 7.6 (Unit) Delete `ui/Card.tsx` and `ui/SearchInput.tsx`, or adopt them

### 8 — empty states and spacing

- [x] 8.1 (Unit) Rebuild the wiki, chat and checks empty states as centred blocks
      that say what the pane is for and offer the first action
- [x] 8.2 (Unit) Centre the launcher and first-run columns in the window
- [x] 8.3 (Unit) Show the launcher's cache note only when there is a list to explain
- [x] 8.4 (Unit) Offer **Locate…** on a project that is not where it was
- [x] 8.5 (Unit) Stop inline `<code>` orphaning trailing punctuation, and fix the
      doubled ellipsis in the first run's directory help
- [x] 8.6 (Unit) Give the first run a stepper, and size the directory field to the
      value it holds

### 9 — honest counts

- [x] 9.1 (Unit) Tone the checks pill by the worst severity present, not by the count
- [x] 9.2 (Unit) Decide what the status bar says before the first check has run

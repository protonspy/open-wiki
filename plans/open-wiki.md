---
autonomy: auto
ci: no-wait
---

# Open Wiki — desktop

An open source desktop application (Windows 10/11, Apache-2.0) that **centralises a
project's documentation sources in a local folder and serves that folder over MCP as a
wiki the AI agent reads and writes.**

Today the user has a project's documentation scattered: an architecture PDF, a
requirements `.docx`, decisions that exist only in a recorded meeting. None of it answers
"what is the current state of project X and how did we get here?", and none of it is read
by an agent without someone pasting it all into a prompt by hand.

The application does three things and refuses the rest: it **takes in sources** (a file or
a recording) and reduces them to text with provenance anchors; it **stores the wiki** as
validated markdown; and it **serves one project over MCP** to Claude Code, Cursor or any
harness.

**The application calls no LLM.** Reading the source text, applying the LLM-Wiki
methodology and writing the pages is the agent's job, over MCP — the only bridge between
the wiki and a model. The application does not write content; it validates what comes in
and records everything that changes. See `adr:0003-mcp-as-the-only-bridge-to-the-llm`.

## Out of scope

- Extraction, summarisation or page writing by the application. That is the agent's.
- Chat inside the application. The conversation happens in the user's harness.
- A hosted service, accounts, authentication of our own, multi-tenancy or telemetry — `adr:0001-no-backend-byok`.
- A Notion-style block editor — `adr:0004-markdown-editing-without-blocks`.
- Real-time collaboration, comments, permissions.
- Embeddings or a vector store. Full-text search over the files, yes.
- An inverted index and a graph of the project, **under review** — `adr:0010-a-derived-index-engine-behind-a-cli` proposes both, in a second Rust binary driven by a CLI. Until that record is accepted or rejected, this line still refuses them.
- Versioning of the workspace — `adr:0002-workspace-as-a-local-markdown-folder`.
- macOS and Linux.
- Real-time transcription, ML diarisation, a bot that joins the meeting.
- Pasting loose text as a source. In the MVP there are two kinds of source: a file and a recording.

## Done when

The user opens the application on an empty folder, creates the project, uploads a PDF and
records an hour-long meeting — pausing halfway — and clicks transcribe. The sources screen
shows both, with the text ready in `raw/`. They start the MCP server for that project,
paste the configuration into Claude Code, and ask for the wiki to be built from the
sources. The pages appear in the application while the agent writes; a write that departs
from the schema is refused with a reason; and a follow-up question about the state of the
project is answered by citing the pages, with a link that opens the source at the right
instant.

## Decided and not up for discussion

Apache-2.0 · Windows only in the MVP · no backend · the application calls no LLM · the
workspace is a local folder, no git and no remote · sources stay immutable in `raw/` ·
MCP over local HTTP, with read, ingest and write, serving one project at a time chosen by
the application · the application's only credential is the transcription one · the content
language is a setting, English by default, with Brazilian Portuguese and Spanish available
(`adr:0008-content-language-is-a-setting-english-by-default`) · audio capture through
WASAPI directly, with pause · Opus 24 kbps as the provenance format.

**Git belongs to the code, not to the product.** This repository is versioned; the user's
workspace is not.

## The workspace

```
<workspace>/
  fenix/                        one project
    raw/                        sources, immutable once written and named for what they are
      fenix-weekly-2026-07-31/    a recording, named for the occasion and its date
        manifest.json · mic.opus · system.opus
        timeline.json · timeline.vtt · text.md
        journal.json · *.wav        only until transcription seals the source
      arquitetura-fenix.pdf/      an uploaded file, keeping its filename
        manifest.json · source.pdf · text.md
    wiki/                       primary content, written by the agent and by the user
      index.md · changelog.md · log.md
      projects/*.md · people/*.md · topics/*.md
    .state/                     snapshots and operation log; not content
    CLAUDE.md                   schema and methodology, for the agent operating the folder
  atlas/
    ...
```

---

## 1 — Foundation

- [ ] 1.1 (Unit) Set up the monorepo: a pnpm workspace for `apps/desktop` and `packages/*`, a cargo workspace for `crates/recorder`, shared strict TypeScript
- [ ] 1.2 (Unit) Fill in `.claude/rules/project.md` with the real build, test, scoped test, lint and format commands
- [ ] 1.3 (Unit) CI on GitHub Actions on `windows-latest`: Rust and TS build, tests with a coverage floor of 76% per package, lint
- [ ] 1.4 (Unit) Remove `.claude/` and `CLAUDE.md` from `.gitignore` — the methodology is versioned with the code, and today it exists only on this machine
- [ ] 1.5 (Unit) Bundle `vendor/ffmpeg` through a download script with hash verification

## 2 — Workspace, projects and safe writing

- [ ] 2.1 (Unit) Open or create a workspace: choose the folder and refuse one already occupied by something else
- [ ] 2.2 (Unit) Create, list and rename projects, each with its own `raw/`, `wiki/`, `.state/` and `CLAUDE.md`
- [ ] 2.3 (TDD) Write a page atomically — temporary file plus rename — snapshotting the touched pages into `.state/` before any write
- [ ] 2.4 (TDD) Record every write operation in a log in `.state/`, with its origin (editor, MCP), the affected pages and the time
- [ ] 2.5 (TDD) Undo an operation by its id, restoring the snapshot and removing what it created
- [ ] 2.6 (TDD) Refuse a write that resolves outside the served project, including through a relative path or a symbolic link

## 3 — Sources: files

- [ ] 3.1 (TDD) Register a source in `raw/<id>/` with a `manifest.json` carrying its title, the original preserved, and the directory marked immutable once written — the id is derived from the source's name and frozen there, per `adr:0011-sources-are-named-by-what-they-are`
- [ ] 3.2 (Unit) Upload Markdown and plain text: copy into `raw/` and normalise to `text.md`
- [ ] 3.3 (Unit) Upload a PDF: extract the text to `text.md`, keeping the page number as a provenance anchor
- [ ] 3.4 (Unit) Upload a DOCX: extract the text and the heading hierarchy to `text.md`
- [ ] 3.5 (Unit) Drag files onto the window, choose the project, and see what was recognised and what was not
- [ ] 3.6 (TDD) Derive the id: lowercase, accents folded, anything outside `[a-z0-9]` collapsed to one `-`, and refuse a filename already taken in this project instead of inventing a suffix

## 4 — Sources: audio recording

- [ ] 4.1 (TDD) `recorder.exe`: capture the microphone and the WASAPI loopback into two WAV tracks aligned by the QPC clock, manufacturing silence when the API delivers no frames
- [ ] 4.2 (TDD) Survive a default-device change mid-recording, reopening the stream and noting the event in `device_changes`
- [ ] 4.3 (TDD) Pause and resume: both tracks stop and return at the same instant, the paused stretch leaves both as one block, and the time map still maps any recorded instant to the real clock instant
- [ ] 4.4 (Unit) Emit `manifest.json` with the recording's title, the absolute timestamp of each track's first frame, and the pause intervals
- [ ] 4.5 (Unit) Expose the sidecar over stdio JSON-RPC with `start`, `pause`, `resume`, `stop`, `status`, `devices`
- [ ] 4.6 (Unit) ffmpeg: downmix to 16 kHz mono, VAD cutting silence from 800 ms, encode to Opus 24 kbps
- [ ] 4.7 (TDD) Emit the time map converting a compressed instant into a real instant, and the chunk boundaries at silence points
- [ ] 4.8 (Unit) A `SttProvider` interface with `groq` and `whispercpp` adapters, swappable by configuration
- [ ] 4.9 (TDD) Transcribe chunks one at a time, writing each result to the journal before the next starts, so an application killed mid-run loses at most the chunk in flight — `adr:0012-transcription-is-a-journalled-serial-pipeline`
- [ ] 4.10 (Unit) Seed the transcription vocabulary with the names already present in the project's pages — it is what stops the project's own name from coming out wrong
- [ ] 4.11 (TDD) Reconstruct the absolute timestamps from the chunk offset and the time map
- [ ] 4.12 (Unit) Merge the two tracks into a `timeline.json` ordered by real time, labelling `me` and `remote` by the track they came from
- [ ] 4.13 (Unit) Render the recording's `text.md` from the timeline, with each passage's instant as a provenance anchor
- [ ] 4.14 (Unit) Discard the WAV as soon as transcription confirms success, keeping the Opus as the provenance file
- [ ] 4.15 (Unit) Send the configured content language as the transcription hint rather than relying on the provider detecting it — `adr:0008-content-language-is-a-setting-english-by-default`
- [ ] 4.16 (TDD) Ask what is being recorded before capture starts and build the id from it plus the date — `fenix-weekly-2026-07-31`, `-2` for a second the same day — falling back to the timestamp rather than blocking capture on an empty field
- [ ] 4.17 (TDD) Resume from the journal on reopening, sending only what failed or never ran, and refuse a journal whose chunk boundaries, provider or model no longer match rather than stitching two segmentations into one timeline
- [ ] 4.18 (Unit) Write `timeline.vtt` beside `timeline.json`, so the recording can be followed in any player and taken away if the user stops using this application

## 5 — The wiki as a validated store

What replaces the code that used to write the pages: the application does not guarantee
the content is good, it guarantees it is **well formed**. Every write — from the editor or
from MCP — goes through here.

- [ ] 5.1 (TDD) Validate the page frontmatter against the schema (`id`, `type`, `title`, `status`, `aliases`, `updated`, `sources`) and refuse the write with a reason, instead of storing something malformed
- [ ] 5.2 (TDD) Refuse a write whose wikilink does not resolve to an existing page, saying which link broke
- [ ] 5.3 (TDD) Refuse a write whose provenance citation does not point at an existing source and, for audio, at an instant inside the recording
- [ ] 5.4 (Unit) Fill in `updated` and append the source to `sources` automatically, so that it does not depend on the agent remembering
- [ ] 5.5 (Unit) Append a line to `log.md` and an entry to `changelog.md` on every write operation, with its origin
- [ ] 5.6 (Unit) Maintain the index: register a new page in `index.md` and flag a page that became unreachable

## 6 — Source flow

- [ ] 6.1 (Unit) Model each source's state — received, text ready, cited on a page — persisted and resumable
- [ ] 6.2 (Unit) Sources screen: one row per source with its current state, what is missing, and the error when it stopped
- [ ] 6.3 (Unit) A transcribe button on a stopped recording, with per-chunk progress and the option to redo only what failed
- [ ] 6.4 (Unit) Show, for a source, which pages cite it, and navigate from there to the page
- [ ] 6.5 (Unit) Show, for a page, which sources it came from — the inverse path of the previous one
- [ ] 6.6 (Unit) Highlight a source sitting in `raw/` that no page cites, which is the case that disappears from view on its own
- [ ] 6.7 (Unit) Correct a source's title without moving its directory or touching a citation — the freeze in `adr:0011-sources-are-named-by-what-they-are` is only bearable if the readable name stays editable

## 7 — Integrity

With the agent writing, this stops being hygiene and becomes the defence against drift.

- [ ] 7.1 (Unit) Report broken wikilinks and orphan pages
- [ ] 7.2 (Unit) Report a desynchronised changelog and a source never cited
- [ ] 7.3 (Unit) Report a provenance link that does not resolve to an existing source or instant
- [ ] 7.4 (Unit) Report a synonym used where the project has a canonical term
- [ ] 7.5 (Unit) Expose the checks in the UI, with the correction path described per finding
- [ ] 7.6 (Unit) Expose the same checks as an MCP tool, so the agent can check its own work before finishing

## 8 — Application

- [ ] 8.1 (Unit) Design system: dense dark-theme tokens, a compact type scale, focus and error states, a recording indicator
- [ ] 8.2 (Unit) Electron shell: navigation across wiki, sources and MCP, a project selector, record, pause and stop, a persistent indicator while recording
- [ ] 8.3 (Unit) Transcription credential: a Groq key typed and validated on the spot, or local whisper.cpp with no credential at all — stored as per `adr:0007-plaintext-credentials-in-the-config`
- [ ] 8.4 (Unit) Onboarding: choose the workspace folder, create the first project, and start the MCP server with the configuration ready to paste
- [ ] 8.5 (Unit) Browse the rendered wiki: follow wikilinks, see the page with its frontmatter, go back
- [ ] 8.6 (Unit) Open the source at the right instant when a provenance link is clicked — audio at the timestamp, a document at the page
- [ ] 8.7 (Unit) Edit a page's markdown with preview and save, going through the group 5 validations
- [ ] 8.8 (Unit) Refuse to overwrite a page changed on disk since it was loaded, instead of losing the change silently
- [ ] 8.9 (Unit) Create, rename and delete a page from the UI, fixing the wikilinks that pointed at it
- [ ] 8.10 (Unit) Reflect on screen, live, the pages the agent writes over MCP
- [ ] 8.11 (Unit) An operation history with undo, fed by 2.4 — the only way back there is
- [ ] 8.12 (Unit) Choose the content language at onboarding and change it afterwards — English by default, Brazilian Portuguese and Spanish alongside it — reaching the transcription hint and the generated `CLAUDE.md`, and nothing else

## 9 — MCP server

- [ ] 9.1 (Unit) A project access module — list, read, search, ingest, write — one implementation, used by the UI and by the server
- [ ] 9.2 (Unit) An MCP server over HTTP, bound to the loopback only, started and stopped by the application, serving exactly one project chosen by the application, always at the same address
- [ ] 9.3 (TDD) Require a token on every request, generated per workspace, and refuse a request without it — any local process reaches that port
- [ ] 9.4 (TDD) No tool takes a project parameter, and none reaches a path outside the served project
- [ ] 9.5 (Unit) Switch the served project by dropping the open connections, so that the harness never goes on talking to the previous project
- [ ] 9.6 (Unit) Announce the active project in the server's name and description, so the agent says which base it is working on
- [ ] 9.7 (Unit) Read tools: list pages, read a page, search full text returning passages
- [ ] 9.8 (Unit) Source tools: list sources with their state and read the `text.md` of one of them
- [ ] 9.9 (Unit) An ingest tool: accept a document, write it into `raw/` and reduce it to text through the same path as group 3
- [ ] 9.10 (TDD) Write tools — create, update, rename and delete a page — going through the group 5 validations, the atomic path of 2.3 and the log of 2.4
- [ ] 9.11 (Unit) Return a validation error readable enough for the agent to fix it on its own and try again
- [ ] 9.12 (Unit) Show in the UI, unambiguously, which project is being served, the active connections and the latest operations that came in over MCP
- [ ] 9.13 (Unit) Generate the configuration ready to paste into the harness, with the address and the token
- [ ] 9.14 (TDD) Generate the project's `CLAUDE.md` with the page schema, the LLM-Wiki methodology and the configured content language — it is the only place either convention exists, now that neither exists in code
- [ ] 9.15 (Unit) Verify end to end that Claude Code, pointed at the server and starting from a single source, builds valid pages and then answers by citing them
- [ ] 9.16 (Unit) Hand the MCP token to the harness through a `headersHelper` reading the application's `config.json`, so the token is never pasted and never stored a second time — see [[claude-code-plugins]]
- [ ] 9.17 (Unit) Write the agent-facing skill **from the tool list 9.7–9.10 actually shipped**, and settle in the same task whether it or the `CLAUDE.md` of 9.14 is the single home of the convention

## 10 — Distribution

- [ ] 10.1 (Unit) A single NSIS installer with ffmpeg and `recorder.exe` embedded, written to `apps/desktop/release/`, with no external dependency to install — `adr:0009-distribution-through-github-releases`
- [ ] 10.2 (Unit) Release from a `v*` tag: CI builds the installer, refuses a tag that disagrees with the app version or that already has a release, and publishes it to GitHub Releases with its `SHA256SUMS.txt`
- [ ] 10.3 (Unit) Publish to winget and Scoop, with the manifests pointing at the release URL and quoting its hash
- [ ] 10.4 (Unit) A README with the recording notice, the responsibility to inform participants, and what the SmartScreen warning on an unsigned installer means
- [ ] 10.5 (Unit) Package the skill and the MCP configuration as an installable Claude Code plugin, with `.claude-plugin/marketplace.json` at the repository root so `/plugin marketplace add` reaches it, and `claude plugin validate --strict` in CI — see [[claude-code-plugins]]

---

## Notes

**Order.** The minimum product is 2 + 3 + 5 + 9: one project, one uploaded markdown file, a
store that validates, and a server Claude Code drives. With that the whole cycle already
runs, with no audio, no PDF and no pretty UI. Close that path first — it answers the only
question that matters, which is whether an agent can build and maintain the wiki through
the tools you exposed.

Group 8 comes after: a wiki Claude Code already operates has value with an ugly UI, and the
reverse is not true.

**Group 4 is the most expensive and the least central.** A meeting is the source that
leaves no trace on its own, but the product has value without it, and it flows into the
same `text.md` a PDF does — it can arrive later with no downstream change. If something has
to wait, it is this group.

**Seams where this tends to fail.**

*There is no recompilation any more.* With distillation out of the application, `wiki/`
stopped being derivable from `raw/` and became primary content. No task rebuilds the wiki,
and none can. The pair 2.3–2.5 is the only net there is, which is why all three are `(TDD)`
and come before anything that writes.

*The convention lives in a prose file.* 9.14 generates the `CLAUDE.md` carrying the schema
and the methodology; if it is vague, different agents write differently and the wiki drifts
without anything breaking. Group 5 is what stops the drift from becoming corruption — but
it checks form, not meaning. A well-formed and wrong page passes.

A skill is the rival home for it — versioned with the product and updated by an upgrade,
where a generated `CLAUDE.md` is a copy per folder that ages from the moment it is
written. 9.17 writes that skill and picks which of the two is a pointer to the other.

**It is deliberately last in the group, and one was already written and thrown away.**
A skill teaching an agent to call `list_pages` and `read_page` is fiction until 9.7–9.10
decide those names, and fiction in a file that loads into an agent's context is worse than
an absent file: whoever picks the work up next reads it as a decision somebody made and honours it. The
convention — one page per entity, every claim cited, supersede rather than overwrite — was
true before any tool existed and belongs in the plan and in group 5's validations. The
calling sequence is not, and waiting costs nothing.

*The port is local, not private.* Any process on the machine reaches the loopback. With
ingest and write exposed, 9.3 and 9.4 are the difference between a tool and a vector.

*The time map lies with confidence.* It runs through 4.7, 4.11, 4.13, 5.3 and 7.3. If it is
wrong, provenance points at the wrong instant — worse than not existing. Three manual checks
on an hour-long recording are an acceptance criterion for group 4.

*Disk retention has a correct order.* An hour of WAV takes ~690 MB, and the deletion (4.14)
sits at exactly the point that can be interrupted. Deleting before the confirmation loses
the recording; never deleting fills the disk in twenty meetings. The journal of 4.9 is what
the confirmation is checked against, so 4.9 and 4.17 come before 4.14 does anything
irreversible — and a run abandoned at chunk four keeps its WAV forever, which makes
surfacing a stalled recording (6.2) part of the retention story rather than a nicety.

*The validation error is an interface.* 9.11 looks cosmetic and is not: with the agent
writing, a refusal it cannot understand becomes an attempt it repeats verbatim. The message
is what closes the loop.

**Research, later, and why it costs almost nothing.** Nothing in this plan asks the
application to go and find material — sources arrive because a person uploaded a file or
recorded a meeting. But 9.9 exposes ingest as an MCP tool, which means an agent that can
already read the web, a ticket tracker or another repository can hand what it found to the
workspace and then write pages citing it. No new component: the application still calls no
LLM, the researcher is the agent, and the material lands in `raw/` beside a PDF and a
recording.

The one thing that has to be right is what gets ingested. **Store the retrieved text, not
the URL.** A link rots, is edited, or sits behind a login by the time someone follows the
citation, and a citation that opens nothing is worse than none — which is the same reason
`adr:0006-opus-as-the-provenance-format` keeps the audio rather than only the transcription.
Ingesting the fetched text makes an external source immutable in exactly the way a
recording already is, and the URL becomes a note on it rather than the evidence.

This is deliberately not scheduled. It is written down because it is the cheapest thing on
the horizon and the design decision inside it is easy to get wrong once, permanently.

**Methods.** The `(TDD)` ones are the tasks where being wrong produces no symptom: track
alignment, pause, the time map, atomic writing, the operation log, undo, confinement to the
project, the three write validations, the server token, the write tools and the generated
`CLAUDE.md`. They are also the ones to surface before landing, even in an automatic run.

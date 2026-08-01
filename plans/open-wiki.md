---
autonomy: auto
ci: no-wait
---

# Open Wiki — desktop

An open source desktop application (Windows 10/11, Apache-2.0) that **centralises a
project's documentation sources inside the project's own directory, as a wiki the AI agent
already has open.**

Today the user has a project's documentation scattered: an architecture PDF, a
requirements `.docx`, decisions that exist only in a recorded meeting. None of it answers
"what is the current state of project X and how did we get here?", and none of it is read
by an agent without someone pasting it all into a prompt by hand.

The application does three things and refuses the rest: it **takes in sources** (a file or
a recording) and reduces them to text with provenance anchors; it **stores the wiki** as
validated markdown; and it **lives inside the project directory**, which is where the
harness is already working — so reading it needs no protocol at all.

`ow` invoked in a directory opens the application scoped to it, the way `code .` does —
`adr:0013-the-project-directory-is-the-unit`. MCP is not how the local wiki is read; it is
how **another** project is consulted, read-only, by a project that has no wiki of its own.

**The application calls no LLM.** Reading the source text, applying the LLM-Wiki
methodology and writing the pages is the agent's job. The application does not write
content; it validates what comes in and records everything that changes.

## Out of scope

- Extraction, summarisation or page writing by the application. That is the agent's.
- Chat inside the application. The conversation happens in the user's harness.
- A hosted service, accounts, authentication of our own, multi-tenancy or telemetry — `adr:0001-no-backend-byok`.
- A Notion-style block editor — `adr:0004-markdown-editing-without-blocks`.
- Real-time collaboration, comments, permissions.
- Embeddings, a vector store, reranking or an inverted index. Lexical search over the files, yes; the agent's own grep inside the project, mostly.
- Versioning done by the application. The project directory is often a git repository and the user's git is welcome to it — the application still knows nothing about it, per `adr:0002-workspace-as-a-local-markdown-folder`.
- macOS and Linux.
- Real-time transcription, ML diarisation, a bot that joins the meeting.
- Pasting loose text as a source. In the MVP there are two kinds of source: a file and a recording.

## Done when

The user runs `ow` inside a project they already work in, uploads a PDF and records an
hour-long meeting — pausing halfway — and clicks transcribe. The sources screen shows both,
with the text ready in `raw/`. They ask Claude Code, in that same directory, to build the
wiki from the sources; the agent reads `raw/` and writes `wiki/` with its own tools, a
write that departs from the schema is refused or reverted with a reason, and the pages
appear in the application while it works. A follow-up question about the state of the
project is answered by citing the pages, with a link that opens the source at the right
instant. In a second repository with no wiki of its own, an agent answers the same question
by consulting the first over MCP.

## Decided and not up for discussion

Apache-2.0 · Windows only in the MVP · no backend · the application calls no LLM · a
project is a directory, opened by `ow` in its scope · sources stay immutable in `raw/` ·
MCP is read-only, over stdio, spawned by the harness, and serves one project that is never
the one the harness has open (`adr:0013-the-project-directory-is-the-unit`) · TypeScript
everywhere except audio capture (`adr:0014-typescript-everywhere-except-audio-capture`) ·
the convention ships as skills (`adr:0015-the-convention-ships-as-skills`) · the
application's only credential is the transcription one · the content language is a setting,
English by default, with Brazilian Portuguese and Spanish available
(`adr:0008-content-language-is-a-setting-english-by-default`) · audio capture through
WASAPI directly, with pause · Opus 24 kbps as the provenance format.

**Git belongs to the user, not to the product.** The project directory is usually
versioned, and that is the user's business; the application neither reads nor writes a
repository.

## The project directory

```
fenix/                          a project — usually a repository the user already has
  raw/                          sources, immutable once written and named for what they are
    fenix-weekly-2026-07-31/      a recording, named for the occasion and its date
      manifest.json · mic.opus · system.opus
      timeline.json · timeline.vtt · text.md
      journal.json · *.wav          only until transcription seals the source
    arquitetura-fenix.pdf/        an uploaded file, keeping its filename
      manifest.json · source.pdf · text.md
  wiki/                         primary content, written by the agent and by the user
    index.md · changelog.md · log.md
    projects/*.md · people/*.md · topics/*.md · codewiki/*.md
  .state/                       snapshots and operation log; not content
  .claude/skills/               the wiki and codewiki conventions, scaffolded by `ow init`
  .mcp.json                     other projects this one consults; never itself
  CLAUDE.md                     short, and pointing at the skills
```

---

## 1 — Foundation

- [ ] 1.1 (Unit) Set up the monorepo: a pnpm workspace for `apps/desktop`, `packages/*` and `packages/cli`, a cargo workspace for `crates/recorder`, shared strict TypeScript
- [ ] 1.2 (Unit) Fill in `.claude/rules/project.md` with the real build, test, scoped test, lint and format commands
- [ ] 1.3 (Unit) CI on GitHub Actions on `windows-latest`: Rust and TS build, tests with a coverage floor of 76% per package, lint
- [ ] 1.4 (Unit) Remove `.claude/` and `CLAUDE.md` from `.gitignore` — the methodology is versioned with the code, and today it exists only on this machine
- [ ] 1.5 (Unit) Bundle `vendor/ffmpeg` through a download script with hash verification

## 2 — Project directory and safe writing

- [ ] 2.1 (Unit) Open or create a project in a directory: scaffold `raw/`, `wiki/` and `.state/`, and refuse a directory already occupied by something else
- [ ] 2.2 (TDD) A registry of known project paths, resolving a name to a directory for the launcher and for `.mcp.json` — a name is never a path segment, an unknown name is refused rather than guessed at, and a directory that moved degrades to a refusal, never to a search or to the current directory. It is a cache, never truth, and the names in it come from committed files
- [ ] 2.3 (TDD) Write a page atomically — temporary file plus rename — snapshotting the touched pages into `.state/` before any write
- [ ] 2.4 (TDD) Record every write in a log in `.state/`, with its origin (editor, CLI, hook), the affected pages and the time — it records what was observed, not only what this application performed
- [ ] 2.5 (TDD) Undo an operation by its id, restoring the snapshot and removing what it created
- [ ] 2.6 (TDD) Refuse a write that resolves outside the project — resolving the real path before comparing, and covering a relative path, a symbolic link and a Windows directory junction, which needs no privilege and is not a symlink
- [ ] 2.7 (TDD) Split the configuration: project settings committed inside the project under a closed schema that refuses an unknown key and carries no local path, and every secret only in the application's data directory keyed by project path — never in the project directory, unconditionally, because `git init` a week later turns a conditional rule into a leak
- [ ] 2.8 (TDD) Write the ignore entries at `ow init` so that recorded audio and `.state/` are out by default and committing them is opting in — `.state/` holds every page as it was before each write, which is where a redaction survives the redaction

## 3 — Sources: files

- [ ] 3.1 (TDD) Register a source in `raw/<id>/` with a `manifest.json` carrying its title, the original preserved, and the directory marked immutable once written — the id is derived from the source's name and frozen there, per `adr:0011-sources-are-named-by-what-they-are`
- [ ] 3.2 (Unit) Upload Markdown and plain text: copy into `raw/` and normalise to `text.md`
- [ ] 3.3 (Unit) Upload a PDF: extract the text to `text.md`, keeping the page number as a provenance anchor
- [ ] 3.4 (Unit) Upload a DOCX: extract the text and the heading hierarchy to `text.md`
- [ ] 3.5 (Unit) Drag files onto the window and see what was recognised and what was not
- [ ] 3.6 (TDD) Derive the id: lowercase, accents folded, anything outside `[a-z0-9]` collapsed to one `-`, and refuse a filename already taken in this project instead of inventing a suffix
- [ ] 3.7 (Unit) Watch `raw/_inbox/` and ingest what lands there through the same path as 3.1 — the way an agent hands over material it fetched, now that no MCP tool ingests

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
the content is good, it guarantees it is **well formed**. Every write — from the editor,
from the CLI, or caught by a hook — goes through here.

- [ ] 5.1 (TDD) Validate the page frontmatter against the schema (`id`, `type`, `title`, `status`, `aliases`, `updated`, `sources`) and refuse the write with a reason, instead of storing something malformed
- [ ] 5.2 (TDD) Refuse a write whose wikilink does not resolve to an existing page, saying which link broke
- [ ] 5.3 (TDD) Refuse a write whose provenance citation does not point at an existing source and, for audio, at an instant inside the recording
- [ ] 5.4 (Unit) Fill in `updated` and append the source to `sources` automatically, so that it does not depend on the agent remembering
- [ ] 5.5 (Unit) Append a line to `log.md` and an entry to `changelog.md` on every write, with its origin
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

With the agent writing through the filesystem, this stops being hygiene and becomes the net
of record.

- [ ] 7.1 (Unit) Report broken wikilinks and orphan pages
- [ ] 7.2 (Unit) Report a desynchronised changelog and a source never cited
- [ ] 7.3 (Unit) Report a provenance link that does not resolve to an existing source or instant
- [ ] 7.4 (Unit) Report a synonym used where the project has a canonical term
- [ ] 7.5 (Unit) Report a codewiki citation that no longer resolves or runs past the end of its file — the check that comes with scaffolding codewiki, per `adr:0015-the-convention-ships-as-skills`
- [ ] 7.6 (Unit) Expose the checks in the UI, with the correction path described per finding
- [ ] 7.7 (Unit) Expose the same checks as `ow check`, so an agent and a CI job can run them without the application

## 8 — Application

- [ ] 8.1 (Unit) Design system: dense dark-theme tokens, a compact type scale, focus and error states, a recording indicator
- [ ] 8.2 (Unit) Electron shell scoped to the directory it was opened in: navigation across wiki and sources, record, pause and stop, a persistent indicator while recording
- [ ] 8.3 (Unit) Transcription credential: a Groq key typed and validated on the spot, or local whisper.cpp with no credential at all — stored as per `adr:0007-plaintext-credentials-in-the-config`
- [ ] 8.4 (Unit) A launcher for when `ow` was run outside a project: the registry of known projects, and creating a new one
- [ ] 8.5 (Unit) Browse the rendered wiki: follow wikilinks, see the page with its frontmatter, go back
- [ ] 8.6 (Unit) Open the source at the right instant when a provenance link is clicked — audio at the timestamp, a document at the page
- [ ] 8.7 (Unit) Edit a page's markdown with preview and save, going through the group 5 validations
- [ ] 8.8 (Unit) Refuse to overwrite a page changed on disk since it was loaded, instead of losing the change silently
- [ ] 8.9 (Unit) Create, rename and delete a page from the UI, fixing the wikilinks that pointed at it
- [ ] 8.10 (Unit) Watch the folder and reflect changes on screen live, whichever wrote them — the agent, a hook, or the user in another editor
- [ ] 8.11 (Unit) An operation history with undo, fed by 2.4, and honest about covering only what was observed
- [ ] 8.12 (Unit) Choose the content language at onboarding and change it afterwards — English by default, Brazilian Portuguese and Spanish alongside it — reaching the transcription hint and the scaffolded skills, and nothing else

## 9 — The CLI, MCP and the agent's contract

- [ ] 9.1 (Unit) A project access module — read, search, validate, write — one implementation, imported by the application, the CLI and the MCP process
- [ ] 9.2 (Unit) `ow` in a directory opens the application scoped to it, and with a subcommand runs headless: the shim the installer puts on `PATH`, and the same package `npx open-wiki` reaches
- [ ] 9.3 (Unit) `ow init`: scaffold the project, and write the wiki and codewiki skills into `.claude/skills/` without overwriting anything already there — `adr:0015-the-convention-ships-as-skills`
- [ ] 9.4 (Unit) Generate a short project `CLAUDE.md` that points at the skills and duplicates nothing they say
- [ ] 9.5 (TDD) Settle and build the write gate: a `PreToolUse` hook that validates the content it is handed and denies with a reason, a CLI verb for harnesses without hooks, and an answer for a write made through the shell, which no per-tool rule reaches — `adr:0013-the-project-directory-is-the-unit` leaves the composition open and it cannot ship open
- [ ] 9.6 (TDD) Refuse an agent-mediated write that lands in `.claude/`, `.mcp.json` or `CLAUDE.md` — the gate's own configuration is inside the project, and a write path that reaches it edits away its own restraint through a change that reads as documentation in review
- [ ] 9.7 (Unit) `ow mcp --project <name> --read-only`: an MCP server over stdio, spawned by the harness, serving exactly the one project it was launched for
- [ ] 9.8 (TDD) The MCP entrypoint does not import the write path at all, so read-only is what the process can do rather than what it agrees to do, and no tool resolves a path outside the launched project
- [ ] 9.9 (Unit) Read tools: the index as structure, a page returned whole, and the sources with their state and their `text.md`
- [ ] 9.10 (Unit) Announce the project in the server's name and description, so an agent with several configured says which base it answered from
- [ ] 9.11 (Unit) `ow search` and `ow graph`: the lexical and structural queries over the local project that `adr:0013-the-project-directory-is-the-unit` sends to the CLI rather than to MCP, printing JSON
- [ ] 9.12 (Unit) A validation error readable enough for the agent to fix it on its own and try again — the same text whether it came from the CLI, a hook or the editor
- [ ] 9.13 (TDD) Pay down cold start: bundle the CLI to a single file, and talk to the running application over a local socket when there is one — the socket carries read and validate and never write, and the standalone path produces the same answer
- [ ] 9.14 (Unit) Verify end to end that Claude Code, working inside a project and starting from a single source, builds valid pages and then answers by citing them
- [ ] 9.15 (Unit) Verify that a second project with no wiki of its own consults the first through a committed `.mcp.json` naming it, and answers citing its pages

## 10 — Distribution

- [ ] 10.1 (Unit) A single NSIS installer with ffmpeg and `recorder.exe` embedded, written to `apps/desktop/release/`, with no external dependency to install, and the `ow` shim on `PATH` — `adr:0009-distribution-through-github-releases`
- [ ] 10.2 (Unit) Release from a `v*` tag: CI builds the installer, refuses a tag that disagrees with the app version or that already has a release, and publishes it to GitHub Releases with its `SHA256SUMS.txt`
- [ ] 10.3 (Unit) Publish the CLI to npm from the same tag, so `npx open-wiki init` works with nothing installed, and fail the release when the two artifacts disagree on version — `adr:0014-typescript-everywhere-except-audio-capture`
- [ ] 10.4 (Unit) Publish to winget and Scoop, with the manifests pointing at the release URL and quoting its hash
- [ ] 10.5 (Unit) A README with the recording notice, the responsibility to inform participants, what the SmartScreen warning on an unsigned installer means, and what committing a wiki puts in front of everyone with repository access
- [ ] 10.6 (Unit) Package the hooks and the scaffolding command as an installable Claude Code plugin — never the skills themselves, which would be a second copy of the convention (`adr:0015-the-convention-ships-as-skills`), and never a `.mcp.json`, whose contents differ per user — with `.claude-plugin/marketplace.json` at the repository root so `/plugin marketplace add` reaches it, and `claude plugin validate --strict` in CI — see [[claude-code-plugins]]

---

## Notes

**Order.** The minimum product is 2 + 3 + 5 + 9: one project directory, one uploaded
markdown file, a store that validates, and the CLI plus the gate that makes an agent's
writes go through it. With that the whole cycle already runs, with no audio, no PDF and no
pretty UI. Close that path first — it answers the only question that matters, which is
whether an agent can build and maintain the wiki under the convention you gave it.

Group 8 comes after: a wiki Claude Code already operates has value with an ugly UI, and the
reverse is not true.

**Group 4 is the most expensive and the least central.** A meeting is the source that
leaves no trace on its own, but the product has value without it, and it flows into the
same `text.md` a PDF does — it can arrive later with no downstream change. If something has
to wait, it is this group.

**Seams where this tends to fail.**

*There is no recompilation any more.* With distillation out of the application, `wiki/`
stopped being derivable from `raw/` and became primary content. No task rebuilds the wiki,
and none can. The pair 2.3–2.5 is the only net the product itself has, which is why all
three are `(TDD)` and come before anything that writes.

*The gate moved, and 9.5 is where it lands.* MCP no longer writes, so the agent writes with
its own tools. Refusal is rebuildable — a `PreToolUse` hook receives the content about to be
written and can deny it with a reason — so the store keeps its promise for `Edit` and
`Write`. What it does not keep is coverage: a hook matches a tool, and a page written
through Bash carries a command string rather than page content. Denying `Edit(wiki/**)` does
not constrain Bash either, since permission rules are per tool. 9.5 has to answer for the
shell, not only for the file tools, and where neither a hook nor a CLI verb is in place —
another harness, a bare checkout — group 7 is the only thing between a wrong page and a
permanent one.

*The convention lives in prose, now in a skill.* `adr:0015-the-convention-ships-as-skills`
gives it one home, which removes the drift of having two. It does not remove the other
failure: group 5 checks form, not meaning, so a well-formed and wrong page passes. And a
skill scaffolded into a project ages there — that record leaves the version marker open,
and until it is closed a project set up today keeps today's convention forever.

*The time map lies with confidence.* It runs through 4.7, 4.11, 4.13, 5.3 and 7.3. If it is
wrong, provenance points at the wrong instant — worse than not existing. Three manual checks
on an hour-long recording are an acceptance criterion for group 4.

*Disk retention has a correct order.* An hour of WAV takes ~690 MB, and the deletion (4.14)
sits at exactly the point that can be interrupted. Deleting before the confirmation loses
the recording; never deleting fills the disk in twenty meetings. The journal of 4.9 is what
the confirmation is checked against, so 4.9 and 4.17 come before 4.14 does anything
irreversible — and a run abandoned at chunk four keeps its WAV forever, which makes
surfacing a stalled recording (6.2) part of the retention story rather than a nicety.

*The validation error is an interface.* 9.12 looks cosmetic and is not: with the agent
writing, a refusal it cannot understand becomes an attempt it repeats verbatim. The message
is what closes the loop, and it now has three mouths — the CLI, the hook and the editor —
which have to say the same thing.

*Two artifacts, one version.* The installer and the npm package ship from the same tag
(10.3). A skew between them fails looking like corrupted state rather than a bad install,
which is the cost `adr:0014-typescript-everywhere-except-audio-capture` accepted.

**Research, later, and why it still costs almost nothing.** Nothing in this plan asks the
application to go and find material — sources arrive because a person uploaded a file or
recorded a meeting. But 3.7 watches an inbox, which means an agent that can already read
the web, a ticket tracker or another repository can drop what it found into the project and
then write pages citing it. No new component, and no MCP tool either: the agent is already
inside the directory.

The one thing that has to be right is what gets ingested. **Store the retrieved text, not
the URL.** A link rots, is edited, or sits behind a login by the time someone follows the
citation, and a citation that opens nothing is worse than none — which is the same reason
`adr:0006-opus-as-the-provenance-format` keeps the audio rather than only the transcription.
Ingesting the fetched text makes an external source immutable in exactly the way a
recording already is, and the URL becomes a note on it rather than the evidence.

**Methods.** The `(TDD)` ones are the tasks where being wrong produces no symptom: track
alignment, pause, the time map, atomic writing, the operation log, undo, confinement to the
project, the configuration split, the three write validations, the write gate and the MCP
process's confinement. They are also the ones to surface before landing, even in an
automatic run.

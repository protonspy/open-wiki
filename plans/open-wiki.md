---
autonomy: auto
ci: wait
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

> **Two of this plan's decisions have since been narrowed, and this file is the record
> of the MVP as it was decided rather than a description of today.** The application
> calls an LLM in two places now — transcription, and the embedded agent of
> `adr:0019-an-embedded-agent-that-reads-freely-and-writes-through-the-gate`, which
> also put chat inside the window. And it no longer reduces a source to text:
> `adr:0022`'s companion, `adr:0021-sources-are-stored-not-parsed`, keeps the original
> and leaves the reading to the agent. The clause that survives both is the one that
> mattered: **the application does not write content, it validates and records.**

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
MCP is read-only, over stdio, spawned by the harness, and serves a project other than the
one the harness has open — not because anything forbids it, but because consulting through
a protocol what is already on disk buys nothing
(`adr:0013-the-project-directory-is-the-unit`) · TypeScript
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

- [x] 1.1 (Unit) Set up the monorepo: a pnpm workspace for `apps/desktop` and `packages/*` — the access module, the CLI and the MCP process among them — a cargo workspace for `crates/recorder`, shared strict TypeScript
- [x] 1.2 (Unit) Fill in `.claude/rules/project.md` with the real build, test, scoped test, lint and format commands
- [x] 1.3 (Unit) CI on GitHub Actions on `windows-latest`: Rust and TS build, tests with a coverage floor of 76% per package, lint
- [x] 1.4 (Unit) Remove `.claude/` and `CLAUDE.md` from `.gitignore` — the methodology is versioned with the code, and today it exists only on this machine
- [x] 1.5 (Unit) Bundle `vendor/ffmpeg` through a download script with hash verification

## 2 — Project directory and safe writing

- [x] 2.1 (Unit) One scaffolder, in the access module of 9.1: it creates `raw/`, `wiki/` and `.state/`, refuses a directory already occupied by something else, and calls the settings of 2.7, the ignore entries of 2.8 and the skills of 9.3 rather than reimplementing any of them. `ow init`, the launcher and the first run all go through it, so a project is the same project whichever door it came through
- [x] 2.2 (TDD) A registry of known project paths, resolving a name to a directory for the launcher and for `.mcp.json` — a name is never a path segment, an unknown name is refused rather than guessed at, and a directory that moved degrades to a refusal, never to a search or to the current directory. It is a cache, never truth, and the names in it come from committed files
- [x] 2.3 (TDD) Write a page atomically — temporary file plus rename — snapshotting the touched pages into `.state/` before any write, with the snapshot callable on its own: on the hook path the agent's own tool does the writing, so the snapshot has to happen without this module performing the write it is protecting
- [x] 2.4 (TDD) Record every write in a log in `.state/`, with its origin (editor, CLI, hook), the affected pages and the time — it records what was observed, not only what this application performed
- [x] 2.5 (TDD) Undo an operation by its id, restoring the snapshot and removing what it created
- [x] 2.6 (TDD) Refuse a write that resolves outside the project — resolving the real path before comparing, and covering a relative path, a symbolic link and a Windows directory junction, which needs no privilege and is not a symlink
- [x] 2.7 (TDD) Split the configuration: project settings committed inside the project under a closed schema that refuses an unknown key and carries no local path, and every secret only in the application's data directory keyed by project path — never in the project directory, unconditionally, because `git init` a week later turns a conditional rule into a leak
- [x] 2.8 (TDD) Write the ignore entries at `ow init` so that recorded audio and `.state/` are out by default and committing them is opting in — `.state/` holds every page as it was before each write, which is where a redaction survives the redaction

## 3 — Sources: files

- [x] 3.1 (TDD) Register a source in `raw/<id>/` with a `manifest.json` carrying its title, the original preserved, and the directory marked immutable once written — the id is derived from the source's name and frozen there, per `adr:0011-sources-are-named-by-what-they-are`
- [x] 3.2 (Unit) Upload Markdown and plain text: copy into `raw/` and normalise to `text.md`
- [x] 3.3 (Unit) Upload a PDF: extract the text to `text.md`, keeping the page number as a provenance anchor
- [x] 3.4 (Unit) Upload a DOCX: extract the text and the heading hierarchy to `text.md`
  - Requirement gap a review surfaced, to settle in group 7 with the rest of provenance: a DOCX records no pagination, so this writes the heading hierarchy and **no** page anchor — inventing a `p<N>` would be a number that looks like provenance and points nowhere. But 5.4 already shipped, and its `FILE_FRAGMENT` accepts only `p<N>` for a `src://` citation. So a DOCX source is citable only as `src://<id>#p1`, which resolves to the source but to no place inside its `text.md`. Closing it means either a fragment form for a structural anchor (a heading slug, checked against the headings in `text.md`) or accepting that a DOCX is cited whole. The MVP does not depend on it: the path that matters end to end is markdown and PDF.
- [x] 3.5 (Unit) Drag files onto the window and see what was recognised and what was not
  - The drop reports **what was recognised and what was not** — the second half of the task. A partial success reported as success is how a source silently never arrives, and a name already taken is reported as itself, because `adr:0011` chose that refusal deliberately.
- [x] 3.6 (TDD) Derive the id: lowercase, accents folded, anything outside `[a-z0-9]` collapsed to one `-`, and refuse a filename already taken in this project instead of inventing a suffix
- [x] 3.7 (Unit) Watch `raw/_inbox/` and ingest what lands there through the same path as 3.1 — the way an agent hands over material it fetched, now that no MCP tool ingests. The inbox is the one mutable thing under `raw/`: it is a doorway, emptied by ingestion, and it is not a source, so nothing enumerates it, cites it or reports it uncited
  - **Now wired.** 8.2's shell holds the watcher open for the life of a project window (`apps/desktop/src/main/index.ts`), and each arrival is reported where a drop is reported — the doorway and the drop zone are two ways into one registration, so they say the same thing. It starts asynchronously, because `watchInbox` waits for chokidar's initial scan and a window that blocked on it would be a window that does not open; a window closed before the handle arrives closes it anyway, or the watcher outlives its window.
  - A doorway that **stops working is reported, not logged**. A watcher gone quiet is indistinguishable from an inbox nobody is using, and what it silently drops is material an agent believes it handed over.
  - **What is already in the doorway when a window opens is listed, never taken** — `ingestExisting: false`, which the desktop passes and nothing else does. A security review caught what wiring the watcher had quietly changed: `raw/` arrives with a `git clone`, so a repository can ship `raw/_inbox/x.pdf`, and ingesting on sight would parse a stranger's bytes in the privileged main process and delete the file out of the user's tree before anybody clicked anything. The doorway is for an agent handing something over **during a session** — that is what an event is — and a file that came out of a clone is not that.
  - Left alone is not lost: the window says what is waiting and offers to take it. That report is **asked for rather than pushed**, which is what makes it reliable — anything announced at startup is announced before the renderer has subscribed and vanishes, since `webContents.send` has no queue. Live arrivals stay pushed, because by then the window is listening. Everything the main process does push is buffered until the document has loaded, for the same reason.
  - `drainInbox` stays callable on its own. That is what a process with no window — a test, a script — uses, and it is what the "Add them" button reaches through the watcher's own queue, so an explicit drain and an event never read the same file twice.

## 4 — Sources: audio recording

- [x] 4.1 (TDD) `recorder.exe`: capture the microphone and the WASAPI loopback into two WAV tracks aligned by the QPC clock, manufacturing silence when the API delivers no frames
  - **Not verified against hardware, and that gap is real.** The device sits behind a `CaptureSource` trait; everything above it — alignment, manufactured silence, pause arithmetic, the time map, the manifest, the JSON-RPC — is tested on every platform. The WASAPI layer compiles for `x86_64-pc-windows-msvc` and passes clippy there, but no test in this repository has captured a frame: CI has no audio device.
  - What that gap actually cost, on this branch: a review reading the source found the loopback stream was being opened as `(Render, Render)`, which never sets `AUDCLNT_STREAMFLAGS_LOOPBACK` — the system track could not capture and the sidecar exited at launch. It also found capture being started twice and failing with `AUDCLNT_E_NOT_STOPPED`. Both compiled, and both are invisible to every test that does not touch a device. **Green CI means the session logic is right and the binary builds. It does not mean audio works.** The three manual checks this group's notes call for are the only thing that can say that, and they are outstanding.
- [x] 4.2 (TDD) Survive a default-device change mid-recording, reopening the stream and noting the event in `device_changes`
- [x] 4.3 (TDD) Pause and resume: both tracks stop and return at the same instant, the paused stretch leaves both as one block, and the time map still maps any recorded instant to the real clock instant
- [x] 4.4 (Unit) Emit `manifest.json` with the recording's title, the absolute timestamp of each track's first frame, and the pause intervals
- [x] 4.5 (Unit) Expose the sidecar over stdio JSON-RPC with `start`, `pause`, `resume`, `stop`, `status`, `devices`
- [x] 4.6 (Unit) ffmpeg: downmix to 16 kHz mono, VAD cutting silence from 800 ms, encode to Opus 24 kbps
  - The gate is ffmpeg's `silencedetect`, an amplitude threshold rather than a trained VAD — it is what the bundled essentials build carries. The tuning errs towards keeping: a gate that keeps too much wastes a few seconds of Opus, one that drops a quiet sentence loses evidence.
  - The cut is `atrim` plus `concat`, **not `aselect`**. `aselect` is the shorter recipe and is a *frame* selector: it drops whole decoded frames, so every boundary quantises by ~21 ms and — with `between` inclusive at both ends — quantises outward every time. The error is signed, so two hundred cuts leave the file seconds longer than the map says. A review caught it before any recording existed to be mis-cited.
  - Like 4.1, **not verified against a real file.** Everything above `FfmpegRunner` is tested; that ffmpeg accepts these arguments is not, because CI has no ffmpeg. Standing manual check: preprocess an hour-long recording with a few dozen pauses and confirm `ffprobe`'s duration of `mic.opus` matches `compressedDurationNs`. The pipeline now refuses to write a map that disagrees with the file by more than a second, so this fails loudly rather than producing a citation that opens the wrong moment — but a green refusal is still a broken pipeline, and only the manual run says which.
- [x] 4.7 (TDD) Emit the time map converting a compressed instant into a real instant, and the chunk boundaries at silence points
  - **Red observed** before any implementation: 36 assertion failures across `compress.spec.ts`, `timemap.spec.ts` and `chunks.spec.ts` against signature-only stubs, then green on the real implementation.
  - **Silence is cut only where every track is silent**, so both tracks share one compressed clock — `adr:0017-one-compressed-clock-for-both-tracks`. Cutting each on its own silence is the obvious design and it undoes 4.1 and 4.3: the files come out different lengths and `rec://<id>#14:32` would have to say which track it meant.
  - `timemap.json` is the artifact, and **5.4's dormant in-range check is live against it** — a citation past the end of a recording is now refused, naming how long the recording runs. A recording with no map yet keeps the weaker check, because an absent map cannot make a citation resolve falsely.
  - Durations are nanoseconds; **wall-clock instants are milliseconds**. Nanoseconds since the epoch is ~1.75e18 and JavaScript is exact only to 9.007e15, so the unit is chosen where the exactness is free rather than where it merely reads consistently.
  - Boundaries are snapped onto the 16 kHz output sample grid before the map is built, so the map and the encoder are computed from the same integers rather than agreeing by rounding.
- [x] 4.8 (Unit) A `SttProvider` interface with `groq` and `whispercpp` adapters, swappable by configuration
  - Each declares the container it wants a chunk in. Groq takes FLAC because 15 minutes of 16 kHz mono PCM is ~28 MB against a 25 MB cap — the one chunk length 4.7 is allowed to produce is the one that would not fit. whisper.cpp takes WAV, which is what it reads natively.
  - Neither the whisper.cpp binary nor its model is bundled. They are large and the size-against-accuracy choice is the user's, so the adapter refuses clearly rather than degrading to the provider the user chose *not* to use.
- [x] 4.9 (TDD) Transcribe chunks one at a time, writing each result to the journal before the next starts, so an application killed mid-run loses at most the chunk in flight — `adr:0012-transcription-is-a-journalled-serial-pipeline`
  - **Red observed** first: 28 assertion failures across `journal.spec.ts` and `absolute.spec.ts` against signature-only stubs.
  - Both tracks are transcribed, so 4.12 can label `me` and `remote` by the track a passage came from. The journal's unit of work is one chunk of one track.
  - A failure records and carries on — 6.3 offers "redo only what failed", which needs the rest attempted — but three failures in a row stop the run. That is the shape of a bad credential, and finding it out costs twenty requests on a paid provider otherwise.
  - The journal's `chunks[].done` / `chunks[].error` are a **contract with `sources/state.ts`**, which reads the same file to render progress. Honouring it needed a change there: `failed` used to mean "some chunk has an error", which — now that the pipeline records an error and carries on — made a single 429 twelve minutes into a healthy run read as a failed source, with a progress count that kept climbing, for the remaining forty. `failed` now means nothing is left to try, and the error is carried on the in-flight stage too.
- [x] 4.10 (Unit) Seed the transcription vocabulary with the names already present in the project's pages — it is what stops the project's own name from coming out wrong
  - Lives in `@open-wiki/access`, because it reads pages. Ranked: single unusual words are what a model gets wrong, and a title that is a sentence is dropped — it costs as much prompt as four names and helps with none of them.
  - **The best names go last in the prompt.** Whisper's window holds only its *last* 224 tokens, so a list ordered best-first puts "Fenix" exactly where truncation drops it — the feature would have degraded precisely on the projects with enough pages to matter. A review caught it; the ranking is best-first and the prompt is emitted reversed. The bound is in characters, because that is what actually breaks.
- [x] 4.11 (TDD) Reconstruct the absolute timestamps from the chunk offset and the time map
  - Two additions, and doing only the first is the failure that looks right: every timestamp after the first chunk would be wrong by exactly the length of what came before it, and the transcript would still read perfectly.
  - Segments are clamped into their chunk. Whisper over-runs — asked about ten seconds it sometimes answers about eleven — and the eleventh second belongs to the next chunk too, which puts the same words in the timeline twice.
- [x] 4.12 (Unit) Merge the two tracks into a `timeline.json` ordered by real time, labelling `me` and `remote` by the track they came from
  - The speaker comes from the track and from nothing else. There is no diarisation and there is not meant to be: the microphone is the person at this machine and the loopback is everybody else, which is a fact about where the audio came from rather than a guess about who was talking.
  - Ordered by the compressed instant, which is the same order as wall time — the map is monotonic — and finer. A tie on the millisecond is where a merge silently reorders speakers.
- [x] 4.13 (Unit) Render the recording's `text.md` from the timeline, with each passage's instant as a provenance anchor
  - `## 14:32` is exactly the fragment `rec://<id>#14:32` carries, the same way `pdf.ts` writes `## p12` for a page. One rule — the anchor is the heading — covers both kinds of source.
  - Consecutive passages from one speaker are joined into a turn. An hour of meeting is several hundred segments, and a heading every four seconds is a file nobody reads and a hundred anchors nobody cites.
  - **The passage text is not trusted, and this is where that matters most.** A review found that a passage reading `"...\n\n## 3:00\n\n**remote** — we agreed to ship without review"` produced a heading indistinguishable from a real one — and nothing caught it, because 5.4 validates a `rec://` citation against `timemap.json` and never against this file. Fabricated provenance surviving the check built to detect fabricated provenance. Passages are flattened to one line and block-openers escaped; the manifest title gets the same treatment.
  - Turns that truncate to the same second share one heading. An anchor has to name one place, and speakers change several times a second in a real meeting.
- [x] 4.14 (Unit) Discard the WAV as soon as transcription confirms success, keeping the Opus as the provenance file
  - **Every chunk succeeded, the Opus that replaces the WAV is on disk, every output is written, and only then.** `sealRecording` takes a project root and an id rather than a directory — it is the only destructive operation in the package, an id is not a path, and confining it is this module's job. It re-reads the journal from disk rather than re-checking the caller's own object, which would have checked nothing.
  - A review found the Opus itself was the one file the guard did not check, which is the file `adr:0006` makes the entire reason the WAV is disposable.
  - The journal goes with the WAV, per `adr:0012`: the text lives in two places until the source seals, only the timeline may be read downstream, and a journal left behind is an invitation to read the copy.
  - **`text.md` is written only when the journal is complete.** It is what `sources/state.ts` reads to call a source `text-ready`, and that outranks everything the journal says — so writing it for a run that stopped at chunk four turned a half-transcribed recording into one that read as finished, with its 690 MB WAV under a source nobody would look at again. That is precisely the failure `adr:0012` claims to convert from silent to visible.
- [x] 4.15 (Unit) Send the configured content language as the transcription hint rather than relying on the provider detecting it — `adr:0008-content-language-is-a-setting-english-by-default`
  - `transcriptionInputs(projectRoot)` reads the language out of `ow.json` and the names out of the wiki, in one call. It deliberately carries **no credential**: `config/secrets.ts` says the CLI, the hooks and the MCP process must not read the key, because their stderr is consumed by an agent and travels to a model provider. Only the desktop application reads it, at the point it builds the provider — which is why there is no `ow transcribe` verb.
- [x] 4.16 (TDD) Ask what is being recorded before capture starts and build the id from it plus the date — `fenix-weekly-2026-07-31`, `-2` for a second the same day — falling back to the timestamp rather than blocking capture on an empty field
  - **Red observed** first: the whole file failed on a missing `slugify`, then on assertions once it existed.
  - `-2` is the opposite of the rule for a file, which 3.6 refuses outright so the user renames it. The difference: a filename is a thing the user already has a name for, and two `fenix-weekly` on one Tuesday is a normal Tuesday with nothing to rename.
  - Slugged with `slugify`, not `deriveId` — the latter keeps a trailing `.pdf` because a file's format is part of its identity, and would have kept `.arch` from "Vendor call re. arch".
  - The prompt itself is group 8's; this is the id it produces.
- [x] 4.17 (TDD) Resume from the journal on reopening, sending only what failed or never ran, and refuse a journal whose chunk boundaries, provider or model no longer match rather than stitching two segmentations into one timeline
  - The dangerous mismatch is not a different chunk *count* — it is the same count cut in different places, where every offset inside every chunk means something else and the result reads perfectly. Boundaries are compared one by one, not summed.
  - The refusal says what to do about it, and `restart: true` is how a caller takes the offer.
  - **The content language is checked with the provider and the model**, which is one more than `adr:0012` lists. It is the same class of mismatch: resuming a `pt-BR` journal after the setting moved to English produces one transcript in two languages, which reads as one. The record left the field recorded and unread; this makes it mean something.
- [x] 4.18 (Unit) Write `timeline.vtt` beside `timeline.json`, so the recording can be followed in any player and taken away if the user stops using this application
  - Cued on the compressed clock, because that is the clock of the Opus a player will have open beside it. A wiki whose provenance only opens inside one Windows binary is provenance with a hostage in it.
  - Written from the timeline and never read back. `adr:0012` names it a second representation of one truth and says which one wins.

## 5 — The wiki as a validated store

What replaces the code that used to write the pages: the application does not guarantee
the content is good, it guarantees it is **well formed**. Three paths reach a page, and they
divide one module rather than each inventing its own:

- **The editor and the CLI verb** call it directly and get the whole service — snapshot,
  validation, the automatic fields, the atomic write, the log.
- **A `PreToolUse` hook**, when the agent writes with its own tools, gets the same service a
  different way: it is handed the content before the file exists, so it snapshots,
  validates, returns the completed frontmatter as `updatedInput`, and denies with a reason
  when the page cannot be fixed by filling a field in. `PostToolUse` is where the log, the
  changelog and the index go, because those describe a write that has actually happened.
- **The folder observer** catches what neither saw — a page edited in Obsidian. It cannot
  refuse anything: it records the change in the log of 2.4, redraws the screen through 8.10,
  and whatever is wrong with the page surfaces later as a group 7 finding.

One implementation, three callers. What no path covers is a write made through the shell,
which is 9.5's problem.

- [x] 5.1 (TDD) Validate the page frontmatter against the schema (`id`, `type`, `title`, `status`, `aliases`, `updated`, `sources`, `superseded-by`) and refuse the write with a reason, instead of storing something malformed — `index.md`, `changelog.md` and `log.md` are not entity pages and are validated as themselves, not against this schema
- [x] 5.2 (TDD) Record supersession as data, not only as struck-through prose: `status`, `superseded-by` and the date it happened, on the page that was replaced, so that "what replaced this, and when" is answerable by a traversal rather than by reading — without it 9.12's `ow graph superseded` has nothing to walk
- [x] 5.3 (TDD) Refuse a write whose wikilink does not resolve to an existing page, saying which link broke
- [x] 5.4 (TDD) Refuse a write whose provenance citation does not point at an existing source and, for audio, at an instant inside the recording
- [x] 5.5 (Unit) Fill in `updated` and append the source to `sources` automatically — returned as `updatedInput` on the hook path, so that it does not depend on the agent remembering rather than merely telling it to remember
- [x] 5.6 (Unit) Append a line to `log.md` and an entry to `changelog.md` after every write, with its origin
- [x] 5.7 (Unit) Maintain the index: register a new page in `index.md` and flag a page that became unreachable
- [x] 5.8 (TDD) Do not let a correction the store itself made read as somebody else's edit. Two paths produce it: a hook that rewrote the content through `updatedInput` leaves the agent holding a copy that no longer matches the disk, and the editor filling `updated` on save makes the next save from the same buffer look stale to 8.8. Both have to resolve without asking the writer to reconcile a change it did not make

## 6 — Source flow

- [x] 6.1 (Unit) Model each source's state — received, text ready, cited on a page — persisted and resumable
  - **Derived, not persisted.** The filesystem already is both: `manifest.json` says received, `text.md` says the text is ready, the pages say what is cited, `journal.json` says how far a transcription got. A state file beside those would be a second record of one fact, and the copy is the one that goes stale — the rule this plan applies to its own checklists and to the wiki's index. So a crash loses nothing and there is nothing to reconcile: the next read observes the same directory and reaches the same answer, which is what "resumable" was asking for.
- [x] 6.2 (Unit) Sources screen: one row per source with its current state, what is missing, and the error when it stopped
  - Every row is derived from the directory, which 6.1 already established as the only record. The screen arranges; it does not derive. One read of the wiki feeds all of them, so twenty sources are not twenty walks over the pages.
- [x] 6.3 (Unit) A transcribe button on a stopped recording, with per-chunk progress and the option to redo only what failed
  - The run is here rather than in the CLI because **this is where the credential is** — `config/secrets.ts` forbids the CLI, the hooks and the MCP process from reading the key, and 4.15 left the wiring deliberately unbuilt until 8.3 stored one.
  - "Redo only what failed" needs no flag: a resume sends exactly what did not succeed, which is `adr:0012`s default. The button says which of the two it is about to do, because "Transcribe" on a recording nine chunks in reads as starting over.
- [x] 6.4 (Unit) Show, for a source, which pages cite it, and navigate from there to the page
- [x] 6.5 (Unit) Show, for a page, which sources it came from — the inverse path of the previous one
  - Reads the page’s prose as well as its `sources` field: 5.5 mirrors one into the other, and a page written before that ran has its citations in only one of the two.
  - **On the page itself**, under the frontmatter, because the question it answers is the one a reader has while they are reading — provenance behind a button nobody presses may as well not have been recorded. The backend, its IPC channel and its tests all existed before the surface did, which made this read as done from every angle except the user's.
  - It carries the **title and somewhere to click**, not the bare id the citation spells. Clicking opens the panel a provenance link in the prose opens (8.6), at the source's own start — `p1` for a document, `0:00` for a recording, which are the anchors `pdf.ts` and 4.13 actually write. A fragment of the wrong shape resolves to nothing while reading perfectly reasonably.
  - A citation whose source is gone is **shown as broken, not dropped** — the same choice 8.5 makes for an unresolvable wikilink, and the same citation 7.3 reports. Hiding it would leave the reader believing the page is sourced, which is the one wrong answer available here.
- [x] 6.6 (Unit) Highlight a source sitting in `raw/` that no page cites, which is the case that disappears from view on its own
- [x] 6.7 (Unit) Correct a source's title without moving its directory or touching a citation — the freeze in `adr:0011-sources-are-named-by-what-they-are` is only bearable if the readable name stays editable

## 7 — Integrity

With the agent writing through the filesystem, this stops being hygiene and becomes the net
of record.

- [x] 7.1 (Unit) Report broken wikilinks and orphan pages
- [x] 7.2 (Unit) Report a desynchronised changelog and a source never cited
- [x] 7.3 (Unit) Report a provenance link that does not resolve to an existing source or instant
- [x] 7.4 (Unit) Report a synonym used where the project has a canonical term
- [x] 7.5 (Unit) Report a codewiki citation that no longer resolves or runs past the end of its file — the check that comes with scaffolding codewiki, per `adr:0015-the-convention-ships-as-skills`
  - **Settled** — `adr:0016-a-page-is-its-slug-wherever-it-sits`. The gap was wider than it looked: `listEntityPages` read only the *top level* of `wiki/`, so `wiki/projects/`, `wiki/people/` and `wiki/topics/` — the layout this plan's own diagram describes — were invisible too, not just codewiki. A page is now addressed by its slug wherever it sits under `wiki/`; a folder is organisation and a link is a name, which is what makes `[[wikilink]]` work in the first place. Slug uniqueness is the one rule that model needs, and it is a finding (`page.duplicate-slug`) rather than something resolved by silently picking one. Codewiki lives at `wiki/codewiki/`; a top-level `codewiki/` is no longer gated and is reported as misplaced.
- [x] 7.6 (Unit) Expose the checks in the UI, with the correction path described per finding
  - Rendering, not new checking, exactly as the deferral said. Every finding already carries its `fix`, and the panel puts it where the person reading the problem is.
  - Deferred to group 8, which is where the UI is. The findings already carry the correction path — `fix` on every one — so this is rendering, not new checking.
- [x] 7.7 (Unit) Expose the same checks as `ow check`, so an agent and a CI job can run them without the application

## 8 — Application

- [x] 8.1 (Unit) Design system: dense dark-theme tokens, a compact type scale, focus and error states, a recording indicator
  - Tokens only, in one file. Dense because of what the window is for: a wiki read beside the harness, glanced at while a meeting records. Neither wants generous whitespace.
  - Focus is visible on everything, always. `outline: none` with nothing in its place is the most common way a desktop UI becomes unusable for the people who navigate it by keyboard.
  - The recording indicator is persistent and not subtle. Somebody who forgets it is running ends up with a recording of a conversation the other people in it believe ended.
- [x] 8.2 (Unit) Electron shell scoped to the directory it was opened in: navigation across wiki and sources, record, pause and stop, a persistent indicator while recording
  - **The project root is bound in the main process and never crosses the bridge.** The renderer names a slug, never a path, so the worst a wrong answer can do is fail to resolve.
  - `contextIsolation` on, `nodeIntegration` off, `sandbox` on, and a CSP of `default-src 'none'`. This window renders markdown an agent wrote; a renderer with Node in it is one prompt injection away from being the agent's hands.
  - The entry point is wiring and nothing else. Which project this is, what the renderer may ask for, what a folder change means — each is a module beside it that a test calls without starting a window, because CI has no display.
  - A launch that names no project **says so and quits** rather than opening the user's home folder as a wiki. 8.4's launcher is what belongs there.
  - The record/pause/stop calls go over 4.5's line protocol. The transport is injectable, so the framing and the ordering are tested without a Windows binary; that a real `recorder.exe` answers them is not, and joins group 4's outstanding manual checks.
  - **The status poll must never start the sidecar.** `recorder.exe` opens both WASAPI devices the moment it launches, before reading a request — so the lazy `session ??=` that a status poll went through held the microphone from the moment the window opened, with the chrome saying nothing was being recorded. That is the failure the persistent indicator exists to prevent, inverted. A review caught it; `ensure` and `peek` are now different methods and only `record:start` reaches `ensure`.
  - **`record:start` takes an occasion, not a directory.** It used to take the path the sidecar wrote into, which is a compromised renderer choosing anywhere the user can write. The id comes from 4.16 and the directory from it, so a recording lands under `raw/` because there is nowhere else it can go.
  - The main process **refuses navigation** rather than relying on the renderer's click handler, and allowlists the scheme before `shell.openExternal`. A preload re-runs on every navigation, so a window that reached a remote origin would hand it `window.ow`; and `openExternal` is `ShellExecute` on Windows, which invokes whichever protocol handler is registered — `ms-msdt:` and friends are documented paths from a link to code execution.
- [x] 8.3 (Unit) Transcription credential: a Groq key typed and validated on the spot, or local whisper.cpp with no credential at all — stored as per `adr:0007-plaintext-credentials-in-the-config`
  - Checked **on the spot**, against the models endpoint rather than by sending audio: it costs nothing, and a 401 there means what a 401 from the real call would. A wrong key is discovered at the settings screen rather than an hour later, with a meeting already recorded.
  - A key that could not be *checked* is told apart from a key that is *wrong* — refusing to store one because the user is on a train would be this screen inventing a policy nobody asked for.
  - The key never crosses the bridge in either direction. `credentialState` answers whether one is stored, never what it is: a field pre-filled with it would put the applications one secret in the DOM of a window that renders markdown an agent wrote.
  - It is reached through a named `@open-wiki/access/secrets` subpath rather than the barrel, so the one place in the product that reads it stays visible in a single grep.
- [x] 8.4 (Unit) A launcher for when `ow` was run outside a project: the registry of known projects, and creating a new one
  - Creating a project goes through the scaffolder of 2.1 — the same one `ow init` and the first run use — so a project is the same project whichever door it came through.
  - A project whose directory moved is **shown, not hidden**. The registry is a cache and never truth (2.2), so it degrades to a refusal; hiding the entry would leave the user wondering where their project went.
  - Forgetting removes the entry and never the directory.
- [x] 8.5 (Unit) Browse the rendered wiki: follow wikilinks, see the page with its frontmatter, go back
  - markdown-it with `html: false`. A page carrying a `<script>` would run it inside a renderer that has the project open, and nothing in the schema needs raw HTML.
  - **Both extensions are markdown-it rules, not replacements over its output.** The first implementation did `String.replace` on rendered HTML, and a review showed what that costs: a citation inside a link title landed in `title="…"`, the substitution's own quote ended the attribute, and the rest became attribute names on somebody else's tag — plus every code span quoting `[[target]]` or `rec://…` became a live link, which several pages in this repository already do. Working on tokens removes the class.
  - **Routed by `data-ow-page`, never by an `href` scheme.** markdown-it renders `[x](page:evil)` quite happily, so a scheme is something a page author can mint; an attribute is not, because `html: false` means a page cannot write one.
  - A **broken** wikilink becomes a marked span rather than a link to nowhere — the reader should see the page is missing at the point they would have clicked, which is what 7.1 reports too.
  - A page is resolved by slug through the index, never by joining a slug onto a path. `adr:0016-a-page-is-its-slug-wherever-it-sits` makes the index the only thing that knows where a page is, so the correct implementation is also the one that does no path arithmetic on untrusted input.
  - Following a link after going back discards the forward history, exactly as a browser does. Anything else and Back stops meaning "where I came from".
- [x] 8.6 (Unit) Open the source at the right instant when a provenance link is clicked — audio at the timestamp, a document at the page
  - Audio is **seeked to the instant** rather than started at zero — that difference is the whole task. A citation the recording does not contain says so instead, which is the same answer 5.4 gives when it refuses one.
- [x] 8.7 (Unit) Edit a page's markdown with preview and save, going through the group 5 validations
  - Goes through `gateWrite`, the same entrance the agent’s writes use. An editor that validated its own way would be a fourth caller quietly disagreeing with the hook about what a well-formed page is — and the store’s denial reasons are shown verbatim, because 9.13 says the message has three mouths and they have to say the same thing.
- [x] 8.8 (Unit) Refuse to overwrite a page changed on disk since it was loaded, instead of losing the change silently
  - **Staleness is checked before the gate**: the two have different answers, one being *look at what changed* and the other *fix this field*.
  - A correction the store itself made is not somebody else’s edit (5.8), so this is `isStoreOnlyChange` and not a string comparison — and the editor takes back what *landed*, not what it sent, or its next save would look stale against a change it did not make.
  - It refuses and shows both versions. It does not merge and does not overwrite: at that moment both still exist, and the only unrecoverable outcome is picking one silently.
- [x] 8.9 (Unit) Create, rename and delete a page from the UI, fixing the wikilinks that pointed at it
  - A rename repoints what pointed at the page and is **one operation**, so undo puts the rename and every repointed link back together. The page’s `id` follows its slug keeping its type, or 5.1 would refuse every later save of it.
  - A **delete does not** rewrite the links. They are the record that something was expected to be there, and 7.1 reports them; a rename knows where the reader should go instead, and a delete does not.
- [x] 8.10 (Unit) Watch the folder and reflect changes on screen live, whichever wrote them — the agent, a hook, or the user in another editor
  - `awaitWriteFinish` is not tuning. `fs.watch` reports a file the moment it appears, which on a copy is halfway through being written — and a page read halfway through has no frontmatter, which the screen would render as broken.
  - It watches `wiki/` and `raw/` and not `.state/`, which is not content. A change rebuilds the index, because a new page changes which wikilinks resolve; the open page is re-read only when it is the one that moved.
  - A watcher that errors stops updating rather than taking the window with it: a project on a network share raises EPERM for reasons that have nothing to do with this application.
- [x] 8.11 (Unit) An operation history with undo, fed by 2.4, and honest about covering only what was observed
  - Honest about covering only what was observed, in the panel itself: a page written through a harness with no hooks is not in the log, and a history presenting itself as complete would make *undo* silently mean *undo some of it*.
- [x] 8.12 (Unit) Choose the content language at onboarding and change it afterwards — English by default, Brazilian Portuguese and Spanish alongside it — held in the project settings of 2.7 and reaching exactly two places: the transcription hint of 4.15, and the generated `CLAUDE.md` of 9.4, which is regenerated on change because it is generated and the skills are not
  - `CLAUDE.md` is regenerated on change, because it is generated and carries the language; the skills are not and are left alone, which is the distinction 9.4 draws.
  - The generator moved from the CLI into `@open-wiki/access`, beside `scaffoldSkills`: 9.3 and 9.4 are one act, and a copy in the CLI would have meant the desktop application either reaching into it or growing a second generator that drifts.
  - **The onboarding half was missing and is now there.** Changing the language afterwards worked, and `ow init --language` asked, but the launcher passed a hardcoded `"en"` — so a project created through the application was born in a language nobody chose, and the one screen the task names by name was the one that did not ask.
  - It is a **form, not a chain of `prompt()` calls**, and two of the reasons are worth keeping: Electron does not implement `window.prompt`, so the chain that stood there answered nothing in a packaged build; and a choice between three named options is not something a text box can offer or a user can guess the spelling of.
  - The three languages live in one module both screens import. A list written out twice becomes two answers to one question the moment a fourth language is added, and the values are the `Language` union itself, so a language added to the setting and forgotten in the picker is a compile error.

## 9 — The CLI, MCP and the agent's contract

- [x] 9.1 (Unit) A project access module — scaffold, read, search, validate, write — one implementation, imported by the application, the CLI and the MCP process
- [x] 9.2 (Unit) `ow` in a directory opens the application scoped to it, and with a subcommand runs headless: the shim the installer puts on `PATH`, and the same package `npx open-wiki` reaches
- [x] 9.3 (Unit) Write the wiki and codewiki skills into `.claude/skills/`, overwriting nothing already there, and expose the scaffolder of 2.1 as `ow init` — `adr:0015-the-convention-ships-as-skills`
- [x] 9.4 (Unit) Generate a short project `CLAUDE.md` that points at the skills, duplicates nothing they say, and carries the one thing they cannot hold because it varies per project: the configured content language — regenerated when 8.12 changes it
- [x] 9.5 (TDD) Settle and build the write gate as a pair plus a fallback: a `PreToolUse` hook that snapshots, validates, completes the frontmatter through `updatedInput` and denies with a reason; a `PostToolUse` hook that appends the log, the changelog and the index entry, which describe a write that has actually happened; a CLI verb for harnesses with no hooks; and an answer for a write made through the shell, which no per-tool rule reaches — `adr:0013-the-project-directory-is-the-unit` leaves the composition open and it cannot ship open
- [x] 9.6 (TDD) Refuse an agent-mediated write that lands in `.claude/`, `.mcp.json` or `CLAUDE.md` — the gate's own configuration is inside the project, and a write path that reaches it edits away its own restraint through a change that reads as documentation in review
- [x] 9.7 (Unit) `ow mcp --project <name> --read-only`: an MCP server over stdio, spawned by the harness, serving exactly the one project it was launched for
- [x] 9.8 (Unit) `ow consult add <name>`: write the consulting entry into this project's `.mcp.json`, naming the other project rather than its path, so the file is committable and portable — nobody hand-writes the stdio invocation, which is the paste step the pivot was supposed to have removed
- [x] 9.9 (TDD) The MCP entrypoint does not import the write path at all, so read-only is what the process can do rather than what it agrees to do, and no tool resolves a path outside the launched project
- [x] 9.10 (Unit) Read tools: the index as structure, a page returned whole, and the sources with their state and their `text.md`
- [x] 9.11 (Unit) Announce the project in the server's name and description, so an agent with several configured says which base it answered from
- [x] 9.12 (Unit) `ow graph` first and `ow search` after — the structural queries have no other owner and the supersession walk depends on the fields 5.2 records, where lexical search is what a scan over a few megabytes already does. Both are the local queries `adr:0013-the-project-directory-is-the-unit` sends to the CLI rather than to MCP, printing JSON
- [x] 9.13 (Unit) A validation error readable enough for the agent to fix it on its own and try again — the same text whether it came from the CLI, a hook or the editor
- [x] 9.14 (TDD) Pay down cold start: bundle the CLI to a single file, and talk to the running application over a local socket when there is one — the socket carries read and validate and never write, so the write verb always pays the standalone path, and both paths produce the same answer
  - Deferred to group 8: the socket peer is the running desktop application, which does not exist until group 8, and bundling the CLI now then re-touching it for the socket is doing the work twice. The unbundled CLI runs the whole MVP path; the bundle is a cold-start optimisation, not a functional one.
- [x] 9.15 (Unit) Verify end to end that Claude Code, working inside a project and starting from a single source, builds valid pages and then answers by citing them
- [x] 9.16 (Unit) Verify that a second project with no wiki of its own consults the first through a committed `.mcp.json` naming it, and answers citing its pages

## 10 — Distribution

- [x] 10.1 (Unit) A single NSIS installer with ffmpeg and `recorder.exe` embedded, written to `apps/desktop/release/`, with no external dependency to install, and the `ow` shim on `PATH` — `adr:0009-distribution-through-github-releases`
- [x] 10.2 (Unit) Release from a `v*` tag: CI builds the installer, refuses a tag that disagrees with the app version or that already has a release, and publishes it to GitHub Releases with its `SHA256SUMS.txt`
- [x] 10.3 (Unit) Publish the CLI to npm from the same tag, so `npx @protonspy/open-wiki init` works with nothing installed, and fail the release when the two artifacts disagree on version — claiming the package name before anyone else does, and publishing with provenance, because a product that verifies a hash on its own ffmpeg cannot ship a fetch-and-execute that verifies nothing — `adr:0014-typescript-everywhere-except-audio-capture`
  - **The name is scoped, and npm chose that, not us.** `open-wiki` is refused with a 403: too similar to the existing `openwiki`. A scoped name is not subject to that check at all, so the registry entry is `@protonspy/open-wiki` — and `--access public` stops being optional, because a scoped package defaults to restricted. Only the registry sees the scope: the installer, the plugin, the MCP server and the `ow` shim are all still `open-wiki`.
  - Found by releasing, not by reading. The version check, the republish guard, the ffmpeg fetch, the installer and the GitHub release all ran first; npm is the last step, and `adr:0014`'s ordering — the reversible artifact before the permanent one — is what kept a failure there from stranding a published version with no installer beside it.
  - The pin in the plugin's hooks and the publish command both read the name out of `packages/cli/package.json` now. They were copies of a string, and the old name is a *substring* of the new one, so the check would have passed a hook invoking a package nobody publishes.
- [x] 10.4 (Unit) Publish to winget and Scoop, with the manifests pointing at the release URL and quoting its hash
- [x] 10.5 (Unit) A README with the recording notice, the responsibility to inform participants, what the SmartScreen warning on an unsigned installer means, and what committing a wiki puts in front of everyone with repository access
- [x] 10.6 (Unit) Package the hooks and the scaffolding command as an installable Claude Code plugin — never the skills themselves, which would be a second copy of the convention (`adr:0015-the-convention-ships-as-skills`), and never a `.mcp.json`, whose contents differ per user — with `.claude-plugin/marketplace.json` at the repository root so `/plugin marketplace add` reaches it, and `claude plugin validate --strict` in CI — see [[claude-code-plugins]]

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
its own tools — and the entrance survives that intact. A `PreToolUse` hook is handed the
content before the file exists, can return the completed frontmatter as `updatedInput`, and
can deny with a reason. Refusal *and* the automatic fields both work on that path, so for
`Edit` and `Write` the store keeps its whole promise, not a weakened one.

What it does not keep is coverage. A hook matches a tool, so a page written through Bash
arrives as a command string with no page content to inspect, and denying `Edit(wiki/**)`
does not constrain Bash either, since permission rules are per tool. 9.5 has to answer for
the shell, not only for the file tools. Where neither a hook nor a CLI verb is in place —
another harness, a bare checkout — group 7 is the only thing between a wrong page and a
permanent one.

**This paragraph was wrong twice before it was right**, in both directions, because the hook
contract was reasoned about rather than read. Anything here that asserts what a harness can
or cannot do is a claim to check against the reference, not to infer.

*The convention lives in prose, now in a skill.* `adr:0015-the-convention-ships-as-skills`
gives it one home, which removes the drift of having two. It does not remove the other
failure: group 5 checks form, not meaning, so a well-formed and wrong page passes. And a
skill scaffolded into a project ages there — that record leaves the version marker open,
and until it is closed a project set up today keeps today's convention forever.

*The time map lies with confidence.* It runs through 4.7, 4.11, 4.13, 5.4 and 7.3. If it is
wrong, provenance points at the wrong instant — worse than not existing. Three manual checks
on an hour-long recording are an acceptance criterion for group 4.

*Disk retention has a correct order.* An hour of WAV takes ~690 MB, and the deletion (4.14)
sits at exactly the point that can be interrupted. Deleting before the confirmation loses
the recording; never deleting fills the disk in twenty meetings. The journal of 4.9 is what
the confirmation is checked against, so 4.9 and 4.17 come before 4.14 does anything
irreversible — and a run abandoned at chunk four keeps its WAV forever, which makes
surfacing a stalled recording (6.2) part of the retention story rather than a nicety.

*The validation error is an interface.* 9.13 looks cosmetic and is not: with the agent
writing, a refusal it cannot understand becomes an attempt it repeats verbatim. The message
is what closes the loop, and it now has three mouths — the CLI, the hook and the editor —
which have to say the same thing.

*Two artifacts, one version.* The installer and the npm package ship from the same tag
(10.3). A skew between them fails looking like corrupted state rather than a bad install,
which is the cost `adr:0014-typescript-everywhere-except-audio-capture` accepted.

*9.14 was built RED first.* Seven assertions in `packages/access/tests/socket.spec.ts`
failed against signature-only stubs before `socket.ts` existed — the verb split, the refusal
of a write, and the two paths agreeing. The socket is a boundary, and a boundary whose test
never failed has not been shown to test anything.

*The endpoint name is not a secret.* The pipe is named from a hash of the project path,
which is obscure and nothing more: any local process guesses or enumerates it. So both
directions are authenticated — a random token in the application's own data directory
(0600, in a 0700 directory), and an HMAC over the client's nonce coming back — because
whatever holds that endpoint decides what `ow read` prints into an agent's context.

*Bundling is what makes the packaging real, and it breaks three things quietly.* The
packaged application has no `node_modules` and no TypeScript, so the main process, the
preload and the CLI are all bundles — and each collapsed something the source relied on.
`import.meta.url` cannot be expressed in CommonJS (esbuild warns and exits 0, so the
packaging run stays green and the application does not start); the ESM output's `require`
stub throws for the CommonJS packages in the graph; and the resolvers that find ffmpeg and
`recorder.exe` count directories up from *their own source file*, which is three different
depths flattened into one file. The last is the worst, because everything passes and only an
installed copy fails to record — so `apps/desktop/src/main/resources.ts` states the packaged
location rather than deriving it.

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

**Methods.** A task is `(TDD)` here when being wrong about it produces no symptom — when the
code runs, the tests pass, and the damage shows up somewhere else or much later. That covers
three families: **time and alignment**, where a number is plausible and wrong; **the paths
that write**, where the loss is silent and there is nothing to roll back to; and **the
boundaries**, where the failure is that something got through. The annotation on each line
is the record of that call, not this paragraph — do not read a list here as the roll.

They are also the tasks to surface before landing, even in an automatic run.

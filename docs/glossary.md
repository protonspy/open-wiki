# Glossary

One canonical term per concept, and the synonyms to avoid. These terms appear in code, in
file names, in JSON schemas, in the MCP server's tools and in the pages the agent writes —
which is why each one is listed in the exact form it takes in the schemas.

- **project** — a directory holding `raw/`, `wiki/`, `.state/` and its scaffolded skills, opened by `ow` in its scope — `adr:0013-the-project-directory-is-the-unit`. There is no folder above it that the application owns. Avoid: vault, namespace
- **registry** — the list of known project paths, used by the launcher and to resolve a project name in `.mcp.json`. A cache, never a source of truth: a directory that moved degrades the entry, it does not corrupt the project. Avoid: catalogue
- **source** — any entry in `raw/`: an uploaded file or a recording. Immutable once written, and named for what it is — `adr:0011-sources-are-named-by-what-they-are`. Avoid: attachment
- **source id** — a source's directory name, and what a provenance link points at. Derived from the source's name when it is written, and never changed after.
- **title** — a source's readable name, held in its `manifest.json` and correctable at any time. It is not the source id and may drift from it.
- **recording** — one audio capture, named for the occasion and the date it happened, as in `fenix-weekly-2026-07-31`.
- **track** — one of the two captured streams, `mic` or `system`. Avoid: feed
- **timeline** — the two tracks merged and ordered by real time, in `timeline.json`, and written out as `timeline.vtt` for anything that reads WebVTT. Avoid: transcript
- **transcription journal** — the per-chunk record of a transcription in progress, in the recording's directory, that makes an interrupted run resumable — `adr:0012-transcription-is-a-journalled-serial-pipeline`. It is not the operation log of `.state/` and not the wiki's `log.md`.
- **time map** — the table converting an instant of the compressed audio into a real instant, in `timemap.json`. Avoid: offset table
- **chunk** — a ~10-minute piece cut at a silence point; the unit of transcription and of retry. Avoid: slice
- **ingest** — the path from a source to being available as `text.md` in the project. It ends there: writing pages is the agent's job. Avoid: sync
- **entity** — a person, project, topic or narrated code area with a page of its own, identified by `id` in the form `type:slug`. Avoid: subject
- **claim** — a statement recorded on a page, of type `decision`, `fact`, `action_item` or `open_question`, always with a citation. Avoid: insight
- **supersession** — marking an earlier decision as replaced, never deleting it. It is carried twice: as data, in the replaced page's `status`, `superseded-by` and the date, which is what a traversal can answer from; and as prose, struck through with the same date and a link, which is what a reader sees. The prose alone is not supersession — nothing can walk it. Avoid: override
- **provenance link** — the link that opens the source where a claim came from: an instant for audio, a page for a PDF. Avoid: backlink
- **write gate** — whatever makes an agent's write to `wiki/` pass through the group 5 validations now that MCP no longer writes — `adr:0013-the-project-directory-is-the-unit`. For the embedded agent the chosen mechanism is the **wiki-gate backend**; the term remains for the constraint itself, independent of the mechanism that enforces it.
- **wiki-gate backend** — the `WikiGateBackend` (`BackendProtocolV2`) the embedded agent reads and writes through: every read is confined with `assertWithin`, every write routes through `gateWrite` + `writePage` with origin `"agent"`. The write gate made concrete for the agent. Avoid: gate backend, write-gate backend
- **embedded agent** — the langchain `createAgent` graph scoped to one project window that reads the project like a harness and writes `wiki/` only through the wiki-gate backend with human-in-the-loop approval — `adr:0019`, `specs/embedded-agent`. Avoid: assistant, copilot, AI agent
- **chat pane** — the desktop pane that hosts the embedded agent's conversation, the fourth pane alongside wiki, sources and checks. Avoid: agent panel, chat window, chat tab

> **`session` stopped being a synonym to avoid.** It was listed against `recording`, from
> when the only sessions in this product were audio ones.
> `adr:0013-the-project-directory-is-the-unit` moved the product inside the harness's
> working directory, and "session" now regularly and correctly means one run of Claude
> Code — in the ADRs, in the hook mechanics, in what a skill costs to load. A rule that
> fires on every sentence about the harness gets ignored within a week, and an ignored
> check is worse than none, so `recording` keeps the canonical name and gives up the
> synonym.

> **`workspace` is no longer a term of this domain.** The user-facing sense — a folder above
> the projects — was removed by `adr:0013-the-project-directory-is-the-unit`. It stays in
> live use in `docs/stack.md`, where "pnpm workspaces" names the way the source monorepo is
> divided, and it stays throughout the ADRs written before the change, including the title
> and filename of `adr:0002-workspace-as-a-local-markdown-folder`, which several records
> cite. Those are history and are not to be edited. New writing does not use the word.

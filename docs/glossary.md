# Glossary

One canonical term per concept, and the synonyms to avoid. These terms appear in code, in
file names, in JSON schemas, in the MCP server's tools and in the pages the agent writes —
which is why each one is listed in the exact form it takes in the schemas.

- **workspace** — the root folder chosen by the user, with one directory per project. Avoid: vault, library
- **project** — a project inside the workspace, with its own `raw/`, `wiki/`, `.state/` and `CLAUDE.md`. The MCP server serves exactly one at a time. Avoid: namespace
- **source** — any entry in `raw/`: an uploaded file or a recording. Immutable once written, and named for what it is — `adr:0011-sources-are-named-by-what-they-are`. Avoid: attachment
- **source id** — a source's directory name, and what a provenance link points at. Derived from the source's name when it is written, and never changed after.
- **title** — a source's readable name, held in its `manifest.json` and correctable at any time. It is not the source id and may drift from it.
- **recording** — one audio capture, named for the occasion and the date it happened, as in `fenix-weekly-2026-07-31`. Avoid: session
- **track** — one of the two captured streams, `mic` or `system`. Avoid: feed
- **timeline** — the two tracks merged and ordered by real time, in `timeline.json`, and written out as `timeline.vtt` for anything that reads WebVTT. Avoid: transcript
- **transcription journal** — the per-chunk record of a transcription in progress, in the recording's directory, that makes an interrupted run resumable — `adr:0012-transcription-is-a-journalled-serial-pipeline`. It is not the operation log of `.state/` and not the wiki's `log.md`.
- **time map** — the table converting an instant of the compressed audio into a real instant, in `timemap.json`. Avoid: offset table
- **chunk** — a ~10-minute piece cut at a silence point; the unit of transcription and of retry. Avoid: slice
- **ingest** — the path from a source to being available as `text.md` in the project. It ends there: writing pages is the agent's job. Avoid: sync
- **entity** — a person, project or topic with a page of its own, identified by `id` in the form `type:slug`. Avoid: subject
- **claim** — a statement recorded on a page, of type `decision`, `fact`, `action_item` or `open_question`, always with a citation. Avoid: insight
- **supersession** — marking an earlier decision as replaced, preserving it struck through with a date and a link to the one replacing it. Avoid: override
- **provenance link** — the link that opens the source where a claim came from: an instant for audio, a page for a PDF. Avoid: backlink

> **`workspace` has another sense in `docs/stack.md`**, where "pnpm workspaces" names the
> way the source monorepo is divided. They are different things: one is the user's folder,
> the other is a tool for whoever develops the application.

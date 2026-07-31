# Glossary

One canonical term per concept, and the synonyms to avoid. These terms appear in code, in
file names, in JSON schemas, in the MCP server's tools and in the pages the agent writes —
which is why each one is listed in the exact form it takes in the schemas.

- **workspace** — the root folder chosen by the user, with one directory per project. Avoid: vault, library
- **project** — a project inside the workspace, with its own `raw/`, `wiki/`, `.state/` and `CLAUDE.md`. The MCP server serves exactly one at a time. Avoid: namespace
- **source** — any entry in `raw/`: an uploaded file or a recording. Immutable once written. Avoid: attachment
- **recording** — one audio capture session, identified by `recording_id` in UTC ISO-8601. Avoid: session
- **track** — one of the two captured streams, `mic` or `system`. Avoid: feed
- **timeline** — the two tracks merged and ordered by real time, in `timeline.json`. Avoid: transcript
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

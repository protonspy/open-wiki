---
autonomy: auto
ci: wait
---

# Wiki export — requirements

## Purpose

A wiki that can only be read inside one Windows binary is a wiki with a hostage
in it. Task 4.18 already made that argument for a recording — `timeline.vtt` is
written beside `timeline.json` so the audio can be followed in any player "and
taken away if the user stops using this application" — and the pages deserve the
same. This is the whole project in one file: something to hand to a colleague,
attach to a ticket, or keep as the archive of a project that ended.

**The archive carries the sources, not only the pages.** A wiki whose citations
open nothing is prose somebody has to take on trust, which is the outcome this
product exists to prevent — the same reason `adr:0006-opus-as-the-provenance-format`
keeps the audio rather than only the transcription. So an export that dropped
`raw/` would be an export of the least valuable half.

## R1 · What the archive holds

- **R1.1** The export shall write a zip file holding the project's `wiki/` and
  `raw/` directories.
- **R1.2** The export shall preserve each file's project-relative path, so that
  unpacking the archive yields a directory `ow` opens as a project.
- **R1.3** The export shall exclude `.state/`.
- **R1.4** The export shall exclude the `raw/_inbox/` doorway.
- **R1.5** Where the caller excludes sources, the export shall write `wiki/`
  alone.

## R2 · Saying the size before writing it

- **R2.1** The export shall report the file count and total bytes it wrote.
- **R2.2** Where the caller asks only to survey, the export shall report the same
  counts and write no archive.

## R3 · Destroying nothing

- **R3.1** If the destination is inside the project, then the export shall refuse
  and say why.
- **R3.2** If the destination already exists, then the export shall refuse rather
  than overwrite it.
- **R3.3** The export shall write to a temporary file and rename it, so an
  interrupted run leaves no archive that appears whole.

## R4 · Two doors, one implementation

- **R4.1** The project access module shall hold the one export implementation,
  called by both the CLI and the desktop application.
- **R4.2** The CLI shall expose the export as `ow export`.
- **R4.3** The desktop application shall expose the export through the system
  save dialog.

## Out of scope

- **Importing an archive back.** Unpacking a zip is plan task 6.1 of
  `plans/sources-stored-not-parsed.md`, and it unpacks one as a _source_ — a
  different act, with a different threat model, into a different place.
- **The project's configuration.** `.claude/`, `CLAUDE.md`, `.mcp.json` and
  `ow.json` are how this machine is set up, not what the project knows. A
  `.mcp.json` names other projects on somebody else's disk.
- **Choosing individual pages.** The unit is the project; a subset is a second
  question about what the subset means for the citations that leave it.
- **Encrypting the archive.** `adr:0001-no-backend-byok` keeps this application
  out of the business of holding anybody's secrets, and a password on a zip is a
  key somebody has to keep.

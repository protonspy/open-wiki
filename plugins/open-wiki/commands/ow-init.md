---
description: Scaffold an open-wiki project here — raw/, wiki/, .state/, the skills and a short CLAUDE.md
---

Run `npx -y open-wiki init` in the current project directory, then report what it
created and what it left alone.

`ow init` is idempotent and overwrites nothing already there: the skills are
written only where none exist, and `CLAUDE.md` is generated. If the directory is
occupied by something that is not an open-wiki project it refuses rather than
scaffolding into it.

Afterwards, tell the user the two things that are not obvious from the output:

- The wiki is **theirs to write** — this application calls no LLM and never
  writes a page. Building the wiki from what lands in `raw/` is your job, under
  the convention in `.claude/skills/`.
- `raw/` is immutable once a source is sealed. `raw/_inbox/` is the one doorway:
  material dropped there is ingested and the doorway emptied.

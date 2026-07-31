---
status: accepted
---

# 0004 · Markdown editing with preview, without blocks

## Context

The product reference is Notion: a place where a project's documentation organises itself.
That raises the question of what kind of editor the application offers, and the choice is
structural — a block editor is not a screen, it is a document architecture that
contaminates the storage and everything that reads the files.

`adr:0002-workspace-as-a-local-markdown-folder` says the content is markdown that
Obsidian, VS Code, `grep` and any agent already read. A block editor with real fidelity
wants a model of its own — blocks with ids, ordering, rich types — and markdown stops being
the truth and becomes an export format.

## Decision

The application edits a page's markdown in a text area with preview: write, save, create,
rename and delete pages, fixing the wikilinks that pointed at a renamed page.

No draggable blocks, no slash commands, no embeds, no document model of its own. The `.md`
file is the truth, and stays editable from outside the application while it is open.

## Consequences

The user gets the short path that was missing: fixing a sentence the agent got wrong
without leaving for another program. And the folder stays what the product's entire
argument depends on it being.

The resemblance to Notion is in the organisation and the navigation, not in the writing
experience. Anyone expecting to drag blocks will find the editor poor, and that
expectation is legitimate — the answer is that it would cost the file format, which is the
asset.

Two operational consequences:

- **Concurrent editing exists and is not solved.** The same page can be open in Obsidian,
  in the application, and being written by an agent over MCP. Without versioning there is
  no merge; the honest minimum is to detect that the file changed on disk since it was
  loaded and refuse to overwrite it silently.
- **Renaming is the dangerous operation.** It invalidates wikilinks in pages the user is
  not looking at, which is why fixing those links is part of the same operation instead of
  becoming a later repair in the validator.

If a rich editor comes back on the table, the path that preserves this decision is
rendering markdown with more fidelity — not swapping the storage format for a block model.

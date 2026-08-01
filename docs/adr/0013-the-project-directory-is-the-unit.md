---
status: accepted
---

# 0013 · The project directory is the unit, and MCP becomes cross-project consultation

## Context

`adr:0002-workspace-as-a-local-markdown-folder` made the workspace a container folder with
one directory per project, and `adr:0003-mcp-as-the-only-bridge-to-the-llm` made MCP the
only way an agent reached any of it. Both were written before anyone checked what the
harness does with a folder that sits outside the project it has open.

Checked against Claude Code v2.1.x, it does badly:

- Reaching the folder at all takes `--add-dir` or an `additionalDirectories` setting.
- A `CLAUDE.md` in such a directory **does not load** by default — it needs an environment
  variable, and through the `additionalDirectories` setting it loads no configuration at
  all. The plan generated exactly that file.
- A plugin cannot ship permission rules, so a deny rule protecting the folder has to be
  written into the user's own settings — which, for a folder outside the project, there is
  nothing in the product positioned to do.

Inside the project the harness has the opposite problem, which is to say none. `CLAUDE.md`
and `.claude/rules/*.md` load at session start. `.mcp.json` and `.claude/settings.json` are
picked up from the repository root, so they can be committed and reach everyone who clones.
`Edit(path/**)` deny rules are enforced by the harness rather than requested of the model.
And `Read` and `Grep` already work, over a ripgrep better than any search this product would
ship.

So MCP was carrying reads that the filesystem carries better, and the container folder was
buying a project switcher nobody needed.

## Decision

**A project is a directory.** `ow` invoked inside it opens the application scoped to that
directory, the way `code .` and `idea .` do. There is no workspace container and no
directory of projects owned by the application. A registry of known project paths replaces
it, for the launcher and for name resolution — and it is a cache, never a source of truth:
a moved or deleted directory degrades, it does not corrupt.

**The harness reads the wiki through the filesystem.** No tool, no protocol, no
configuration.

**MCP stops being the bridge and becomes the window into other projects.** It is read-only,
runs over stdio, and is spawned by the harness rather than by the application:

```
ow mcp --project fenix --read-only
```

Four constraints are the decision:

**One process, one project, chosen by the caller's configuration.** The process is launched
for a single project and cannot reach another. This replaces 0003's "chosen by the
application" with confinement by process. The project is still named — `--project fenix` is
a parameter — but it is fixed for the process's whole life and comes from configuration
rather than from a tool call, so an agent cannot pivot to another base mid-session. That is
the whole of the improvement, and it is smaller than "no parameter at all": the entrypoint
must therefore not import the write path, so that `--read-only` describes what the process
can do rather than what it agrees to do.

**Stdio, so there is no port and no token.** The consulted project's application is almost
never running — nobody has `fenix` open while working in `payments-api` — so a server the
application starts is a server that is not there. The harness spawning the process removes
the port, the loopback exposure, the mandatory token and the `headersHelper` that was to
deliver it, in one move.

That win is only real if nothing puts an unauthenticated local listener back. A CLI that
talks to the running application over a socket to pay down cold start is exactly that
listener, so it is a security boundary and not a performance detail: it carries read and
validate, never write, and where the platform offers a named pipe with a restrictive ACL it
uses one.

**The project is named, not pathed.** A committed `.mcp.json` carrying `C:\dev\fenix` breaks
for everyone who clones it. The argument is the registry name, resolved locally, so the
configuration is both committed and portable.

**Read tools return whole pages.** A wiki page is a few kilobytes; the index says what
exists and the agent reads what it picked. No passage extraction and no ranking — and with
them, this record closes the embeddings question the plan had left ajar: there are none, and
no vector store, no reranking and no inverted index.

**The gate's own configuration is outside what the gate lets an agent write.** `.claude/**`,
`.mcp.json` and `CLAUDE.md` sit inside the project directory, and they are executable
configuration: a command to spawn, permission rules, and prompt text loaded into every
collaborator's agent. A write path that reaches them is a write path that edits away its own
restraint — and it does it through a change that reads as documentation in review. Path
confinement is to the project *minus* those, and the check resolves the real path before
comparing, because on Windows a directory junction needs no privilege and is not a symlink.

A project's `.mcp.json` lists *other* projects, never itself. Locally the filesystem reaches
everything, and structural queries go through the CLI.

## Consequences

Of `adr:0003-mcp-as-the-only-bridge-to-the-llm`, three clauses survive intact and are the
substance of that record: **the application does not call an LLM**, **the agent writes the
pages**, and **write-time validation is what replaces the writer**. Four are void: HTTP on
the loopback started and stopped by the application; MCP exposing ingest and write; the
served project being chosen by the application; and the mandatory token. That is why this
record supersedes it rather than narrowing it.

`adr:0002-workspace-as-a-local-markdown-folder` is narrowed, not superseded. It loses the
container — a workspace with one directory per project — and keeps everything that made it:
files rather than a database, the application never touching git, and atomic writes,
snapshots, the operation log and undo as the net.

Because the token is gone, the application holds **exactly one secret again**, the
transcription credential. That is what 0003 claimed and what
`adr:0007-plaintext-credentials-in-the-config` had to walk back to two.

That same record now carries weight it was not written to carry. Its clause "never inside
the workspace" was mild advice when the workspace was a folder the application owned; with
the project directory likely being a git repository, a secret written there is a secret in
history forever. The configuration therefore splits: project settings — the content
language, the conventions — committed and shared with the team, and every secret in the
application's own data directory, keyed by project path.

Three things about that split are decided here rather than left to taste. **It is
unconditional**: a secret is never written into a project directory, whether or not one is a
repository today, because `git init` a week later turns a conditional rule into a leak.
**The committed half carries no local path**, for the same reason `.mcp.json` names a
project rather than a directory — a path is both a portability bug and someone's username.
And **the committed half is a closed schema**: an unknown key is refused rather than
tolerated, so the first feature that wants a per-project token cannot quietly put one there.

`adr:0007-plaintext-credentials-in-the-config` keeps its decision — plaintext, in the
application's data directory, with DPAPI as the named successor — but the file it sketches
is now historical in two places: there is no `mcp` section, because the port and the token
are gone, and `workspace_path` becomes the registry of
`adr:0013-the-project-directory-is-the-unit`. Its two operational rules gain a reader it did
not have: the CLI's stderr is consumed by an agent and travels to a model provider, so the
entrypoints that run under a hook or as `ow mcp` must not read the credential section at
all.

Where the project is in git, the user's git becomes a recovery path the product does not
have to build, and the application still knows nothing about it. Where it is not, `.state/`
is the whole net, so nothing here may be read as delegating recovery to a tool this project
declares out of scope.

`adr:0008-content-language-is-a-setting-english-by-default` loses one clause and keeps its
decision. The content language was "workspace-wide, not per project", on the reasoning that
a workspace holding projects in different languages was an axis nobody had asked for; with
no workspace, the setting is necessarily per project and lives in the committed half of that
project's configuration. What it reaches is unchanged — the transcription hint, and the
convention text the agent reads.

**The gate moved, and it is rebuildable — for the file tools.** With writes gone from MCP,
the agent writes the wiki with its own tools. A `PreToolUse` hook receives the complete
`tool_input` — for `Write` that includes `content`, for `Edit` the strings — and can answer
`permissionDecision: deny` with a reason the agent reads. It can also return `updatedInput`,
which replaces the arguments before the tool runs. So refusal survives intact — the
malformed page never reaches the disk, and 0002's corollary that the defence has to be at
the entrance still holds — and so does everything the store used to do *for* the agent
rather than *to* it: the fields filled in on its behalf are written into the input, not
requested of it in an error message. The whole service survives, not a weakened half of it.

This is the most load-bearing fact in the record and it was got wrong twice while drafting,
in both directions, each time by reasoning about the hook contract instead of reading it.
Nothing about what a harness can or cannot do belongs in these records unless it was
checked against the reference.

What does *not* survive is the completeness of that gate. A hook matches a tool, so a write
that arrives some other way is not gated: `echo > wiki/page.md` through Bash carries a
command string, not page content, and no content-validating hook can fire on it. Denying
`Edit(wiki/**)` does not constrain Bash either — permission rules are per tool. Whatever
9.5 chooses therefore has to answer for the shell, not only for `Edit` and `Write`, and
`PostToolUse` validation plus group 7's checks are what cover what the entrance misses.

Hooks are also Claude Code's mechanism and nobody else's. In a harness without them the
gate is whatever the CLI verb enforces, and where neither is in place group 7 is the net of
record.

The operation log changes meaning with it. It was *operations we performed*; it becomes
*changes we observed*, and undo covers only what the application's editor or a hook saw. A
page edited in Obsidian falls outside it.

## The two questions this record does not answer

**Which write gate, and how does it cover the shell?** A `PreToolUse` hook that validates
`tool_input` and denies is the strongest of the options and the cheapest, but it is Claude
Code only and it does not see a write made through Bash. A CLI verb that is the only way to
write covers any harness that has a shell, but only if something stops the shell writing the
file directly, which a per-tool deny rule does not. They compose — and the composition, not
either half, is what has to be chosen. It cannot ship open.

**What of `raw/` and `.state/` enters git, and who reads it then?** The cost side is easy:
an hour of Opus is ~11 MB, written once and never modified, and committing `text.md`,
`timeline.*` and `manifest.json` keeps a cited passage readable by anyone who clones, while
refusing the media means a provenance link opens nothing for everyone except the person who
recorded it — a real loss against `adr:0006-opus-as-the-provenance-format`.

The side that matters more is disclosure, and it is the reason this question is the more
irreversible of the two. `raw/` holds recorded meeting audio and the verbatim text rendered
from its timeline;
`.state/` holds a snapshot of every page before every write, which means a redaction lives
on there in its unredacted form. Committing either puts that content in every clone, every
fork and every CI checkout, permanently and beyond recall — and it dissolves the promise
`docs/stack.md` makes for whisper.cpp, that the audio never leaves the machine. The default
therefore has to be deny: `ow init` writes the ignore entries and the user opts *in*, rather
than discovering after a push. What is still open is exactly which paths, and whether
committing the media is offered at all.

# Opening an existing project — design

## What changes

Serves R1.1, R1.2, R1.3, R1.4, R2.1, R2.2, R2.3, R2.5, R3.1, R3.2.

Four places, and the idea shared between them is that **a directory that is
already a project is not a directory to be created**.

**`packages/access/src/scaffold.ts`** — `isEmptyOrProject` gains the case its own
error message has always advertised: a directory holding `.git`. It is renamed
`canScaffoldIn`, because "empty or project" stopped describing it (R1.1, R1.2).
Nothing else about `scaffold` moves — re-running it on a project already changes
nothing it holds, which is R1.3 and is behavior the existing tests pin.

**`apps/desktop/src/main/settings.ts`** — a new `adoptProject(directory)` beside
`createProject`, for a project that already exists. It refuses a relative path
the same way, refuses a directory that is not a project, answers with the name a
registry entry already has for that directory when there is one, and otherwise
derives a name from the directory and registers it (R2.2, R2.3, R2.5).

**`packages/access/src/claude-md.ts`** — `writeEntryFiles` stops overwriting
unconditionally (R1.4). Each entry file is classified through `outcomeOf`, the
function `ow update` already uses, which is now exported for it: `missing`,
`unchanged` and `updatable` are written, `edited` and `unknown` are kept and
returned to the caller, and only what was written is recorded as ours. A second
classifier beside that one is the bug `managed.ts` warns about twice — the read
that decides and the write that acts have to resolve the same path the same way.

**`apps/desktop/src/renderer/Launcher.tsx`** — an **Open project…** button beside
**New project**, and a **Choose…** button beside the directory field of the new
project form (R2.1, R3.1, R3.2).

**`apps/desktop/src/renderer/FirstRun.tsx`** — the same offer, on the screen
`Launcher` renders _instead of_ that one whenever the registry is empty (R2.1).
Both call the one `openExisting`, so the three outcomes cannot drift; what
differs is only where a refused directory lands. The launcher opens its create
form on it; the first run is already standing on the step that makes a project,
so it fills that step's own field and says why.

**Where a new project is proposed** (R3.4, R3.5) is three small pieces rather
than one, because the knowledge and the decision live on opposite sides of the
bridge. `defaultProjectsDir()` in `settings.ts` names `<home>/WikiProjects` and
creates nothing; `launcher:default-directory` answers it, because a sandboxed
renderer has no `os` and must not infer a home directory from a user agent; and
`proposedDirectory` / `directoryFor` in `open-existing.ts` do the deciding —
`<root><sep><name>` while the field is untouched, and nothing at all once it is.
The separator is read off the root rather than assumed, since the renderer has
no `path` either and the root already says which platform this is.

**The proposal stops for good the moment the user answers.** Typing, choosing,
or arriving from R2.4 with a directory already picked all set `touched`, and
`touched` is never unset — including when the box is cleared, because a field
somebody emptied is not an invitation to refill it.

The folder is `kebabCase` of the name (R3.4): what somebody types is prose —
`Meu Projeto (2024)` — and what a path wants is one predictable token, the shape
a page's slug and a source's id already take. Accents are folded rather than
dropped, so `Ação` is `acao` and not `a-o`; Portuguese is an ordinary content
language here (`adr:0008`), not an edge case.

**Which screen creates** (R2.7) is `creationScreenFor`: the guided first run
while the registry holds nothing — including before the list has arrived, since
that is a state every new machine passes through and guessing wrong flashes the
compact form at exactly the person the guided run is for — and the compact form
once a project exists. The guided run keeps the transcription credential step,
which the compact form never asked for, and that is the whole reason it is
reached rather than retired. It no longer carries an **Open** door of its own:
with the home shown whatever the list holds, one door on one screen is enough.

**Taking on what is already there** (R2.6) is `discoverProjects` in
`settings.ts`, reached by the launcher's own load through `launcher:discover` —
its own channel, because `launcher:projects` is a read, this one writes to the
registry, and a read that quietly writes is a thing nobody expects twice. It
lists the default location's direct children and hands each to `adoptProject`,
so the dedupe by path (R2.5) and the name derivation (R2.3) are the ones already
tested rather than a second copy that drifts; a child that is not a project
answers `not-a-project` and nothing is written. Every failure is survivable and
silent — no folder yet, a permission error, an entry that vanished between the
listing and the read — because the honest answer in each case is "nothing is
here", and a launcher refusing to render over a missing directory would be
absurd.

What it deliberately does not do is consult that folder for anything else. The
registry is what the list renders, entries outside the default location are
untouched, and nothing is dropped for having left. R2.6 in `requirements.md`
states where crossing that line would begin.

## Boundaries and contracts

Serves R2.1, R2.4, R2.6, R3.1, R3.3, R3.4.

The launcher needs the system's directory chooser, which lives in the main
process, and it needs a directory turned into an open window. Those are two acts
rather than one, because the chooser is also wanted on its own by the form that
already takes a directory.

| Channel                      | Answers                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `launcher:choose-directory`  | the directory chosen, or `null` when cancelled (R3.1, R3.3)                        |
| `launcher:open-directory`    | `{ kind: "opened", name }`, or `{ kind: "not-a-project", directory }` (R2.2, R2.4) |
| `launcher:default-directory` | where a new project is proposed — a path, created by nothing (R3.4)                |
| `launcher:discover`          | the list, with the default location's projects taken on first (R2.6)               |

`showOpenDialog` is injected into `createApi` as `chooseDirectory`, exactly the
way `saveDialog` and `openWindow` already are: `dialog` lives in `index.ts` with
the window, and `ipc.ts` has to stay a module the tests can call without a
display. Absent in a test, and absent in a build with no window to ask from —
the honest answer in both.

**A path crosses the bridge here, and that is a deliberate exception.**
`projectPath` exists so the renderer names a project and never a path
(`apps/desktop/src/main/settings.ts:451`), but that rule is about resolving a
_known_ project, and `createProject` has always taken a directory the renderer
supplies. Opening one is now the same shape: the path the renderer sends came out
of the system chooser one call earlier, and `openDirectory` opens a window only
on a directory that already holds a project. One that does not is refused as
`not-a-project`, so the widest thing this channel does for a renderer is open a
window on a wiki that already exists — it scaffolds nothing and reads no file.

## Data

Serves R2.3, R2.5.

The registry is keyed by name (`packages/access/src/registry.ts:82`) and R2.2
says opening asks for none, so the name is derived: the directory's base name,
with every character the registry rejects (`/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`)
replaced by `-` and leading junk trimmed. A name already taken **by a different
directory** takes a numeric suffix — `fenix-2` — rather than overwriting the
entry, because an entry silently repointed is the one way this feature could lose
somebody's other project.

A directory whose base name survives none of that (a folder named `...`) cannot
be named without asking, and is refused with a message saying to use **New
project** and type one.

R2.5 needs "is this directory already known", which is a path comparison, and
this product is Windows-first: `C:\Projects\Fenix` and `c:\projects\fenix` are
one directory. Both sides are resolved and compared case-insensitively on
`win32` only — lowercasing a path on Linux merges two directories that genuinely
differ.

## Alternatives considered

Serves R1.1, R1.2.

**Dropping the guard entirely** was the obvious alternative and is what several
tools do. It loses the only thing standing between a mistyped path and `raw/`,
`wiki/`, `.state/` plus a generated entry file appearing somewhere the user did
not mean — scattered quietly, since scaffolding prints success. Requiring a git
repository keeps the accident detectable: `git status` shows what arrived, and
`git clean` undoes it. That is also exactly what the existing refusal already
tells the user to do, so this closes the gap between the message and the code
rather than opening a new one.

No ADR. Both decisions are cheap to reverse — the guard is one predicate and the
channels are additive — and `adr:0013-the-project-directory-is-the-unit` already
settled the part that was not: that the project directory is the unit, with no
folder above it that the application owns.

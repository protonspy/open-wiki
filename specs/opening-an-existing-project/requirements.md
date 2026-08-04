---
autonomy: auto
ci: wait
---

# Opening an existing project — requirements

## Purpose

There are two ways into a project and both of them fail for a project that
already exists somewhere the application has never been told about.

`ow init` refuses any directory that is not empty and does not already hold
`raw/` and `wiki/` (`packages/access/src/scaffold.ts:58`), so it cannot adopt a
repository somebody is already working in — while the refusal it prints tells the
user to run it "in an empty directory, **a git repo**, or an existing open-wiki
project" (`packages/cli/src/commands/init.ts:100`). Nothing in the codebase reads
`.git`. The message describes a case that was never built, so the one instruction
the user is given does not work.

The launcher has the same hole from the other side. It lists the registry and can
open what is in it; a project that is not — cloned by a teammate, restored from a
backup, made before this machine had the application — is reachable only by
running `ow` inside its directory, which is what the footer of the launcher
actually tells the user to go and do. And the one directory field in the product
is a text box the user types an absolute path into.

This settles what a project can be made in, how a project that already exists is
opened without knowing its path by heart, and where the directory comes from.

## R1 · What a project can be made in

- **R1.1** The scaffolder shall accept a directory that is empty, that is already a
  project, or that is a git repository.
- **R1.2** If a directory is none of those, then the scaffolder shall refuse it and
  name what it would have to be instead.
- **R1.3** Where a directory is already a project, the scaffolder shall change
  nothing that project already holds.
- **R1.4** (ADDED) If an entry file is not one this product wrote, then the scaffolder shall keep it
  and report that it kept it.

R1.4 was added while building R1.1, and it is the hazard R1.1 creates rather
than a wish. `writeEntryFiles` overwrote the generated entry file
unconditionally, which was safe only for as long as a populated directory was
refused. Running inside a repository somebody already works in means running
where a hand-written `CLAUDE.md` very often already is — the users of this
product are, definitionally, people who have one — and destroying it while
printing success is not a trade R1.1 is worth.

## R2 · Opening a project the application does not know

- **R2.1** (MODIFIED) The launcher shall offer opening a project by choosing its directory,
  alongside creating a new one, above its list of projects and whatever that list
  holds — including nothing at all.
- **R2.2** When a chosen directory is already a project, the application shall open
  it, without asking for a name, a language or a harness.
- **R2.3** When a project is opened this way, the application shall record it in the
  registry, so it is listed the next time.
- **R2.4** If a chosen directory is not a project, then the application shall say so
  and offer to make one there, carrying the chosen directory into that form.
- **R2.5** If a chosen directory is already in the registry, then the application shall open
  it rather than adding a second entry for it.
- **R2.6** (ADDED) When the launcher opens, the application shall register every project sitting
  directly inside the default location that it does not already know.
- **R2.7** (ADDED) While the registry holds nothing, the launcher shall still show its list and
  both doors, and shall reach the guided first run from the one that creates.
- **R2.8** (ADDED) Where a known project has moved, the launcher shall offer choosing where
  it went, and shall point the registry at the directory chosen.
- **R2.9** (ADDED) If the chosen directory cannot be taken on, then the launcher shall offer
  naming it, rather than leave the project listed nowhere.

R2.8 finishes what R2.1's _shown, not hidden_ started. A project marked **not
where it was** offered only **Forget**, so the one thing anybody wants to do with
a moved project — say where it went — was the one thing the screen could not do,
and the entry was a dead end kept on purpose. The stale entry is dropped before
the chosen directory is taken on, because R2.5's naming derives a _free_ name and
the entry that moved is holding the one the project is called; a pointer that
already resolves to nothing is not a thing to protect.

R2.9 is the price of that order, and a code review found it. Once the entry is
dropped there is no putting it back — the old directory is gone, which is the
whole reason anybody pressed the button — so a refusal that only printed itself
would leave the project listed nowhere and reachable by nothing, which is a
worse dead end than the one R2.8 removed. `adoptProject` refuses a directory it
cannot derive a name from, so this is reachable and not hypothetical. Both
refusals — not a project, and could not be named — carry the directory to the
same place: the create form, where naming it registers it again. Creating over a
directory that is already a project changes nothing it holds (R1.3), so that
step is a re-registration rather than a scaffold.

R2.6 narrows R3.4's "nothing enumerates that location", which was written one
change earlier and is no longer true. What it does **not** narrow is
`adr:0013-the-project-directory-is-the-unit`, and the boundary is worth stating
because the next step past it is the container that ADR removed:

- **The registry is still the record.** R2.6 writes into it and reads nothing
  from the folder afterwards. A project moved out of the default location keeps
  working, keeps its entry, and is not forgotten for having left.
- **Nothing has to live there.** A project opened by R2.1 from anywhere else is
  listed on identical terms, and R3.5 exists so that saying where overrides the
  default.
- **The folder is a place to look, not a source of truth.** It is read to fill
  the registry, once, when the launcher opens — never consulted to answer what a
  project is or where one lives.

Cross that boundary — the list rendered from the directory, a project defined by
sitting in it, entries dropped for leaving it — and it is `adr:0002` again, which
would need an ADR that says so.

R2.1 has now been modified twice, and the second time undoes the workaround the
first one was. `Launcher` returned the four-step first run as soon as the
registry was empty, so the doors — sitting on the screen below that branch —
were invisible to the one person who needed them: an empty registry is a new
machine, a reinstall, or anyone who cloned a project a colleague made, not
somebody with no project. The first fix put a second Open door **inside** the
first run. R2.7 removes the reason for it: the list is shown whatever it holds,
the doors sit above it from the first second, and the first run becomes what
**New project** opens rather than a screen that replaces the launcher.

So the first run goes back to being only what it is called — the steps that
create a project. It keeps the credential step, which is why it is still reached
at all: the compact form does not ask for one, and a first project created
without ever being offered transcription is a worse trade than one extra screen.

## R3 · Naming the directory

- **R3.1** The application shall let the user choose a directory with the system's
  directory chooser wherever it asks for one.
- **R3.2** The application shall keep accepting a directory typed by hand.
- **R3.3** When the user cancels the chooser, the application shall leave the
  directory it already had.
- **R3.4** (MODIFIED) The application shall propose, for a new project, a directory inside a
  default location under the user's home directory, named for that project in
  kebab-case.
- **R3.5** (ADDED) When the user has named a directory themselves, the application shall keep
  what they named and stop proposing one.
- **R3.6** (ADDED) When a project is created from a typed name, the application shall use that
  name in kebab-case as the project's name, and shall show which name it will use.

R3.6 closes the half of R3.4 that was left open and immediately bit: the folder
became `test-123` while the name stayed `test 123`, which the registry refuses —
letters, digits, dot, dash and underscore. So the form proposed a path and then
declined to create it, which is a form saying one thing and doing another.

The name is an **identifier**, not a label: it keys the registry, it is what
`.mcp.json` names, and it is what every `ow` resolving a project by name looks
up. There is nowhere for prose to live alongside it, so the name takes the shape
the folder takes — and R3.6's second half is what keeps that from being a
surprise, by saying which name will be used while it can still be changed.

R3.4 is a **suggestion, not a container**, and the distinction is the whole
reason it can exist at all.
`adr:0013-the-project-directory-is-the-unit` decided that "there is no workspace
container and no directory of projects owned by the application", reversing
`adr:0002` — and typing an absolute path for every project is the friction that
decision left behind. A prefilled default removes the friction without bringing
the container back, provided it stays a _default_: nothing about a project
changes because it sits there, and a project anywhere else is reached by R2.1 on
identical terms. R2.1's **Open project…** is what makes this safe now and did
not exist when `adr:0013` was written.

("Nothing enumerates that location" stood here until R2.6, which reads it to
fill the registry. The rest of the paragraph is unchanged and is what still
keeps this a default rather than a container.)

## Out of scope

- Managing the default location: creating it before a project needs it, moving
  projects into it, rendering the launcher's list from it, or dropping an entry
  because its project left. Those are the container `adr:0013` removed; R2.6
  reads the directory to fill the registry and stops there.
- Looking below the default location's own children. A project nested deeper is
  found by **Open project…**, and walking a home directory to depth is how a
  launcher becomes slow on the one machine nobody can reproduce.
- Making the default location configurable. It is derived from the user's home
  directory; somewhere else is what **Choose…** and **Open project…** are for.
- Opening a project into the window that asked. Choosing a project opens a window
  on it, which is what `launcher:open` already does.
- Watching the registry for projects that appeared on disk on their own. A project
  is known because somebody opened it, not because something went looking.
- Adopting a directory that is neither empty, nor a project, nor a git repository.
  R1.2 refuses it, and the escape hatch is `git init` — a directory the user has
  not put under version control is the case where an accidental scaffold is
  hardest to notice and hardest to undo.

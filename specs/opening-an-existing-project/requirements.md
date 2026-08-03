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
  alongside creating a new one, on every screen it shows when no project is open —
  including the first run, where nothing is in the registry yet.
- **R2.2** When a chosen directory is already a project, the application shall open
  it, without asking for a name, a language or a harness.
- **R2.3** When a project is opened this way, the application shall record it in the
  registry, so it is listed the next time.
- **R2.4** If a chosen directory is not a project, then the application shall say so
  and offer to make one there, carrying the chosen directory into that form.
- **R2.5** If a chosen directory is already in the registry, then the application shall open
  it rather than adding a second entry for it.

R2.1 was modified after the first build of it shipped with exactly this hole.
`Launcher` shows the four-step first run as soon as the registry is empty, and
the button was put beside **New project** on the screen below that branch — so
the only person who never saw it was the one with no projects on this machine.
An empty registry is not "somebody with no project": it is a new machine, a
reinstall, or anyone who cloned a project a colleague made.

## R3 · Naming the directory

- **R3.1** The application shall let the user choose a directory with the system's
  directory chooser wherever it asks for one.
- **R3.2** The application shall keep accepting a directory typed by hand.
- **R3.3** When the user cancels the chooser, the application shall leave the
  directory it already had.

## Out of scope

- Opening a project into the window that asked. Choosing a project opens a window
  on it, which is what `launcher:open` already does.
- Watching the registry for projects that appeared on disk on their own. A project
  is known because somebody opened it, not because something went looking.
- Adopting a directory that is neither empty, nor a project, nor a git repository.
  R1.2 refuses it, and the escape hatch is `git init` — a directory the user has
  not put under version control is the case where an accidental scaffold is
  hardest to notice and hardest to undo.

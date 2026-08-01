# open-wiki

A project's documentation, as a wiki the AI agent already has open.

Today a project's documentation is scattered: an architecture PDF, a
requirements `.docx`, decisions that exist only in a recorded meeting. None of
it answers _what is the current state of project X and how did we get here_, and
none of it is read by an agent without somebody pasting it into a prompt by
hand.

open-wiki does three things and refuses the rest. It **takes in sources** — a
file or a recording — and reduces them to text with provenance anchors. It
**stores the wiki** as validated markdown. And it **lives inside the project
directory**, which is where the harness is already working, so reading it needs
no protocol at all.

**The application calls no LLM.** Reading the source text, applying the
convention and writing the pages is the agent's job. The application does not
write content; it validates what comes in and records everything that changes.

Windows 10/11. Apache-2.0.

## Install

```powershell
winget install protonspy.open-wiki
```

or `scoop install open-wiki`, or the installer from
[Releases](https://github.com/protonspy/open-wiki/releases). Every release
publishes a `SHA256SUMS.txt` beside the installer — check it.

For the CLI alone, with nothing installed:

```
npx open-wiki init
```

### The SmartScreen warning

The installer is **not code-signed**, so Windows SmartScreen will say
"Windows protected your PC" and name an unknown publisher. That is accurate:
there is no certificate behind this build. Verify the SHA256 against
`SHA256SUMS.txt` on the release page before choosing **More info → Run anyway**,
and if the hash does not match, do not run it. A certificate costs money and
proves the publisher is _someone_, not that the software is safe; the hash is
the thing that actually tells you the bytes are the ones that were built.

## Using it

`ow` in a project directory opens the application scoped to it, the way `code .`
does. `ow init` scaffolds `raw/`, `wiki/`, `.state/`, the convention as skills,
and a short `CLAUDE.md`. Then you talk to your agent in that same directory.

## Recording a meeting

This application records audio, from your microphone **and** from what your
computer is playing — which in a call is everybody else.

**Telling the other people in the call that you are recording is your
responsibility, and in many places it is the law.** Recording a conversation
without consent is a criminal offence in a number of jurisdictions and grounds
for a civil claim in more; where one-party consent is enough it is still, at
minimum, a thing people are entitled to know. This software will not ask them
for you, and it has no way to tell whether you did.

A recording indicator is in the window whenever capture is running, and it is
deliberately hard to miss — the failure it exists to prevent is somebody
forgetting it is on and ending up with a recording of a conversation the other
people in it believe ended.

## Committing a wiki

The project directory is usually a git repository, and that is your business —
this application neither reads nor writes one. But it is worth saying plainly
what committing a wiki does:

**Everything in `wiki/` goes to everyone with repository access.** So does
everything in `raw/` except what the generated `.gitignore` excludes — recorded
audio and `.state/` are out by default, and committing them is opting in. That
default is not tidiness: `.state/` holds every page as it was before each write,
which is where a redaction survives the redaction.

A meeting transcript is a verbatim record of what people said, including the
part they would not have written down. Read a source before you commit it.

**The transcription credential is never in the project directory.** It lives in
the application's own data directory, keyed by project path, unconditionally —
because `git init` a week later turns a conditional rule into a leak.

## What it does not do

Extraction or page-writing by the application; chat inside the application; a
hosted service, accounts or telemetry; a block editor; real-time collaboration;
embeddings or a vector store; versioning (your git is welcome to it); macOS and
Linux; real-time transcription or a bot that joins the meeting.

The reasoning for each is in [`docs/adr/`](docs/adr/), and the shape of the
whole thing is in [`plans/open-wiki.md`](plans/open-wiki.md).

## Building it

See [`.claude/rules/project.md`](.claude/rules/project.md) for the commands.
It is a pnpm workspace plus one Rust crate — the audio recorder, which is the
only thing here not written in TypeScript
(`adr:0014-typescript-everywhere-except-audio-capture`).

## Licence

Apache-2.0. See [LICENSE](LICENSE).

# open-wiki

A project's documentation, as a wiki the AI agent already has open.

Today a project's documentation is scattered: an architecture PDF, a
requirements `.docx`, decisions that exist only in a recorded meeting. None of
it answers _what is the current state of project X and how did we get here_, and
none of it is read by an agent without somebody pasting it into a prompt by
hand.

open-wiki does three things and refuses the rest. It **takes in sources** — a
file of any kind, or a meeting it records — and keeps the original. It **stores
the wiki** as validated markdown. And it **lives inside the project directory**,
which is where the harness is already working, so reading it needs no protocol
at all.

**The application does not write your pages.** An agent does: yours, in the
harness you already talk to, or the one built into the Chat pane. Either way the
write goes through the same gate — the schema, the wikilinks, the provenance —
and is refused with a reason when it does not hold up. What the application
itself does is scaffold, validate, record every change and show you the result.

**It does not read your sources either.** The bytes are preserved exactly as
they arrived and the agent opens them — a PDF as a document, an image as an
image — which keeps the layout, the tables and the figures that a text extractor
drops (`adr:0021-sources-are-stored-not-parsed`). Markdown and plain text are
copied into `text.md` on the way in, because copying text that is already text
is not extraction.

**Your keys, on your machine.** There is no backend and no account
(`adr:0001-no-backend-byok`). One Groq key does two jobs — transcribing
recordings and running the embedded agent — or you point transcription at a
local whisper.cpp and give it no key at all.

Windows 10/11. Apache-2.0.

## Install

The installer from [Releases](https://github.com/protonspy/open-wiki/releases).
Every release publishes a `SHA256SUMS.txt` beside it — check it.

Or through Scoop, from the manifest that release attaches:

```powershell
scoop install https://github.com/protonspy/open-wiki/releases/latest/download/open-wiki.json
```

A winget manifest is generated and attached to every release as well
(`manifests.zip`), quoting the same hash. **It is not in the winget community
repository yet** — submitting it is a pull request to `microsoft/winget-pkgs`
that nothing here opens for you, so `winget install protonspy.open-wiki` does
not work today.

For the CLI alone, with nothing installed:

```
npx @protonspy/open-wiki init
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

The window has four panes: the **wiki** you are reading, the **sources** it
rests on, the **checks** that say what is wrong with it, and **chat** — the
embedded agent, for when there is no harness open. It reads the project freely
and pauses for your approval on every write
(`adr:0019-an-embedded-agent-that-reads-freely-and-writes-through-the-gate`).

Everything the window does, the CLI does too: `ow check`, `ow graph`,
`ow search`, `ow write`. That is deliberate — an agent with a terminal needs no
window, and CI needs no agent.

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

A recording's timeline is a verbatim record of what people said, including the
part they would not have written down. Read a source before you commit it.

**Any file can be a source now**, and `raw/` holds the bytes rather than a
summary of them. A dropped video is a video in your repository. The application
says so at the moment of the drop rather than letting you find out in
`git status`, but the decision is yours and there is a ceiling rather than a
policy.

**The transcription credential is never in the project directory.** It lives in
the application's own data directory, keyed by project path, unconditionally —
because `git init` a week later turns a conditional rule into a leak.

## What it does not do

Extraction, summarisation or page-writing **by the application** — those are the
agent's, and the gate is what the application contributes; a hosted service,
accounts or telemetry; a block editor; real-time collaboration; embeddings or a
vector store; versioning (your git is welcome to it); macOS and Linux; real-time
transcription, ML diarisation, or a bot that joins the meeting.

Two of these were once broader and are worth naming, because a README that
quietly drops a promise is worse than one that never made it. **Chat inside the
application** was out of scope and is now in it, for the user who downloaded the
installer and has no harness — `adr:0019` says what changed and what it cost.
And the application once **called no LLM at all**; transcription and the
embedded agent both call one now, with your key, from your machine.

The reasoning for each is in [`docs/adr/`](docs/adr/), and the shape of the
whole thing is in [`plans/open-wiki.md`](plans/open-wiki.md) — which is the
record of the MVP as it was decided, not a description of today.

## Building it

See [`.claude/rules/project.md`](.claude/rules/project.md) for the commands.
It is a pnpm workspace plus one Rust crate — the audio recorder, which is the
only thing here not written in TypeScript
(`adr:0014-typescript-everywhere-except-audio-capture`).

## Licence

Apache-2.0. See [LICENSE](LICENSE).

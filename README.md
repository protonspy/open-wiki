# open-wiki

A project's documentation, as a wiki your AI agent already has open.

Today it is scattered: an architecture PDF, a requirements `.docx`, decisions
that exist only in a recorded meeting. None of it answers _what is the state of
this project and how did we get here_, and none of it reaches an agent without
somebody pasting it into a prompt by hand.

open-wiki puts all of it in the project's own directory — sources on one side,
a wiki on the other — so the agent you already talk to can read it, write to it,
and cite where every claim came from.

Windows 10/11. Apache-2.0.

## What it does

**Takes in sources.** Drop in any file, or record a meeting and have it
transcribed. The original is kept exactly as it arrived, because it is the
evidence: a citation opens the PDF at its page, or the recording at the second
the sentence was said.

**Keeps the wiki honest.** Pages are markdown with a small schema. Every write —
yours, your agent's, anyone's — is checked before it lands: the frontmatter, the
`[[wikilinks]]`, and whether each citation points at a source that exists. What
fails is refused with a reason. What lands is recorded, and can be undone.

**Stays out of the way.** No backend, no account, no telemetry. The wiki is
files in your directory; your git is welcome to them.

**The pages are an agent's to write, not the application's.** Use the harness
you already have open in that directory, or the Chat pane in the window, which
runs an agent against the project and pauses for your approval on every write.

## Install

Download the installer from
[Releases](https://github.com/protonspy/open-wiki/releases). Every release
publishes a `SHA256SUMS.txt` beside it — check it.

Or through Scoop, from the manifest each release attaches:

```powershell
scoop install https://github.com/protonspy/open-wiki/releases/latest/download/open-wiki.json
```

For the CLI alone, with nothing installed:

```powershell
npx @protonspy/open-wiki init
```

A winget manifest is attached to every release too (`manifests.zip`), quoting
the same hash — but it is **not in the winget community repository**, so
`winget install protonspy.open-wiki` does not work yet.

### The SmartScreen warning

The installer is **not code-signed**, so Windows SmartScreen will say "Windows
protected your PC" and name an unknown publisher. That is accurate: there is no
certificate behind this build.

Verify the SHA256 against `SHA256SUMS.txt` on the release page before choosing
**More info → Run anyway**, and if the hash does not match, do not run it. A
certificate costs money and proves the publisher is _someone_ — it does not
prove the software is safe. The hash is the thing that actually tells you the
bytes are the ones that were built.

## Using it

`ow` inside a project directory opens the window scoped to it, the way `code .`
does. In a directory that is not a project yet:

```powershell
ow init
```

That scaffolds `raw/` for sources, `wiki/` for pages, and a short `CLAUDE.md`
plus the writing convention as skills, so an agent opening the directory knows
what a page here looks like.

Then: **drop your files on the window**, or press record before a call. Ask your
agent, in that same directory, to read what is in `raw/` and write the wiki.
Watch the pages appear.

### The window

Four panes.

| Pane        | What it is for                                                               |
| ----------- | ---------------------------------------------------------------------------- |
| **Wiki**    | Read the pages. Follow a `[[link]]`, or an amber citation to open its source |
| **Sources** | Everything in `raw/`: what state it is in, and which pages cite it           |
| **Checks**  | What is wrong with the wiki, and what to do about each one                   |
| **Chat**    | The built-in agent, for when you have no harness open                        |

### From the terminal

Everything the window does, the CLI does — an agent with a terminal needs no
window, and CI needs no agent.

```powershell
ow check      # broken links, orphan pages, citations that resolve to nothing
ow graph      # the wiki as structure, as JSON
ow search     # lexical search across the pages
ow consult add <project>   # let this project read another one, read-only
```

## Recording a meeting

This records audio from your microphone **and** from what your computer is
playing — which in a call is everybody else.

**Telling the other people in the call that you are recording is your
responsibility, and in many places it is the law.** Recording a conversation
without consent is a criminal offence in a number of jurisdictions and grounds
for a civil claim in more; where one-party consent is enough it is still, at
minimum, something people are entitled to know. This software will not ask them
for you, and it cannot tell whether you did.

A recording indicator sits in the window the whole time capture is running, and
it is deliberately hard to miss — the failure it exists to prevent is somebody
forgetting it is on and ending up with a recording of a conversation the other
people in it believe had ended.

## Committing a wiki

The project directory is usually a git repository, and that is your business —
this application neither reads nor writes one. But it is worth saying plainly
what committing a wiki does.

**Everything in `wiki/` goes to everyone with repository access.** So does
everything in `raw/`, except what the generated `.gitignore` excludes: recorded
audio and `.state/` are out by default, and committing them is opting in. That
default is not tidiness — `.state/` holds every page as it was before each
write, which is where a redaction survives the redaction.

A recording's timeline is a verbatim record of what people said, including the
parts they would not have written down. **Read a source before you commit it.**

Any file can be a source, and `raw/` holds the bytes rather than a summary of
them, so a dropped video is a video in your repository. The window says so at
the moment of the drop rather than letting you find it in `git status`.

**Your transcription key never goes in the project directory.** It lives in the
application's own data directory, keyed by project path, unconditionally —
because `git init` a week later would turn a conditional rule into a leak.

## What it does not do

It does not summarise, extract or write pages for you — that is the agent's
work, and what this application contributes is the gate that checks it. There
is no hosted service, no accounts, no telemetry, no block editor, no real-time
collaboration, no embeddings or vector store, and no versioning of its own. It
does not run on macOS or Linux, and it does not transcribe in real time or send
a bot to your meeting.

## Building it

A pnpm workspace plus one Rust crate, the audio recorder.

```powershell
pnpm install
pnpm test
pnpm lint
```

The full set of commands is in
[`.claude/rules/project.md`](.claude/rules/project.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE).

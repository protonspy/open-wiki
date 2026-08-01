# Stack

Every adopted technology, with one line on why it earned its place. What is not here is an
open decision, never something adopted silently.

Nothing on this list is installed yet — the monorepo is task 1.1 of
`plans/open-wiki.md`. The list exists before the dependencies because it is what makes
adding each one a deliberate act.

## Capture

- **Rust** — the recorder has to speak COM to WASAPI and hold a clock of its own for an hour with no GC pause. Standalone binary, no runtime to install. It is the **only** thing in this product written in Rust — see `adr:0014-typescript-everywhere-except-audio-capture`.
- **`wasapi` crate** — direct access to WASAPI, including loopback of the render device, which is exactly what ffmpeg on Windows does not have. See `adr:0005-wasapi-capture-in-a-minimal-sidecar`.

## Pipeline

- **TypeScript** — everything that is not audio capture: the pipeline, the UI, the CLI and the MCP process. One language means one core imported by all three rather than a contract between two languages — see `adr:0014-typescript-everywhere-except-audio-capture`.
- **Node.js** — Electron's runtime, already present; and what the CLI runs on when it is invoked with no application installed.
- **ffmpeg (vendored)** — downmix, VAD and Opus encode in a single tool. Bundled with hash verification, never downloaded at run time.
- **Opus 24 kbps** — the only encoding that puts an hour of meeting under the 25 MB upload limit. A requirement, not an optimisation. See `adr:0006-opus-as-the-provenance-format`.
- **Groq `whisper-large-v3-turbo`** — the default STT provider: ~US$ 0.04 per hour and ~228x real time, multilingual, which is what lets the content language be a setting rather than a fixed choice — see `adr:0008-content-language-is-a-setting-english-by-default`. It is the **only** credential the application holds, now that the MCP token went away with the port — see `adr:0013-the-project-directory-is-the-unit`.
- **whisper.cpp** — optional local provider, for anyone who requires that the audio never leave the machine. It is what holds up the privacy argument without rewriting the pipeline.

## Application

- **Electron** — desktop UI in the same TypeScript as the pipeline, with filesystem and child-process access and no native bridge. Opened scoped to one project directory, by `ow`.
- **React** — the UI has real state (a recording in progress, sources crossing the flow, pages changing while the agent writes); the ecosystem around Electron is larger than any alternative's, and that matters more than preference.
- **Vite** — renderer build and reload, fast enough that there is no temptation to skip the UI while iterating.
- **markdown-it** — renders the wiki pages in the embedded browser; its plugin model is what allows teaching it `[[wikilink]]` and `rec://` without rewriting the parser.
- **pnpm workspaces** — a monorepo of several TS packages with unhoisted dependencies, which is what stops a package from importing what it never declared.
- **esbuild** — bundles the CLI to a single file. Not a preference: an unbundled CLI pays module resolution on every invocation, and a hook fires it on every page write — see `adr:0014-typescript-everywhere-except-audio-capture`.

The application neither reads nor writes a git repository —
`adr:0002-workspace-as-a-local-markdown-folder`. The project directory usually *is* one,
and that is the user's business, not a technology this product adopted.

## Text extraction from sources

Each source adapter has a single responsibility — becoming `text.md` with provenance
anchors, and the path stops writing there — see
`adr:0013-the-project-directory-is-the-unit`.

- **pdf-parse** — text and page boundaries of a PDF; it is the page number that makes the citation possible, and without it the source is of no use.
- **mammoth** — DOCX to markdown preserving the heading hierarchy, which is the anchor equivalent to a PDF's page.

## MCP server

- **MCP TypeScript SDK** — how a project with no wiki of its own consults one that has: read-only, over stdio, spawned by the harness. It is not how the local wiki is reached, because the harness already has the directory open. See `adr:0013-the-project-directory-is-the-unit`.

## Testing and verification

- **Vitest** — runner for the TS packages: it runs a single file fast enough for the per-task loop, which is what scoped verification demands.
- **`@vitest/coverage-v8`** — Vitest's V8 coverage provider, and the source of the `coverage-summary.json` that CI reads to enforce the 76% floor per package. V8 rather than Istanbul because it needs no instrumentation step.
- **`cargo test`** — what already ships with Rust; adding a second runner buys nothing. It covers the recorder and nothing else.
- **GitHub Actions** — CI on `windows-latest`, which is the only platform the product supports. One job per workspace package, so a package below the coverage floor fails on its own instead of hiding behind a well-tested neighbour. It also builds and publishes the release — see `adr:0009-distribution-through-github-releases`.

## Distribution

- **electron-builder** — packs the Electron application, ffmpeg and `recorder.exe` into one NSIS installer, and is what reads `CSC_LINK` to sign it the day there is a certificate. See `adr:0009-distribution-through-github-releases`.
- **GitHub Releases** — where the installer is downloaded from. No host of ours to run, and a stable URL with a published hash is exactly what a winget or Scoop manifest needs.
- **npm** — a second channel, carrying the CLI alone, so `npx open-wiki init` scaffolds a project with nothing installed. It is what makes the convention reachable without the desktop application, and it is the reason two artifacts now ship from one tag — see `adr:0014-typescript-everywhere-except-audio-capture`.

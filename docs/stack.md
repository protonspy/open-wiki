# Stack

Every adopted technology, with one line on why it earned its place. What is not here is an
open decision, never something adopted silently — and because the dependency manifests are
structured data, the gap is checkable: a dependency in a `package.json` or `Cargo.toml` that is
absent from this file is a finding.

## Capture

- **Rust** — the recorder has to speak COM to WASAPI and hold a clock of its own for an hour with no GC pause. Standalone binary, no runtime to install. It is the **only** thing in this product written in Rust — see `adr:0014-typescript-everywhere-except-audio-capture`.
- **`wasapi` crate** — direct access to WASAPI, including loopback of the render device, which is exactly what ffmpeg on Windows does not have. See `adr:0005-wasapi-capture-in-a-minimal-sidecar`. It also keeps the `unsafe` on its side of the boundary: the recorder drives a safe wrapper rather than hand-written COM FFI, so the workspace's `unsafe_code = "deny"` still stands and group 4 never had to lift it. A Windows-only target dependency, so nothing else builds it.
- **`serde` / `serde_json`** — the JSON-RPC contract of `adr:0005` and the recording's `manifest.json`. The six methods are an enum with `#[serde(tag = "method")]`, so a seventh cannot be answered by accident: an unknown method fails to parse rather than falling through to a catch-all.
- **`hound`** — writes the intermediate WAV. A WAV header is simple enough to hand-roll and easy enough to get subtly wrong — a header claiming zero frames is what an unfinished file looks like, and every reader believes it. The file is read once by ffmpeg and deleted (`adr:0006-opus-as-the-provenance-format`).

## Pipeline

- **TypeScript** — everything that is not audio capture: the pipeline, the UI, the CLI and the MCP process. One language means one core imported by all three rather than a contract between two languages — see `adr:0014-typescript-everywhere-except-audio-capture`.
- **Node.js** — Electron's runtime, already present; and what the CLI runs on when it is invoked with no application installed.
- **ffmpeg (vendored)** — downmix, VAD and Opus encode in a single tool. Bundled with hash verification, never downloaded at run time.
- **Opus 24 kbps** — the only encoding that puts an hour of meeting under the 25 MB upload limit. A requirement, not an optimisation. See `adr:0006-opus-as-the-provenance-format`.
- **Groq `whisper-large-v3-turbo`** — the default STT provider: ~US$ 0.04 per hour and ~228x real time, multilingual, which is what lets the content language be a setting rather than a fixed choice — see `adr:0008-content-language-is-a-setting-english-by-default`. It is the **only** credential the application holds, now that the MCP token went away with the port — see `adr:0013-the-project-directory-is-the-unit` — and it does double duty: the embedded agent reuses it as its model key (`adr:0019`).
- **whisper.cpp** — optional local provider, for anyone who requires that the audio never leave the machine. It is what holds up the privacy argument without rewriting the pipeline.

## Application

- **Electron** — desktop UI in the same TypeScript as the pipeline, with filesystem and child-process access and no native bridge. Opened scoped to one project directory, by `ow`.
- **React** — the UI has real state (a recording in progress, sources crossing the flow, pages changing while the agent writes); the ecosystem around Electron is larger than any alternative's, and that matters more than preference.
- **Vite** — renderer build and reload, fast enough that there is no temptation to skip the UI while iterating.
- **markdown-it** — renders the wiki pages in the embedded browser. The plugin model is not a convenience: `[[wikilink]]` and `rec://` are taught to it as an inline rule and a core rule, which is the only way to add them without editing serialised HTML — and a `String.replace` over rendered HTML does not know what an attribute is, so a citation inside a link title breaks out of `title="…"`, and a code span quoting the syntax becomes a live link. It also earns its place on security grounds: `html: false` plus its own `validateLink` is what stops a page from carrying a `<script>`, or a `javascript:`/`data:`/`file:` href, into a renderer that has the project open.
- **@vitejs/plugin-react** — the React transform for the renderer's Vite build. Vite does not transform JSX on its own and nothing else in the toolchain would.
- **lucide-react** — the icon set `design/desktop-draft.html` is drawn with, one import per symbol and tree-shaken to what the window actually renders. The alternative is re-drawing an icon set by hand to avoid a dependency, which is a worse trade at any size. No icon font and no sprite sheet: an Electron renderer under a strict CSP loads nothing from a network, and inline SVG is the form that needs no exception.
- **clsx** — composes the class names the primitives put on an element. Small enough to hand-roll and hand-rolled badly often enough — the version everyone writes drops `0`, keeps `false`, or emits a leading space — to be worth not doing. **shadcn/ui is deliberately absent from this list**: what the draft means by "token names match shadcn/ui" is that the CSS variables are named `--background`, `--primary`, `--muted-foreground`, so the palette copies straight into `globals.css`. shadcn is copied-in source, not a package, and installing a runtime for it would be adopting a dependency to get a naming convention.
- **pnpm workspaces** — a monorepo of several TS packages with unhoisted dependencies, which is what stops a package from importing what it never declared.
- **esbuild** — bundles the CLI to a single file. Not a preference: an unbundled CLI pays module resolution on every invocation, and a hook fires it on every page write — see `adr:0014-typescript-everywhere-except-audio-capture`.

The application neither reads nor writes a git repository —
`adr:0002-workspace-as-a-local-markdown-folder`. The project directory usually *is* one,
and that is the user's business, not a technology this product adopted.

## Embedded agent

The desktop application runs an agent behind a chat pane, for the user who has no harness of
their own — see `adr:0019-an-embedded-agent-that-reads-freely-and-writes-through-the-gate`. It
reads the project the way a harness does and writes `wiki/` only through the validated store.

- **deepagents** — the filesystem middleware and tools (`ls`, `read_file`, `write_file`,
  `edit_file`, `glob`, `grep`) the agent uses, re-pointed at a gate-backed `BackendProtocolV2`
  so every write routes through `gateWrite` + `writePage` with origin `agent`; `execute` is
  filtered because the backend is not a sandbox. Pinned at `1.12.1`, the version `adr:0019`
  named — the `BackendProtocolV2` surface is internal and unversioned, so a bump is deliberate.
- **langchain** — `createAgent`, the runtime primitive the agent is built on (assembled
  explicitly, not via `createDeepAgent`, so the subagent `task` middleware is simply not in the
  stack — `createDeepAgent` makes it required and its profile switch does not reach a `ChatGroq`
  instance), and `humanInTheLoopMiddleware`, which wires `interruptOn` to `write_file`,
  `edit_file`, `rename_page` and `delete_page`.
- **@langchain/langgraph** — the graph the agent is: a `MemorySaver` checkpointer keyed by
  `thread_id`, `streamEvents(v3)` for token and tool-call streaming, and `Command({ resume })`
  to carry an approval back into a paused run.
- **@langchain/groq** — `ChatGroq`, the model the agent runs, built with the same Groq key the
  recorder uses (read from `readSecrets`, injected as `apiKey` — never into `process.env`) and
  the user-selected model (default `openai/gpt-oss-120b`).
- **@langchain/core** — the message, tool and language-model primitives the rest build on;
  stated explicitly because the agent imports its types directly.

## Libraries

- **yaml** — parses and writes the frontmatter the store validates. The page schema is the contract; a real YAML parser is what keeps it from drifting into "the subset we happened to hand-roll."

- **yazl** — writes the export archive (`specs/wiki-export`). The same argument **hound** makes below about a WAV header applies harder to a ZIP central directory: it is simple enough to hand-roll and easy enough to get subtly wrong, and ZIP64 — which `raw/` reaches, because that is where the bytes are — is the part that is plausible and wrong. A malformed archive is discovered by the person we handed it to, not by us. It streams rather than building in memory, and it brings one transitive dependency (`buffer-crc32`) where `archiver` brings six, into a package that otherwise runs on two. Its sibling **yauzl** is the reader, adopted at plan task 6.1 and described next.

- **yauzl** — reads the archive a source can now be (plan task 6.1 of `plans/sources-stored-not-parsed.md`). Chosen for what it refuses to do: it hands over one entry at a time and writes nothing itself, so every decision about *where* an entry lands stays in this repository — which is the only place the per-entry rules can live, because a library that extracts for you has already made those decisions by the time you could object. Three of them are ours and have to be: a path that escapes the destination after a real-path resolution, an entry that is a symbolic link, and a tree that expands past a bound while it is still expanding. It interprets nothing about symlinks on its own — `externalFileAttributes` is read and never inspected — so that check is written here against the unix mode in its high sixteen bits. `validateEntrySizes` stays on, which catches a stored entry lying about its own size before the bytes reach us.

## Reading sources

**Nothing here extracts text from a source any more** —
`adr:0021-sources-are-stored-not-parsed`. The application preserves the original
and the agent reads it, so **pdfjs-dist** and **mammoth** are gone: two
dependencies, one of them declaring an optional per-platform native binary, and
a parser that ran on a stranger's bytes inside the privileged main process. An
agent opening a PDF as a document keeps the layout, the tables and the figures,
which is exactly what a text extraction dropped and what somebody citing an
architecture document is citing.

What replaced them is the agent's own file reading, which this project neither
ships nor chooses.

- **chokidar** — watches `raw/_inbox/` for material an agent dropped there (plan 3.7), and later the project folder (8.10). `fs.watch` alone reports a file the moment it appears, which on a copy is halfway through being written; `awaitWriteFinish` is the part that stops a half-copied file becoming a permanently wrong source.

## MCP server

- **MCP TypeScript SDK** — how an agent reaches a project's wiki: read-only, over Streamable HTTP by one resident `ow serve` process, the project a tool parameter (`project_id`), per `adr:0018-mcp-over-http-serving-every-project` (which narrows `adr:0013-the-project-directory-is-the-unit` — read-only stays confinement by process, the project stays named and not pathed). The SDK still ships `ow mcp` over stdio today; the HTTP server is accepted but not yet built, so `ow serve` and its JWT are decisions on record rather than a running service.
- **zod** — the schema the MCP read tools declare their arguments with. The SDK accepts a zod shape directly, so a tool's contract is one object rather than a hand-written JSON Schema drifting from the handler.

## Development tooling

The repo's own tooling — what builds, lints and formats the code above. It is not
shipped to the user.

- **ESLint** (`eslint`, `@eslint/js`, `typescript-eslint`) — the lint layer the methodology requires alongside tests. Non-type-checked on purpose: the strict `tsconfig.base.json` already catches type errors, and a type-aware pass across every package is slow enough to tempt skipping the per-task loop.
- **`eslint-config-prettier`** — turns off every eslint rule that fights Prettier, so the two tools never argue about formatting.
- **`globals`** — the Node globals ESLint needs for `no-undef` without a per-package config.
- **Prettier** — formatting. One pass from the repo root; markdown is excluded because its rewrap mangles prose (the plan, the ADRs, the wiki).
- **esbuild** — bundles the CLI to a single file, because a hook fires it on every page write and an unbundled CLI pays module resolution each time — see `adr:0014-typescript-everywhere-except-audio-capture`.

## Testing and verification

- **Vitest** — runner for the TS packages: it runs a single file fast enough for the per-task loop, which is what scoped verification demands.
- **`@vitest/coverage-v8`** — Vitest's V8 coverage provider, and the source of the `coverage-summary.json` that CI reads to enforce the 76% floor per package. V8 rather than Istanbul because it needs no instrumentation step.
- **`cargo test`** — what already ships with Rust; adding a second runner buys nothing. It covers the recorder and nothing else.
- **GitHub Actions** — CI on `windows-latest`, which is the only platform the product supports. One job per workspace package, so a package below the coverage floor fails on its own instead of hiding behind a well-tested neighbour. It also builds and publishes the release — see `adr:0009-distribution-through-github-releases`.

## Distribution

- **electron-builder** — packs the Electron application, ffmpeg and `recorder.exe` into one NSIS installer, and is what reads `CSC_LINK` to sign it the day there is a certificate. See `adr:0009-distribution-through-github-releases`.
- **GitHub Releases** — where the installer is downloaded from. No host of ours to run, and a stable URL with a published hash is exactly what a winget or Scoop manifest needs.
- **npm** — a second channel, carrying the CLI alone, so `npx @protonspy/open-wiki init` scaffolds a project with nothing installed. It is what makes the convention reachable without the desktop application, and it is the reason two artifacts now ship from one tag — see `adr:0014-typescript-everywhere-except-audio-capture`. **The name is scoped because npm refused the bare one:** `open-wiki` is rejected as too similar to the existing `openwiki`, and a scoped name is not subject to that check at all. The installer, the plugin and the MCP server are still called `open-wiki` — only the registry entry carries the scope.

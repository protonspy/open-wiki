# Stack

Every adopted technology, with one line on why it earned its place. What is not here is an
open decision, never something adopted silently.

Nothing on this list is installed yet — the monorepo is task 1.1 of
`plans/project-wiki.md`. The list exists before the dependencies because it is what makes
adding each one a deliberate act.

## Capture

- **Rust** — the recorder has to speak COM to WASAPI and hold a clock of its own for an hour with no GC pause. Standalone binary, no runtime to install.
- **`wasapi` crate** — direct access to WASAPI, including loopback of the render device, which is exactly what ffmpeg on Windows does not have. See `adr:0005-wasapi-capture-in-a-minimal-sidecar`.

## Pipeline

- **TypeScript** — the pipeline lives in Electron's main process; one language across UI and orchestration avoids a process boundary that does not pay for itself.
- **Node.js** — Electron's runtime, already present; no extra process.
- **ffmpeg (vendored)** — downmix, VAD and Opus encode in a single tool. Bundled with hash verification, never downloaded at run time.
- **Opus 24 kbps** — the only encoding that puts an hour of meeting under the 25 MB upload limit. A requirement, not an optimisation. See `adr:0006-opus-as-the-provenance-format`.
- **Groq `whisper-large-v3-turbo`** — the default STT provider: ~US$ 0.04 per hour and ~228x real time, multilingual, which is what lets the content language be a setting rather than a fixed choice — see `adr:0008-content-language-is-a-setting-english-by-default`. It is the **only** credential the application holds — see `adr:0003-mcp-as-the-only-bridge-to-the-llm`.
- **whisper.cpp** — optional local provider, for anyone who requires that the audio never leave the machine. It is what holds up the privacy argument without rewriting the pipeline.

## Application

- **Electron** — desktop UI in the same TypeScript as the pipeline, with filesystem and child-process access and no native bridge.
- **React** — the UI has real state (a recording in progress, sources crossing the flow, pages changing while the agent writes); the ecosystem around Electron is larger than any alternative's, and that matters more than preference.
- **Vite** — renderer build and reload, fast enough that there is no temptation to skip the UI while iterating.
- **markdown-it** — renders the wiki pages in the embedded browser; its plugin model is what allows teaching it `[[wikilink]]` and `rec://` without rewriting the parser.
- **pnpm workspaces** — a monorepo of several TS packages with unhoisted dependencies, which is what stops a package from importing what it never declared.

The workspace does not use git: `adr:0002-workspace-as-a-local-markdown-folder`. This
project's source does, and that is not a technology adopted by the product.

## Text extraction from sources

Each source adapter has a single responsibility — becoming `text.md` with provenance
anchors, and the path stops writing there — see
`adr:0003-mcp-as-the-only-bridge-to-the-llm`.

- **pdf-parse** — text and page boundaries of a PDF; it is the page number that makes the citation possible, and without it the source is of no use.
- **mammoth** — DOCX to markdown preserving the heading hierarchy, which is the anchor equivalent to a PDF's page.

## MCP server

- **MCP TypeScript SDK** — the product's interface, not an accessory: it is how the agent reads, ingests and writes. It does not couple the product to a vendor, and we are not building a search engine. See `adr:0003-mcp-as-the-only-bridge-to-the-llm`.

## Testing and verification

- **Vitest** — runner for the TS packages: it runs a single file fast enough for the per-task loop, which is what scoped verification demands.
- **`@vitest/coverage-v8`** — Vitest's V8 coverage provider, and the source of the `coverage-summary.json` that CI reads to enforce the 76% floor per package. V8 rather than Istanbul because it needs no instrumentation step.
- **`cargo test`** — what already ships with Rust; adding a second runner buys nothing.
- **GitHub Actions** — CI on `windows-latest`, which is the only platform the product supports. One job per workspace package, so a package below the coverage floor fails on its own instead of hiding behind a well-tested neighbour.

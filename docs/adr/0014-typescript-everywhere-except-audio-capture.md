---
status: accepted
---

# 0014 · TypeScript everywhere except audio capture

## Context

`adr:0010-a-derived-index-engine-behind-a-cli` proposed a second Rust binary, `ow.exe`,
owning the derived view of a project behind a command line. It was never accepted, and it
left two questions open.

Meanwhile `adr:0013-the-project-directory-is-the-unit` turned that CLI from an optimisation
into the product's spine: it is the launcher, the project registry, the MCP process, the
integrity checker and — depending on which write gate is chosen — the way a page is written
at all.

The repository is already a pnpm workspace with strict TypeScript, Vitest and a coverage
floor enforced per package.

## Decision

**TypeScript and Node for everything except audio capture.** Rust keeps exactly the
recorder: COM against WASAPI, a clock of its own, no GC pause for an hour.

The CLI is a TypeScript package. It is published to npm, so `npx open-wiki init` works with
nothing installed, and the desktop installer puts an `ow` shim on `PATH` that invokes the
installed application — which is how `code` works, and it ships no second runtime.

## Consequences

This does not overrule 0010's reasoning; it applies it. That record disclaimed its own
performance argument in as many words — *"anyone claiming this engine is needed for speed at
MVP scale is wrong. What justifies it is having one owner for the derived view and a
contract narrow enough to test"* — and that justification is agnostic of language. What it
loses is the second binary, the two artifacts whose versions must agree, and the mismatched
pair that fails looking like corrupted data.

`adr:0005-wasapi-capture-in-a-minimal-sidecar` becomes literally true again. Its sentence
"everything that is not audio capture lives on the JavaScript side" was being narrowed by
0010; it is not any more.

One language means one test runner, one lint, one coverage story, and the core — validation,
frontmatter, wikilinks, markdown — is a package imported by the Electron main process, the
CLI and the MCP process rather than a contract between two languages. The plan's rule that
there is one implementation of project access, used by every surface, stops being a
discipline and becomes a fact of the build. The MCP SDK is TypeScript-first, which the Rust
version would have given up.

**Cold start is the real cost, and it is the one 0010 named.** A CLI carrying a markdown
parser, a YAML parser and the MCP SDK reaches several hundred milliseconds per invocation,
and under a hook that fires on every page write that is a tax on the agent's edit loop.
Two things pay it down: bundling to a single file, which removes module resolution, and
talking to the running application over a local socket when there is one — which there
usually is, because `ow` is what opened it.

That socket is a local listener, and this project has already paid once for treating one as
plumbing. `adr:0013-the-project-directory-is-the-unit` removed an authenticated loopback
port and would be giving the exposure straight back if a cold-start optimisation quietly
reintroduced an unauthenticated one carrying the write path. It carries read and validate
only, and the constraint belongs to that record rather than to this one.

That second path cannot be the only one. `npx open-wiki init` runs where nothing is
installed, so the CLI has to work standalone as well, and both paths have to produce the
same answer.

Publishing to npm is a distribution channel `adr:0009-distribution-through-github-releases`
does not cover. There are now two artifacts with two release paths — an installer from a
`v*` tag and a package on npm — and a version skew between them is a real failure mode, not
a hypothetical one.

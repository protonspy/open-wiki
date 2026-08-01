# This project

**This file is yours.** `scc` ships it as a stub, records that it did, and never
touches it again — an upgrade will leave whatever you write here alone. It is also
the reason `scc` needs no configuration file: the commands below are Markdown, which
the orchestrator already reads, and `scc` itself runs neither of them.

Fill it in. An empty answer here means every session re-derives your build commands
by guessing.

## Commands

Run from the repository root unless noted. The monorepo is pnpm workspaces; the
audio recorder is the one Rust crate.

```bash
# Install (pnpm via corepack; the workspace uses pnpm@10.15.0)
pnpm install

# Build — the TypeScript packages compile with tsc (noEmit in CI; emit is the bundlers' job)
pnpm run typecheck

# Build — the Rust recorder (cargo not installed on every machine; CI runs it on windows-latest)
cargo build --release

# Test — the whole suite (every workspace package, no coverage)
pnpm test

# Test — the whole suite with the 76% coverage floor enforced
pnpm test:coverage

# Test — one package (scoped run, what every task ends with)
pnpm --filter @open-wiki/access run test

# Test — one file (the tightest scope)
pnpm --filter @open-wiki/access exec vitest run tests/write/atomic-write.spec.ts

# Test — the Rust recorder
cargo test --all-features

# Lint — the best-practices layer that finds what tests do not
pnpm lint

# Format / format check
pnpm format        # write
pnpm format:check  # CI

# Validate the artifacts (specs/plans/docs shape)
scc validate          # or: npx @protonspy/scc validate
```

## Conventions

- **Branch names:** `feat/<slug>`, `fix/<slug>`, `docs/<slug>` — see
  [delivery.md](delivery.md). One branch per unit of work, in its own worktree.
- **Commits:** Conventional Commits, scoped by package when the change is
  contained to one (`feat(access): …`, `fix(cli): …`). A cross-cutting change
  omits the scope.
- **TypeScript:** strict, ESM (`"type": "module"`), `verbatimModuleSyntax` on —
  type-only imports use `import type`. One language everywhere except audio
  capture (`adr:0014-typescript-everywhere-except-audio-capture`).
- **Dependencies:** adding one is a two-step act — add it to the manifest **and**
  to `docs/stack.md` with one line on why. A dep absent from `stack.md` is a
  finding.
- **Tests:** Vitest, `*.spec.ts` under `tests/` or `src/`. The 76% coverage floor
  is per package and enforced both locally (`vitest.shared.ts`) and in CI
  (`scripts/ci/check-coverage.mjs`).
- **Methods:** `(Unit)` writes code then a test per function; `(TDD)` writes the
  failing test first and watches it red. See [methodology.md](methodology.md).

## Boundaries

- **`docs/adr/`** — never edit a superseded record; add a new one and mark the old
  `superseded`. See [knowledge-base.md](knowledge-base.md).
- **`vendor/ffmpeg/`** — gitignored, fetched by `scripts/fetch-ffmpeg.mjs` with
  hash verification. Never commit the binary.
- **`Cargo.lock` and `pnpm-lock.yaml`** — committed; the CI Rust job runs with
  `--locked`.
- **The recorder's `unsafe`** — denied at the workspace lint level until group 4
  deliberately lifts it for WASAPI.
- **`.claude/skills/`** — the convention ships once, here; the plugin (group 10)
  never re-ships the skills themselves.

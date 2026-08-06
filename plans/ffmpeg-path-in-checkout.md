---
autonomy: auto
ci: wait
---

# Ffmpeg path in checkout

The desktop app run from a checkout looked for ffmpeg in `apps/vendor/ffmpeg`
instead of `vendor/ffmpeg`, so transcription failed on every developer machine.

## Why

`resolveFfmpeg` finds the vendored binary by climbing four directories up from
its own module — correct while that module is `packages/audio/src/ffmpeg.ts`,
wrong once esbuild bundles it into `apps/desktop/build/main/index.js`, where
four levels up stops at `apps/`. `resolveRecorder` escapes the same collapse on
a coincidence: `src/main` and `build/main` sit at the same depth, so its five
levels still reach the root.

Plan 10.1 already knew the counts break under bundling and stated the packaged
location rather than deriving it — but it stated it only for `app.isPackaged`,
leaving the checkout run on the broken climb. Done means the unpackaged app
resolves both binaries from the repository root, and the resolvers' contract
under bundling is written down where the next consumer will read it.

## Paths

- `apps/desktop/src/main/resources.ts`
- `apps/desktop/src/main/index.ts`
- `packages/audio/src/ffmpeg.ts`

## Out of scope

- Fetching `vendor/ffmpeg/ffmpeg.exe` itself. `scripts/fetch-ffmpeg.mjs`
  refuses to download without a pinned `FFMPEG_SHA256`, deliberately, and
  choosing that pin is not this plan's call.

## Tasks

- [x] 1.1 (Unit) State the checkout binary paths beside the packaged ones, and
      apply whichever mode the app is in
- [x] 1.2 (Unit) Record on `defaultRepoRoot` that the climb holds only unbundled,
      so a bundling consumer sets `OPEN_WIKI_FFMPEG`
  _Depends 1.1_

## Done when

- `checkoutBinaries` resolves `apps/desktop` to `<root>/vendor/ffmpeg/ffmpeg.exe`
  and `<root>/target/release/recorder.exe`, under test.
- An override already in the environment still wins in both modes, under test.
- `pnpm test`, `pnpm lint` and `scc validate` are clean.

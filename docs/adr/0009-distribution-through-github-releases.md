---
status: accepted
---

# 0009 · Distribution through GitHub Releases, as an unsigned NSIS installer

## Context

The application has to reach a Windows machine. `adr:0001-no-backend-byok` leaves us with
no server of our own, so there is no update endpoint and no download host to run — whatever
distributes the binary is somebody else's infrastructure.

The repository is already on GitHub, the tag is already the thing that says "this is a
version", and the winget and Scoop manifests of task 10.2 both work by pointing at a stable
download URL with a known hash. GitHub Releases is that URL, produced by the tag we are
already pushing.

What remains is what the artifact is. Electron on Windows has three usual shapes: an NSIS
installer, an MSI, or a portable executable. And each of them can be signed or not, which
is a separate question with a price attached.

## Decision

**Releases live in GitHub Releases, built by CI from a `v*` tag.** Nothing is built on a
developer's machine and uploaded by hand — the tag is the trigger, and the workflow refuses
to run if the tag does not match the version in the application's `package.json`.

**The artifact is a single NSIS installer**, `.exe`, produced by electron-builder with
ffmpeg and `recorder.exe` embedded, written to `apps/desktop/release/`. A `SHA256SUMS.txt`
is published beside it, because that is what a winget or Scoop manifest has to quote.

**It is unsigned in the MVP.** The workflow reads `CSC_LINK` and `CSC_KEY_PASSWORD` from
the repository secrets and signs when they are present, so the day a certificate is bought
is a settings change and not a workflow rewrite.

## Consequences

Distribution costs nothing to run and nothing to operate. The download URL is stable and
predictable, which is the only property task 10.2 needs from it, and every release carries
the hash that manifest has to state.

**An unsigned installer means Microsoft SmartScreen warns on it**, with a dialog whose
default button is "Don't run". This lands worst in exactly the environment this product is
built for: `adr:0005-wasapi-capture-in-a-minimal-sidecar` chose direct WASAPI capture
specifically to avoid a driver a corporate antivirus would block, and then the installer
delivering it is the thing that gets flagged. A certificate is the fix, it costs money
yearly, and reputation with SmartScreen accrues per certificate — so buying one late means
starting that clock late. This is recorded as a known cost, not as an oversight.

**The choice of NSIS is harder to leave than to make.** Once installs exist in the field,
the installer type is what an upgrade path is written against, and winget and Scoop
manifests state it. Moving to MSI later is not a config change; it is a migration for
everyone who already installed.

**There is no auto-update.** Nothing in the application checks for a new version, and this
ADR does not add one — a user learns about a release from the repository, from winget or
from Scoop. Should that change, the path that preserves this decision is electron-updater
reading the same GitHub Release, not a service of ours, which would cost the position
`adr:0001-no-backend-byok` protects.

**A release is public and permanent.** Deleting a published release does not un-download
it, so the workflow publishes a tag exactly once and fails rather than overwriting one that
already exists.

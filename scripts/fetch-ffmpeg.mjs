/**
 * Fetches and verifies ffmpeg into `vendor/ffmpeg/`.
 *
 *   node scripts/fetch-ffmpeg.mjs
 *
 * ffmpeg is bundled with the installer and never downloaded at run time
 * (`docs/stack.md`). This script is what makes that real: it downloads a pinned
 * build, refuses it if its SHA256 does not match, and extracts only `ffmpeg.exe`.
 *
 * **The hash is supplied, never defaulted.** The URL below is a rolling one —
 * `ffmpeg-release-essentials.zip` is whatever gyan.dev published most recently —
 * so a hash baked in beside it would be wrong the day upstream releases, and the
 * only way to keep it green would be to stop checking. So the expected digest
 * comes from the environment, the release workflow reads it from `vars` and
 * fails loudly when it is unset, and this script refuses to download anything
 * without one:
 *
 *   FFMPEG_URL=... FFMPEG_SHA256=... node scripts/fetch-ffmpeg.mjs
 *
 * To pin a build rather than track the latest, point `FFMPEG_URL` at a versioned
 * package and record its digest alongside — the pair is what makes the pin, and
 * either one on its own verifies nothing.
 *
 * Windows-only on purpose — it is the only platform the product supports.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, "..", "..");

// The essentials build carries the encoders Opus needs. The digest has no
// default on purpose: it is what stops a tampered or half-download from shipping
// inside the installer, and a default would be a value nobody checked.
const FFMPEG_URL =
  process.env["FFMPEG_URL"] ?? "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_SHA256 = process.env["FFMPEG_SHA256"] ?? "";

const vendorDir = join(repoRoot, "vendor", "ffmpeg");
const exePath = join(vendorDir, "ffmpeg.exe");

function fail(message) {
  console.error(`fetch-ffmpeg: ${message}`);
  process.exit(1);
}

async function download(url, dest) {
  console.log(`fetch-ffmpeg: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`HTTP ${res.status} fetching ${url}`);
  const file = createWriteStream(dest);
  const hash = createHash("sha256");
  for await (const chunk of res.body) {
    hash.update(chunk);
    file.write(chunk);
  }
  await new Promise((r) => file.end(r));
  return hash.digest("hex");
}

function extract(zip, dest) {
  // Windows 10+ ships bsdtar, which reads zip. Avoids a JS unzip dependency.
  const result = spawnSync("tar", ["-xf", zip, "-C", dest, "--strip-components=1"], {
    stdio: "inherit",
  });
  if (result.status !== 0) fail(`tar extraction failed (exit ${result.status})`);
  if (!existsSync(exePath)) fail(`extraction produced no ${exePath}`);
}

async function main() {
  if (!FFMPEG_SHA256) {
    fail(
      "FFMPEG_SHA256 is not set. Pin the expected hash of FFMPEG_URL (in this " +
        "script or the FFMPEG_SHA256 env var) before fetching — a download " +
        "that verifies nothing is the fetch-and-execute this product refuses.",
    );
  }

  // Idempotent: if the exe is already there, trust the previous verification.
  if (existsSync(exePath) && statSync(exePath).size > 0) {
    console.log("fetch-ffmpeg: already present, skipping.");
    return;
  }

  mkdirSync(vendorDir, { recursive: true });
  const zipPath = join(vendorDir, "ffmpeg.zip");
  const actual = await download(FFMPEG_URL, zipPath);
  console.log(`fetch-ffmpeg: sha256 ${actual}`);
  if (actual.toLowerCase() !== FFMPEG_SHA256.toLowerCase()) {
    rmSync(zipPath, { force: true });
    fail(
      `hash mismatch\n  expected ${FFMPEG_SHA256}\n  got      ${actual}\n` +
        "The download is either tampered, changed upstream, or partial. " +
        "Update the pin only after confirming the new build.",
    );
  }
  extract(zipPath, vendorDir);
  rmSync(zipPath, { force: true });
  console.log(`fetch-ffmpeg: ok → ${exePath}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

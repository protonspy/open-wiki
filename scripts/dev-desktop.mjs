#!/usr/bin/env node
/**
 * Launch the desktop app for visual development.
 *
 * The renderer is Vite's dev server; the main process is the esbuild bundle
 * from scripts/build-main.mjs. Electron loads the renderer from
 * `VITE_DEV_SERVER_URL` when that env var is set (see `src/main/index.ts`), so
 * this script builds the main bundle, starts Vite on a fixed port, and only
 * then spawns `electron .` pointed at it.
 *
 *   pnpm --filter @open-wiki/desktop run dev:app
 *   pnpm --filter @open-wiki/desktop run dev:app -- --project C:\path\to\wiki
 *
 * Any args after `--` are forwarded to Electron, so `--project <dir>` opens a
 * specific wiki instead of the launcher (see `src/main/project.ts`).
 *
 * The main bundle is built once up front; editing `src/main/**` requires
 * restarting this command. The renderer hot-reloads through Vite as usual.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const desktop = resolve(root, "apps", "desktop");
const PORT = 5173;
const DEV_URL = `http://localhost:${PORT}`;
const win32 = process.platform === "win32";
const userArgs = process.argv.slice(2);

// `require("electron")` outside the Electron runtime returns the path to the
// binary it ships, on every platform. Spawning that binary directly — rather
// than going through `pnpm exec electron` and a shell — keeps `userArgs` as a
// literal argv: a `--project C:\x&y` value is a path, not shell tokens.
const requireFromDesktop = createRequire(resolve(desktop, "package.json"));
const electronBin = requireFromDesktop("electron");
if (typeof electronBin !== "string" || !electronBin) {
  throw new Error(
    "electron is not installed under @open-wiki/desktop — run `pnpm install` and retry.",
  );
}
// Vite's own CLI, resolved the same way, so it too is spawned directly rather
// than through `pnpm exec vite` + a shell. A direct `node` spawn has one
// concrete payoff: `vite.kill()` reaches the real Vite process instead of a
// `cmd.exe` wrapper, so the dev server does not outlive the launcher and hold
// port 5173 (which the next launch's --strictPort would then fail on). The
// `./bin/vite.js` subpath is not in vite's `exports`, so resolve the package
// root via its `package.json` (which is) and join the bin from there.
const viteCli = resolve(dirname(requireFromDesktop.resolve("vite/package.json")), "bin", "vite.js");

/**
 * Spawn `pnpm` (a `.CMD` shim on Windows that only the shell resolves),
 * inheriting stdio. Only ever called with trusted constant args — no
 * developer-supplied input reaches here, so the shell-join is not an
 * injection surface. Used only for the one-shot build step, which exits on
 * its own before anything long-lived is started.
 */
function runPnpm(args, opts = {}) {
  const full = ["pnpm", ...args].join(" ");
  return spawn(win32 ? full : "pnpm", win32 ? [] : args, {
    stdio: "inherit",
    shell: win32,
    ...opts,
  });
}

// 1. Build the main process + preload. esbuild is fast, and a stale main
//    bundle is the one failure a dev server cannot recover from. Run it
//    through the pnpm script so workspace devDeps (esbuild) are on NODE_PATH.
await new Promise((res, rej) => {
  const p = runPnpm(["--filter", "@open-wiki/desktop", "run", "build:main"]);
  p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`build-main exited ${code}`))));
});

// 2. Start Vite on a fixed port so the dev URL is known up front; --strictPort
//    fails loudly instead of silently landing on 5174 (which Electron would
//    never be told about). Spawned directly as `node <vite-cli>` with the
//    desktop as cwd so vite.config.ts is found and the process is killable.
const vite = spawn(process.execPath, [viteCli, "--port", String(PORT), "--strictPort"], {
  stdio: ["inherit", "pipe", "inherit"],
  cwd: desktop,
  shell: false,
});

let electron = null;
let exiting = false;

function launchElectron() {
  // Direct spawn, no shell: `.` loads the desktop package (`main` →
  // build/main/index.js), and `userArgs` ride as literal argv so a `--project`
  // path with spaces or metacharacters is not shell-interpreted.
  electron = spawn(electronBin, [".", ...userArgs], {
    stdio: "inherit",
    cwd: desktop,
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });
  electron.on("exit", (code) => {
    exiting = true;
    vite.kill();
    // `null` means a signal killed it — not a clean exit. Report non-zero so a
    // crashed Electron does not read as success in `pnpm`/CI.
    process.exit(code ?? 128);
  });
}

// Vite prints `  VITE vX.Y.Z  ready in Nms` once the dev server is listening.
let ready = false;
vite.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (!ready && /ready in/i.test(chunk.toString())) {
    ready = true;
    launchElectron();
  }
});

// Vite died on its own — crash, port conflict, or killed from another console.
// `exiting` is false only when nothing else already triggered shutdown, which
// means Electron may still be alive and pointing at a dead dev URL: kill it
// before leaving, or it is orphaned (a child is not signalled when its parent
// exits on Windows).
vite.on("exit", (code) => {
  if (!exiting) {
    electron?.kill();
    process.exit(code ?? 1);
  }
});

// SIGINT is the only one of these Windows can deliver (Ctrl+C); SIGTERM is
// POSIX-only and is a no-op there, but harmless to register.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    exiting = true;
    vite.kill();
    electron?.kill();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

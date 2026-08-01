import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The transcription credential is the application's **only** secret
 * (`adr:0013-the-project-directory-is-the-unit`). It lives in the application's
 * data directory, keyed by the project path — never inside the project
 * directory, unconditionally, because `git init` a week later turns a
 * conditional rule into a leak.
 *
 * This module is imported only by the desktop application and the
 * transcription path. The CLI/hook/MCP entrypoints must not read it: their
 * stderr is consumed by an agent and travels to a model provider.
 */
export interface SttSecret {
  provider: "groq" | "whispercpp";
  apiKey: string;
}

export interface ProjectSecrets {
  stt: SttSecret;
}

/** The application data directory. Overridable for tests. */
export class NoAppDataDirError extends Error {
  constructor() {
    super(
      "no application data directory: neither APPDATA nor HOME is set. The " +
        "credential is written nowhere else — falling back to the working " +
        "directory would put it inside the project, which is usually a git repository.",
    );
    this.name = "NoAppDataDirError";
  }
}

/**
 * The application data directory. Overridable for tests.
 *
 * **It never falls back to the working directory.** That fallback existed,
 * and it was the exact leak this module is written to prevent: the desktop
 * process runs with the project as its cwd, and the managed gitignore covers
 * `.state/` and the audio — not an `open-wiki/` directory appearing beside
 * them.
 */
export function defaultAppDataDir(): string {
  const base = process.env["APPDATA"] ?? process.env["HOME"];
  if (!base) throw new NoAppDataDirError();
  return join(base, "open-wiki");
}

function hashPath(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex");
}

export function secretsFile(projectRoot: string, appDataDir: string = defaultAppDataDir()): string {
  return join(appDataDir, "projects", `${hashPath(projectRoot)}.json`);
}

export function readSecrets(
  projectRoot: string,
  appDataDir: string = defaultAppDataDir(),
): ProjectSecrets | undefined {
  const file = secretsFile(projectRoot, appDataDir);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as ProjectSecrets;
}

export function writeSecrets(
  projectRoot: string,
  secrets: ProjectSecrets,
  appDataDir: string = defaultAppDataDir(),
): void {
  const file = secretsFile(projectRoot, appDataDir);
  // 0700/0600. On Windows the per-user ACL on %APPDATA% already covers this;
  // on a developer machine falling back to $HOME it is the difference between
  // the key being readable by that user and by every local account.
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(secrets, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

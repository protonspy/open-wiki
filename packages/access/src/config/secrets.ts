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
export function defaultAppDataDir(): string {
  const base = process.env["APPDATA"] ?? process.env["HOME"] ?? process.cwd();
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
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(secrets, null, 2) + "\n", "utf8");
}

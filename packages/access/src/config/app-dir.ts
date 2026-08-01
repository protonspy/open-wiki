import { join } from "node:path";

/**
 * Where the application keeps what must not live in the project directory.
 *
 * This is split out of `secrets.ts` deliberately. That module carries the
 * transcription credential and says, at its top, that the CLI/hook/MCP
 * entrypoints must not import it — their stderr is consumed by an agent and
 * travels to a model provider. But *the directory* is not the secret, and the
 * socket (9.14) needs it from the CLI side to find the token the running
 * application left there.
 *
 * So the location is here, and the credential stays there. Importing this from
 * the CLI reaches a path and nothing else.
 */

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
 * and it was the exact leak `secrets.ts` is written to prevent: the desktop
 * process runs with the project as its cwd, and the managed gitignore covers
 * `.state/` and the audio — not an `open-wiki/` directory appearing beside
 * them.
 */
export function defaultAppDataDir(): string {
  const base = process.env["APPDATA"] ?? process.env["HOME"];
  if (!base) throw new NoAppDataDirError();
  return join(base, "open-wiki");
}

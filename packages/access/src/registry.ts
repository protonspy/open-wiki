import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAppDataDir } from "./config/secrets.js";

/**
 * The registry of known project paths — a cache, never truth
 * (`adr:0013-the-project-directory-is-the-unit`). It resolves a project **name**
 * to a directory for the launcher and for `.mcp.json`, so the configuration is
 * both committed and portable.
 *
 * A name is never a path segment: `fenix`, not `C:\dev\fenix`. An unknown name is
 * refused rather than guessed at, and a directory that moved degrades to a
 * refusal — never to a search, never to the current directory.
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class UnknownNameError extends Error {
  constructor(public readonly projectName: string) {
    super(`unknown project "${projectName}": the registry is a cache, not a guess`);
    this.name = "UnknownNameError";
  }
}

export class MovedProjectError extends Error {
  constructor(
    public readonly projectName: string,
    public readonly path: string,
  ) {
    super(`project "${projectName}" was at ${path}, which no longer exists`);
    this.name = "MovedProjectError";
  }
}

export class InvalidNameError extends Error {
  constructor(public readonly projectName: string) {
    super(`invalid project name "${projectName}": a name is not a path`);
    this.name = "InvalidNameError";
  }
}

type RegistryMap = Record<string, string>;

export class ProjectRegistry {
  private readonly file: string;

  constructor(appDataDir: string = defaultAppDataDir()) {
    this.file = join(appDataDir, "registry.json");
  }

  private read(): RegistryMap {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, "utf8")) as RegistryMap;
  }

  private write(map: RegistryMap): void {
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileSync(this.file, JSON.stringify(map, null, 2) + "\n", "utf8");
  }

  private validateName(name: string): void {
    if (!NAME_RE.test(name) || name.includes("/") || name.includes("\\")) {
      throw new InvalidNameError(name);
    }
  }

  register(name: string, absPath: string): void {
    this.validateName(name);
    const map = this.read();
    map[name] = absPath;
    this.write(map);
  }

  remove(name: string): void {
    const map = this.read();
    delete map[name];
    this.write(map);
  }

  has(name: string): boolean {
    return name in this.read();
  }

  known(): string[] {
    return Object.keys(this.read()).sort();
  }

  /** Returns the directory, or throws — never falls back to cwd. */
  resolve(name: string): string {
    const map = this.read();
    if (!(name in map)) throw new UnknownNameError(name);
    const path = map[name]!;
    if (!existsSync(path)) throw new MovedProjectError(name, path);
    return path;
  }
}

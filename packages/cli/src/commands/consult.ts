import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  InvalidNameError,
  isValidProjectName,
  profilesFor,
  type Harness,
  type HarnessProfile,
} from "@open-wiki/access";

/**
 * `ow consult add <name>` — write a consulting entry naming the *other* project,
 * not its path (plan 9.8), into the MCP configuration **each harness this
 * project carries actually reads** (`harness-portability` 4.1, 4.2).
 *
 * The file stays committable and portable either way: `ow mcp` resolves the
 * name to a path through the registry on whichever machine runs it.
 *
 * ---
 *
 * **This writes the stdio entry, not `adr:0018`'s HTTP one, and that is a gap
 * rather than a decision reversed.** `adr:0018-mcp-over-http-serving-every-project`
 * decided the entry carries a URL and `Authorization: Bearer ${OPEN_WIKI_TOKEN}`,
 * served by a resident `ow serve`. That server does not exist: there is no HTTP
 * transport, no signing key, no token, and no plan task that builds one —
 * `docs/stack.md` already records it as "accepted but not yet built".
 *
 * So writing a URL here would point every harness at a port nothing listens on.
 * What this does is port *what the product actually has* to three harnesses,
 * which is 4.1's own sentence ("today it writes `.mcp.json` and nothing else").
 * When `ow serve` lands, the entry's **shape** changes here and the per-harness
 * file and schema below do not — which is the useful half of `adr:0018`'s claim
 * that "what varies per harness is the file and its schema, not the server".
 */

/** What a consulting entry is called, in every harness's configuration. */
export function consultKey(name: string): string {
  return `open-wiki-${name}`;
}

/** The entry itself: stdio, read-only, naming the project rather than pathing it. */
function consultEntry(name: string): { command: string; args: string[] } {
  return { command: "ow", args: ["mcp", "--project", name, "--read-only"] };
}

/** Thrown rather than overwriting a configuration file this product does not own. */
export class UnparsableMcpConfigError extends Error {
  constructor(public readonly file: string) {
    super(
      `refused: ${file} could not be parsed, so the consult entry was not written. ` +
        `Fix the file and run ow consult add again — it is your own configuration, and ` +
        `replacing it to add one entry would be a worse trade than not adding it.`,
    );
    this.name = "UnparsableMcpConfigError";
  }
}

export interface ConsultResult {
  key: string;
  /** The configuration files written, one per harness that keeps its own. */
  written: string[];
}

/**
 * Add the consult to every harness this project carries, from one source.
 *
 * **One act, not one per harness** (4.2). A project scaffolded for Claude Code
 * and Codex has two configuration files in two formats, and a user who had to
 * remember both would eventually update one — which is the silent half-configured
 * state this whole plan exists to end.
 *
 * An empty list means a project scaffolded before harnesses were recorded, and
 * what such a project has on disk is `.mcp.json`.
 */
export function runConsultAdd(
  projectRoot: string,
  name: string,
  harnesses: readonly Harness[] = ["claude"],
): ConsultResult {
  // **The same rule the registry applies, applied here too.** This path
  // registers nothing, so it never passed that check — and a name reaches a
  // TOML table heading, a JSON key and a command line from here. A security
  // review found a control character in a name producing a `.codex/config.toml`
  // Codex refuses to load, losing every entry in it and not only ours.
  if (!isValidProjectName(name)) throw new InvalidNameError(name);

  const key = consultKey(name);
  const chosen = harnesses.length > 0 ? harnesses : (["claude"] as const);
  const written: string[] = [];

  // Deduplicated by file: nothing today has two harnesses sharing one MCP file,
  // and writing the same entry twice would be a diff nobody made if one did.
  const seen = new Set<string>();
  for (const profile of profilesFor(chosen)) {
    if (seen.has(profile.mcp.file)) continue;
    seen.add(profile.mcp.file);
    written.push(writeConsult(projectRoot, profile, name, key));
  }
  return { key, written };
}

function writeConsult(
  projectRoot: string,
  profile: HarnessProfile,
  name: string,
  key: string,
): string {
  const file = join(projectRoot, ...profile.mcp.file.split("/"));
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;

  const next =
    profile.mcp.format === "toml"
      ? tomlWithConsult(existing, file, profile.mcp.serversKey, name, key)
      : jsonWithConsult(existing, file, profile.mcp.serversKey, name, key);

  // `null` is "already exactly this" — the file is not opened for writing at
  // all, so a re-run costs the user's formatting and comments nothing.
  if (next !== null) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, next, "utf8");
  }
  return file;
}

/**
 * The JSON form — `.mcp.json`'s `mcpServers`, and `opencode.json`'s `mcp`.
 *
 * **A file that will not parse is refused, not replaced.** This used to reset
 * to `{}` on a parse error, which was survivable while the only target was
 * `.mcp.json` and cost nothing but our own entry. `opencode.json` is the user's
 * whole opencode configuration, and the same behaviour would silently delete
 * it — the identical trade `writeHooks` was corrected on in group 2.
 */
function jsonWithConsult(
  existing: string | null,
  file: string,
  serversKey: string,
  name: string,
  key: string,
): string {
  let doc: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new UnparsableMcpConfigError(file);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new UnparsableMcpConfigError(file);
    }
    doc = parsed as Record<string, unknown>;
  }
  // The key itself has to be a table too. An array here takes the assignment
  // and then `JSON.stringify` drops it, so the file would be rewritten with our
  // entry silently missing while the CLI reported success; a primitive throws a
  // bare `TypeError` instead of this refusal.
  const servers = doc[serversKey];
  if (servers !== undefined && (typeof servers !== "object" || servers === null)) {
    throw new UnparsableMcpConfigError(file);
  }
  if (Array.isArray(servers)) throw new UnparsableMcpConfigError(file);

  const next = { ...((servers as Record<string, unknown>) ?? {}), [key]: consultEntry(name) };
  doc[serversKey] = next;
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * The TOML form — Codex's `[mcp_servers]`, inside its own `config.toml`.
 *
 * **The first version of this hand-rolled a line scanner to strip a prior copy
 * of our table, and a security review destroyed it.** A line whose trimmed text
 * equalled the heading was treated as that heading — including one sitting
 * inside a triple-quoted string, which is ordinary valid TOML:
 *
 *     notes = """
 *     Example entry, for reference:
 *     [mcp_servers.open-wiki-fenix]
 *     """
 *
 * Running that through the scanner deleted the closing quotes and every table
 * after it, and wrote the wreckage back to a file this product does not own.
 * `UnparsableMcpConfigError` did not catch it because the check ran on the
 * *original* text and the corruption happened after.
 *
 * A scanner that understood strings and comments would be a TOML lexer, which
 * is the same mistake one layer down. So the text is never edited. There are
 * exactly three cases:
 *
 * - **The entry is already there and identical** — the file is not written at
 *   all. This is what re-running `ow consult add` does, so the ordinary repeat
 *   costs the user's comments nothing because nothing is touched.
 * - **The entry is absent** — the table is *appended*. Appending to a valid TOML
 *   document is valid TOML, and every comment and ordering choice above it
 *   survives untouched.
 * - **The entry is there and differs** — the document is re-serialised from the
 *   parse, which is correct and loses comments. It is the rare case (somebody
 *   edited our table, or a future build changed its shape), and correctness on a
 *   file Codex has to load beats formatting.
 */
function tomlWithConsult(
  existing: string | null,
  file: string,
  serversKey: string,
  name: string,
  key: string,
): string | null {
  const body = existing ?? "";
  let doc: Record<string, unknown> = {};
  if (body.trim() !== "") {
    try {
      doc = parseToml(body) as Record<string, unknown>;
    } catch {
      throw new UnparsableMcpConfigError(file);
    }
  }

  const entry = consultEntry(name);
  const servers = doc[serversKey];
  if (servers !== undefined && (typeof servers !== "object" || servers === null)) {
    // `mcp_servers` present and not a table. Merging into it would produce a
    // redefinition Codex refuses, so this is the same refusal as unparsable.
    throw new UnparsableMcpConfigError(file);
  }
  const current = (servers as Record<string, unknown> | undefined)?.[key];

  // Already exactly what we would write: touch nothing.
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry)) return null;

  const table = [
    `[${serversKey}.${tomlKey(key)}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
  ].join("\n");

  if (current === undefined) {
    const prefix = body.trim() === "" ? "" : `${body.replace(/\n+$/, "")}\n\n`;
    return `${prefix}${table}\n`;
  }

  // Present and different — re-serialise, which is correct and loses comments.
  const next = { ...doc, [serversKey]: { ...(servers as Record<string, unknown>), [key]: entry } };
  return stringifyToml(next) + "\n";
}

/**
 * A bare key where TOML allows one, quoted where it does not.
 *
 * A project name is validated before it reaches here, so this is defence in
 * depth rather than the guard — but `.` is bare-*legal* and is TOML's dotted-key
 * separator, so `open-wiki-my.project` would silently nest two tables instead of
 * naming one. That one is real, and it is why the test for it exists.
 */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/**
 * A TOML basic string.
 *
 * **`JSON.stringify` is not a TOML escaper**, which a security review
 * demonstrated: JSON leaves a raw `U+007F` (DEL) unescaped and TOML forbids it,
 * so a project name carrying one produced a heading that made the whole file
 * unparsable — every entry in it lost, not only ours. Validation now stops such
 * a name much earlier; this is the layer that would have made it harmless
 * anyway.
 */
function tomlString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\r") out += "\\r";
    // Every remaining C0 control character, and DEL — the one JSON leaves bare.
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

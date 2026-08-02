import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  assertWithin,
  gateWrite,
  isWithin,
  OutsideProjectError,
  resolveReal,
  writePage,
} from "@open-wiki/access";
import type {
  BackendProtocolV2,
  EditResult,
  FileInfo,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";

/**
 * The guardrail by scope — `adr:0019`'s embedded agent reads the project the
 * way a harness does and writes `wiki/` only through the validated store.
 *
 * This is a `BackendProtocolV2` implementation (deepagents' filesystem surface):
 * the built-in `ls`/`read_file`/`write_file`/`edit_file`/`glob`/`grep` tools
 * are re-pointed at it by `createFilesystemMiddleware`, so every read is
 * confined to the project and every write routes through `gateWrite` +
 * `writePage` with origin `"agent"`. `execute` is deliberately not implemented
 * — `isSandboxBackend` is then false, and the middleware filters the
 * `execute` tool. `delete` is not implemented either; the agent's
 * `delete_page` tool uses the access primitive `deletePage`, not
 * `backend.delete`.
 *
 * **Reads** (`ls`/`read`/`readRaw`/`glob`/`grep`) operate on the real project
 * directory, every path resolved and checked with `assertWithin(projectRoot)`
 * — the same check `packages/mcp` uses, which follows junctions and symlinks
 * so a junction inside the project that points outside is refused (R3.2).
 *
 * **Writes** (`write`/`edit`) accept only paths that resolve inside
 * `<projectRoot>/wiki/` and route them through the store. `gateWrite` owns the
 * entity pages under `wiki/`; the three record pages at the top of `wiki/`
 * (`index.md`, `changelog.md`, `log.md`) pass through with no content
 * validation — editing them is wiki maintenance, gated by human approval, not
 * by the form checks (the design's stated risk). A write to any other path
 * returns an error and writes nothing (R4.3). The middleware's own
 * large-result eviction calls this same `write` on `/large_tool_results/` and
 * `/conversation_history/`, which lie outside `wiki/` — those calls fail closed
 * through the gate, and `toolTokenLimitBeforeEvict: null` skips the eviction
 * attempt entirely.
 *
 * `edit` is a logical replacement, not a partial write: the page is read, the
 * exact `old_string`→`new_string` replacement applied (`replace_all`
 * supported), and the full resulting page written atomically through
 * `writePage` — the gate validates the whole new page, not the diff.
 */
export class WikiGateBackend implements BackendProtocolV2 {
  constructor(private readonly projectRoot: string) {}

  /** Resolve and confine a caller-supplied path to the project, or return an error. */
  private confine(filePath: string): { abs: string } | { error: string } {
    try {
      return { abs: assertWithin(this.projectRoot, resolve(this.projectRoot, filePath)) };
    } catch (e) {
      if (e instanceof OutsideProjectError) return { error: e.message };
      return { error: (e as Error).message };
    }
  }

  /** Forward-slashed project-relative path of a real path inside the project. */
  private rel(abs: string): string {
    const realRoot = resolveReal(this.projectRoot);
    return relative(realRoot, abs).split(sep).join("/");
  }

  /** True when `abs` (a real path) lands inside `<projectRoot>/wiki/`. */
  private insideWiki(abs: string): boolean {
    return this.rel(abs).toLowerCase().startsWith("wiki/");
  }

  ls(path: string): LsResult {
    const c = this.confine(path);
    if ("error" in c) return { error: c.error };
    if (!existsSync(c.abs)) return { error: `no such directory: ${path}` };
    try {
      const entries = readdirSync(c.abs, { withFileTypes: true });
      const files: FileInfo[] = [];
      for (const entry of entries) {
        // Skip atomic-write temp files so the agent does not see a write in flight.
        if (entry.name.startsWith(".ow-tmp-")) continue;
        const full = resolve(c.abs, entry.name);
        if (!isWithin(this.projectRoot, full)) continue; // a junction, refused (R3.2)
        const isDir = entry.isDirectory();
        let size: number | undefined;
        let modified_at: string | undefined;
        try {
          const st = statSync(full);
          size = st.size;
          modified_at = st.mtime.toISOString();
        } catch {
          /* best-effort metadata */
        }
        files.push({ path: isDir ? `${full}/` : full, is_dir: isDir, size, modified_at });
      }
      return { files };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  read(filePath: string, offset = 0, limit = 500): ReadResult {
    const c = this.confine(filePath);
    if ("error" in c) return { error: c.error };
    if (!existsSync(c.abs)) return { error: `no such file: ${filePath}` };
    const r = readGuarded(c.abs, filePath);
    if ("error" in r) return { error: r.error };
    if (isBinary(r.buf))
      return { content: new Uint8Array(r.buf), mimeType: mimeTypeFromPath(filePath) };
    const lines = r.buf.toString("utf8").split("\n");
    return { content: lines.slice(offset, offset + limit).join("\n"), mimeType: "text/plain" };
  }

  readRaw(filePath: string): ReadRawResult {
    const c = this.confine(filePath);
    if ("error" in c) return { error: c.error };
    if (!existsSync(c.abs)) return { error: `no such file: ${filePath}` };
    const r = readGuarded(c.abs, filePath);
    if ("error" in r) return { error: r.error };
    const { buf, stat: st } = r;
    const mimeType = mimeTypeFromPath(filePath);
    const created_at = (st.birthtime.getTime() ? st.birthtime : st.mtime).toISOString();
    const modified_at = st.mtime.toISOString();
    if (isBinary(buf)) {
      return { data: { content: new Uint8Array(buf), mimeType, created_at, modified_at } };
    }
    return { data: { content: buf.toString("utf8"), mimeType, created_at, modified_at } };
  }

  glob(pattern: string, path?: string): GlobResult {
    let base: string;
    if (path) {
      const c = this.confine(path);
      if ("error" in c) return { error: c.error };
      base = c.abs;
    } else {
      base = this.projectRoot;
    }
    try {
      const matches = globSync(pattern, { cwd: base });
      const files: FileInfo[] = [];
      for (const rel of matches) {
        const full = resolve(base, rel);
        if (!isWithin(this.projectRoot, full)) continue; // R3.2: no escape, no junction
        let st: Stats;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        files.push({
          path: full,
          is_dir: st.isDirectory(),
          size: st.size,
          modified_at: st.mtime.toISOString(),
        });
      }
      return { files };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  grep(pattern: string, path?: string | null, glob?: string | null): GrepResult {
    let base: string;
    if (path) {
      const c = this.confine(path);
      if ("error" in c) return { error: c.error };
      base = c.abs;
    } else {
      base = this.projectRoot;
    }
    const matches: GrepMatch[] = [];
    try {
      const files = globSync(glob ?? "**/*", { cwd: base });
      for (const rel of files) {
        const full = resolve(base, rel);
        if (!isWithin(this.projectRoot, full)) continue; // R3.2
        let st: Stats;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) continue;
        // One unreadable or oversized file must not discard every match already
        // collected — a scan of the project will meet a locked file, a dangling
        // link, or a recording sooner or later, and losing the whole result to
        // one of them turns a working tool into an intermittent failure.
        const r = readGuarded(full, full);
        if ("error" in r) continue;
        if (isBinary(r.buf)) continue;
        const lines = r.buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line === undefined) continue;
          if (line.includes(pattern)) {
            if (matches.length >= MAX_GREP_MATCHES) {
              // Said out loud rather than truncated in silence: a capped list
              // that reads like a complete one is how "no other occurrences"
              // becomes a false answer.
              matches.push({
                path: base,
                line: 0,
                text: `… capped at ${MAX_GREP_MATCHES} matches; narrow the pattern or pass a glob`,
              });
              return { matches };
            }
            matches.push({ path: full, line: i + 1, text: line });
          }
        }
      }
      return { matches };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  write(filePath: string, content: string): WriteResult {
    const c = this.confine(filePath);
    if ("error" in c) return { error: c.error };
    if (!this.insideWiki(c.abs)) {
      return {
        error: `refused: ${filePath} is outside wiki/ — the agent may only write wiki pages (R4.3)`,
      };
    }
    const rel = this.rel(c.abs);
    const decision = gateWrite({
      projectRoot: this.projectRoot,
      filePath: c.abs,
      content,
      date: today(),
    });
    if (decision.action === "deny") return { error: decision.reasons.join("; ") };
    const settled = decision.action === "accept" ? decision.content : content;
    writePage(this.projectRoot, rel, settled, "agent");
    return { path: c.abs, filesUpdate: null, metadata: { origin: "agent" } };
  }

  edit(filePath: string, oldString: string, newString: string, replaceAll = false): EditResult {
    const c = this.confine(filePath);
    if ("error" in c) return { error: c.error };
    if (!this.insideWiki(c.abs)) {
      return {
        error: `refused: ${filePath} is outside wiki/ — the agent may only edit wiki pages (R4.3)`,
      };
    }
    if (!existsSync(c.abs)) return { error: `no such page: ${filePath}` };
    // An empty `old_string` is not an edit, it is a rewrite: `split("").join(s)`
    // inserts `s` between every character, and the non-global branch prepends it
    // — either way the whole page changes. `previewReplace` returns null for it,
    // so the human would be approving a destructive call with no preview shown.
    // Refuse it here, where the write is, rather than relying on the preview.
    if (oldString.length === 0) {
      return { error: `old_string is empty — an empty old_string would rewrite ${filePath}` };
    }
    const r = readGuarded(c.abs, filePath);
    if ("error" in r) return { error: r.error };
    const current = r.buf.toString("utf8");
    let next: string;
    let occurrences: number;
    if (replaceAll) {
      if (!current.includes(oldString)) return { error: `old_string not found in ${filePath}` };
      occurrences = current.split(oldString).length - 1;
      next = current.split(oldString).join(newString);
    } else {
      const idx = current.indexOf(oldString);
      if (idx < 0) return { error: `old_string not found in ${filePath}` };
      next = current.slice(0, idx) + newString + current.slice(idx + oldString.length);
      occurrences = 1;
    }
    const rel = this.rel(c.abs);
    const decision = gateWrite({
      projectRoot: this.projectRoot,
      filePath: c.abs,
      content: next,
      date: today(),
    });
    if (decision.action === "deny") return { error: decision.reasons.join("; ") };
    const settled = decision.action === "accept" ? decision.content : next;
    writePage(this.projectRoot, rel, settled, "agent");
    return { path: c.abs, occurrences, filesUpdate: null, metadata: { origin: "agent" } };
  }
}

/**
 * The largest file any read path here will pull into memory — R3.1's reads run
 * in the Electron **main** process, so an unbounded `readFileSync` on a
 * multi-gigabyte recording under `raw/` is the whole application's memory, not a
 * worker's. 8 MiB is far above any page or source this project writes and far
 * below what hurts.
 */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/** The most matches one `grep` call returns before it says it stopped. */
const MAX_GREP_MATCHES = 1000;

/**
 * The one read every path in this backend goes through: stat, refuse what is
 * not a readable regular file, refuse what is too large, and never throw.
 *
 * Each site guarded differently is how `read` came to answer a directory with
 * `{ error }` while `readRaw` let `EISDIR` escape the backend entirely — the
 * model reaches both with the same path. One helper is what keeps the four
 * callers answering alike.
 */
function readGuarded(abs: string, label: string): { buf: Buffer; stat: Stats } | { error: string } {
  let stat: Stats;
  try {
    stat = statSync(abs);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (stat.isDirectory()) return { error: `is a directory: ${label}` };
  if (!stat.isFile()) return { error: `not a regular file: ${label}` };
  if (stat.size > MAX_READ_BYTES) {
    return {
      error: `too large to read: ${label} is ${stat.size} bytes, over the ${MAX_READ_BYTES}-byte limit`,
    };
  }
  try {
    return { buf: readFileSync(abs), stat };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Detect a binary file: a NUL byte in the first 8000 bytes. The same heuristic
 * git uses; good enough to keep grep from dumping a recording's bytes into a
 * tool result.
 */
function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Today, as the store writes it. `YYYY-MM-DD`. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".ts": "text/x-typescript",
  ".tsx": "text/x-typescript",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".html": "text/html",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function mimeTypeFromPath(filePath: string): string {
  const dot = filePath.toLowerCase().match(/\.[^/.]+$/);
  const ext = dot?.[0];
  if (ext) {
    const mime = MIME[ext];
    if (mime) return mime;
  }
  return "application/octet-stream";
}

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { assertWithin, resolveReal } from "@open-wiki/access";
import { MAX_READ_BYTES } from "./wiki-gate-backend.js";
import type { ChatEditPreview, ChatEditSite } from "./chat-events.js";

/**
 * What an `edit_file` proposal will actually do to the page — every match site
 * and the resulting page — computed before the human decides (R5.2).
 *
 * The human-in-the-loop interrupt fires on the model's raw tool-call arguments,
 * which is *earlier* than the backend's `edit`: at interrupt time nothing in the
 * stack has yet counted how many places `old_string` occurs. Rendering those
 * arguments alone is therefore the smuggling case the design names — a short
 * `old_string` with `replace_all` looks identical to a single-site edit, and the
 * human approves a change to N places having been shown one.
 *
 * So the preview is computed here, from the page on disk, at the moment the
 * interrupt is pushed to the renderer. That is the same instant `page-guard.ts`
 * captures its content hash, so what is shown and what the guard revalidates
 * against are one view of the page: if it changes before the decision, the guard
 * refuses the write and the model re-proposes, which produces a fresh preview.
 *
 * This module reads; it never writes. A path outside the project, an unreadable
 * page, or an `old_string` that does not occur yields `null` — the renderer
 * falls back to showing the raw proposal, and the backend refuses the call on
 * its own terms.
 *
 * `resulting` is the page after the replacement, before the gate. On approval
 * `gateWrite` may still complete frontmatter (`updated`, `sources`) on the way
 * in, so those two fields can differ from what was shown — the same is already
 * true of a `write_file` proposal's `content`, and it is the store correcting
 * its own bookkeeping rather than a change to what the human approved.
 */

/** The greatest number of match sites carried across the bridge. */
const MAX_SITES = 200;

/** The longest line of context shown per site — a minified page has no newlines. */
const MAX_SITE_TEXT = 400;

/**
 * The largest resulting page carried across the bridge. Beyond it the sites are
 * still sent (they are the disclosure R5.2 asks for and they are bounded) and
 * the full page is dropped rather than the preview being abandoned — losing the
 * whole preview on a large page would quietly reopen the hole it exists to close.
 */
const MAX_RESULTING = 256 * 1024;

/**
 * Locate every occurrence of `oldString` in `content` and apply the replacement
 * the way the deepagents `edit_file` tool does: all occurrences when
 * `replaceAll`, the first one otherwise.
 */
export function previewReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): ChatEditPreview | null {
  if (oldString.length === 0) return null;
  // Scan the way the backend replaces: `split(old).join(new)`, which consumes
  // each match whole and so never counts an overlapping one. Advancing by a
  // single character instead would make `"aa"` occur twice in `"aaa"` — the
  // preview would promise two replacements and the edit would perform one, and
  // a preview that disagrees with the write is worse than none, because the
  // human approved what it showed them.
  const offsets: number[] = [];
  for (
    let at = content.indexOf(oldString);
    at !== -1;
    at = content.indexOf(oldString, at + oldString.length)
  ) {
    offsets.push(at);
  }
  if (offsets.length === 0) return null;

  const applied = replaceAll ? offsets : offsets.slice(0, 1);
  const sites: ChatEditSite[] = applied.slice(0, MAX_SITES).map((at) => {
    // 1-based line number, and the whole line the match starts on, so the human
    // sees the match in the context that tells them whether it is the one meant.
    const line = countLines(content, at);
    const start = content.lastIndexOf("\n", at - 1) + 1;
    const end = content.indexOf("\n", at);
    const text = content.slice(start, end === -1 ? content.length : end);
    return {
      line,
      text: text.length > MAX_SITE_TEXT ? `${text.slice(0, MAX_SITE_TEXT)}…` : text,
    };
  });

  // Build the result from the offsets rather than `String.replace`, so a `$&`
  // or `$1` in `new_string` is inserted literally — the tool replaces text, it
  // does not run a substitution pattern.
  let resulting = "";
  let cursor = 0;
  for (const at of applied) {
    resulting += content.slice(cursor, at) + newString;
    cursor = at + oldString.length;
  }
  resulting += content.slice(cursor);

  const tooLarge = resulting.length > MAX_RESULTING;
  return {
    occurrences: offsets.length,
    replaced: applied.length,
    sites,
    truncated: applied.length > sites.length,
    resulting: tooLarge ? undefined : resulting,
    resultingOmitted: tooLarge,
  };
}

/**
 * True when a real path lands inside `<projectRoot>/wiki/`. The same
 * land-where-it-resolves test `WikiGateBackend.insideWiki` makes, so a junction
 * inside `wiki/` pointing elsewhere is judged by its destination.
 */
function insideWiki(projectRoot: string, abs: string): boolean {
  const realRoot = resolveReal(projectRoot);
  return relative(realRoot, abs).split(sep).join("/").toLowerCase().startsWith("wiki/");
}

/** The 1-based line number of an offset. */
function countLines(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content[i] === "\n") line++;
  return line;
}

/**
 * The preview for one proposed `edit_file`, read from the page on disk. `null`
 * when the path does not resolve inside the project, does not land inside
 * `wiki/`, does not exist, or the arguments are not an edit this can render.
 *
 * The `wiki/` test mirrors `WikiGateBackend.edit`'s, and for the same reason it
 * is here rather than left to the confinement above: an `edit_file` naming
 * anything outside `wiki/` is a call the backend will refuse, so previewing it
 * would read and ship a file — `.claude/settings.json`, a large transcript
 * under `raw/` — for a change that can never land. Refusing to preview what
 * cannot be written keeps this module's reach the same as the write path's.
 */
export function previewEdit(
  projectRoot: string,
  filePath: string,
  args: Record<string, unknown>,
): ChatEditPreview | null {
  const oldString = args["old_string"];
  const newString = args["new_string"];
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  let abs: string;
  try {
    abs = assertWithin(projectRoot, resolve(projectRoot, filePath));
  } catch {
    return null; // outside the project — the backend refuses it; nothing to preview
  }
  if (!insideWiki(projectRoot, abs)) return null;
  if (!existsSync(abs)) return null;
  let content: string;
  try {
    // The size is checked before the read, not after: `MAX_RESULTING` caps only
    // what crosses the bridge, so without this the whole file is already in the
    // main process's memory by the time that cap applies. Same limit the backend
    // reads under, so a page too large to preview is a page too large to edit.
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_READ_BYTES) return null;
    content = readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  return previewReplace(content, oldString, newString, args["replace_all"] === true);
}

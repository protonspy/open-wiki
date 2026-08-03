import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { gateWrite } from "../gate/gate.js";
import { writePage } from "./atomic-write.js";
import type { Origin } from "./log.js";
import { literalSpans, termPattern, withinSpans } from "../store/prose.js";

/**
 * Replace one word with another inside a page's prose — desktop-ui 5.6, the
 * write behind the *Replace* button on a `glossary.synonym` finding.
 *
 * **It rewrites exactly what the check counted, and nothing else.** The
 * vocabulary check strips fenced code, inline code and wikilinks before it
 * looks for an avoided synonym, because "code is literal, and a wikilink to an
 * alias is a legitimate way to reach the page". A rewrite that did not strip
 * the same three would change a word the check never complained about — a
 * variable name inside a fence, or the target of a link that resolves — and the
 * finding it was offered from would still be there afterwards. So the two share
 * one rule, stated once here and once at the check, and the test asserts they
 * agree rather than asserting each alone.
 *
 * **Frontmatter is never touched.** `title`, `id` and `aliases` are the page's
 * identity and the glossary's own definitions; a synonym sweep that rewrote a
 * title would rename the concept it was trying to spell consistently.
 *
 * It goes through `gateWrite` and `writePage` like every other write in this
 * package — validated, snapshotted, undoable — because a button that edits
 * somebody's prose is exactly the write they will want back.
 */

export type ReplaceResult =
  | { ok: true; replaced: number; content: string; operationId: string }
  | { ok: false; reason: string }
  | { ok: false; reason: "invalid"; problems: string[] };

/**
 * Rewrite `avoid` as `use` in the body of `pagePath`, outside code and
 * wikilinks. Returns how many it replaced — `0` is a legitimate answer and not
 * an error, because the finding may have been fixed by hand already.
 */
export function replaceWordInPage(
  projectRoot: string,
  pagePath: string,
  avoid: string,
  use: string,
  date: string,
  origin: Origin,
): ReplaceResult {
  if (avoid.trim() === "" || use.trim() === "") {
    return { ok: false, reason: "a replacement needs both a word to avoid and a word to use" };
  }
  // **Confined to `wiki/`, not to the project** — the distinction `socket.ts`
  // already draws for its read verb, and the one this missed. `gateWrite`
  // refuses `.claude/`, `.mcp.json` and `CLAUDE.md` and *allows* everything
  // else outside `wiki/`, so confining to the project left this able to rewrite
  // `package.json`, a workflow, an ADR or a spec — a security review did it.
  //
  // The legitimate caller only ever passes `finding.page`, but the IPC channel
  // enforces none of that: whatever executes in the renderer can call it with
  // three strings of its choosing. `assertSlug` exists in the desktop for this
  // exact class, after `../CLAUDE` once renamed a page over `CLAUDE.md`.
  const full = assertWithin(join(projectRoot, "wiki"), join(projectRoot, pagePath));
  if (!existsSync(full)) return { ok: false, reason: `no such page: ${pagePath}` };

  const markdown = readFileSync(full, "utf8");
  // The frontmatter block, kept verbatim. `title`, `id` and `aliases` are the
  // page's identity and the glossary's own definitions.
  const split = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  const head = split?.[1] ?? "";
  const body = split?.[2] ?? markdown;

  const spans = literalSpans(body);
  // The same boundary the check matches on: not a word character and not a
  // hyphen either side, case-insensitive, so "Grand Total" is found where the
  // project's term is "order total".
  const pattern = termPattern(avoid, "gi");
  let replaced = 0;
  const nextBody = body.replace(pattern, (match, offset: number) => {
    if (withinSpans(spans, offset, offset + match.length)) return match;
    replaced += 1;
    return use;
  });

  if (replaced === 0) {
    return { ok: false, reason: `"${avoid}" is not in ${pagePath} outside code and wikilinks` };
  }

  const content = head + nextBody;
  const decision = gateWrite({ projectRoot, filePath: pagePath, content, date });
  if (decision.action === "deny") {
    return { ok: false, reason: "invalid", problems: decision.reasons };
  }
  const written = decision.action === "accept" ? decision.content : content;
  const operation = writePage(projectRoot, pagePath, written, origin);
  return { ok: true, replaced, content: written, operationId: operation.id };
}

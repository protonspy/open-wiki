import { basename, relative, resolve } from "node:path";
import {
  formatDenial,
  gateWrite,
  readFrontmatter,
  recordWrite,
  registerInIndex,
  writePage,
} from "@open-wiki/access";

/**
 * `ow write <path> [--content <string> | --file <path>]` — the CLI verb for a
 * harness with no hooks (plan 9.5). It runs the same gate the hook does, then
 * performs the write itself: snapshot, atomic write, the operation log, and the
 * wiki log/changelog/index that the hook records in PostToolUse.
 */
export function runWrite(
  projectRoot: string,
  filePath: string,
  content: string,
  date: string,
): { ok: true } | { ok: false; reason: string } {
  const decision = gateWrite({ projectRoot, filePath, content, date });

  if (decision.action === "deny") {
    return {
      ok: false,
      reason: formatDenial(relativePath(projectRoot, filePath), decision.reasons),
    };
  }

  const rel = relativePath(projectRoot, filePath);
  if (decision.action === "allow") {
    writePage(projectRoot, rel, content, "cli");
    return { ok: true };
  }

  // accept: write the completed content, then record the write.
  const op = writePage(projectRoot, rel, decision.content, "cli");
  const existed = op.pages[0]?.existed ?? false;
  const slug = basename(rel, ".md");
  recordWrite(projectRoot, {
    slug,
    action: existed ? "modified" : "created",
    origin: "cli",
    date,
  });
  registerInIndex(projectRoot, slug, titleOf(decision.content));
  return { ok: true };
}

function relativePath(projectRoot: string, filePath: string): string {
  return relative(resolve(projectRoot), resolve(projectRoot, filePath)).replace(/\\/g, "/");
}

function titleOf(markdown: string): string | undefined {
  const block = readFrontmatter(markdown);
  if (
    block &&
    block.parsed &&
    block.frontmatter &&
    typeof block.frontmatter === "object" &&
    !Array.isArray(block.frontmatter)
  ) {
    const fm = block.frontmatter as Record<string, unknown>;
    return typeof fm["title"] === "string" ? fm["title"] : undefined;
  }
  return undefined;
}

export { relativePath };

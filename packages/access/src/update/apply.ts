import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "../harness.js";
import { renderConvention } from "../render.js";
import { assertWithin, refuseSymlink } from "../paths.js";
import type { Language } from "../config/settings.js";
import { planUpdate, recordManaged, type UpdatePlan } from "./managed.js";

/**
 * Applying an update plan (plan `harness-portability.md` 5.2, 5.4).
 *
 * **What this does not do is the point.** It writes the `updatable` and the
 * `missing`, and it does not touch the `edited` or the `unknown` — not to merge
 * them, not to back them up and replace them, not to ask again per file. A file
 * somebody wrote by hand stays exactly as they left it, and the run says which
 * ones those were.
 */

export interface ApplyResult {
  /** Files written: those that were out of date, and those that were absent. */
  written: string[];
  /**
   * Files left alone because somebody had changed them, and the ones we have no
   * record of. Named rather than counted, because "3 files kept" tells a user
   * nothing they can act on.
   */
  kept: string[];
}

/**
 * Write what is safe to write, and leave the rest.
 *
 * **An edited file keeps its recorded hash**, deliberately. That hash is the
 * version this product last wrote, which is the base revision a three-way merge
 * would need if one is ever built; re-recording the user's content as though we
 * had written it would destroy the only fact that makes such a merge possible,
 * and would silently reclassify their file as `updatable` on the next run —
 * turning "we never touch an edited file" into "we touch it the second time".
 */
export function applyUpdate(
  projectRoot: string,
  harnesses: readonly Harness[],
  language: Language = "en",
  plan: UpdatePlan = planUpdate(projectRoot, harnesses, language),
): ApplyResult {
  const rendered = renderConvention(harnesses, language);
  const written: string[] = [];
  const wrote: Record<string, string> = {};

  for (const { path: rel, outcome } of plan.files) {
    if (outcome !== "updatable" && outcome !== "missing") continue;
    const content = rendered[rel];
    if (content === undefined) continue;

    const file = assertWithin(projectRoot, join(projectRoot, ...rel.split("/")));
    // The lesson `seedWiki` learned and two other writers had to be taught: a
    // name that is a link is not a file this product writes.
    refuseSymlink(file);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content, "utf8");
    written.push(rel);
    wrote[rel] = content;
  }

  if (written.length > 0) recordManaged(projectRoot, wrote);

  return {
    written,
    kept: [...plan.byOutcome.edited, ...plan.byOutcome.unknown].sort((a, b) => a.localeCompare(b)),
  };
}

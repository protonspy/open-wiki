import {
  applyUpdate,
  isHarness,
  planUpdate,
  readSettings,
  writeSettings,
  HARNESSES,
  type Harness,
  type UpdatePlan,
} from "@open-wiki/access";
import { writeGate } from "../install.js";

/**
 * `ow update` — bring a project's convention up to what this build ships
 * (plan `harness-portability.md` 5.3, 5.4).
 *
 * **It prints the plan and asks.** `ow init` overwrites nothing and reports
 * staleness in a sentence, which was the honest offer while there was no way to
 * tell an aged file from an edited one. There is now, and the verb that acts on
 * it has to show its working first: the list of what it would rewrite, and the
 * list of what it is leaving alone and why.
 */

export interface UpdateOptions {
  projectRoot: string;
  /**
   * Harnesses to add. Empty means "whatever this project already carries",
   * which is the ordinary update; naming one is 5.4, and it is *added* to the
   * recorded list rather than replacing it.
   */
  harnesses?: readonly Harness[];
  /** Apply without asking — for a caller with nobody at the terminal. */
  yes?: boolean;
  /** Print the plan and stop, changing nothing. */
  dryRun?: boolean;
  /**
   * Treat `unknown` files as ours, and bring them current.
   *
   * **Opt-in, and it has to be**, because `unknown` means precisely *we cannot
   * tell whether you wrote this*. But without it the verb does nothing at all
   * for any project scaffolded before the manifest existed — which is every
   * project that exists today, and the installed base this feature is for. A
   * review found `ow update` reporting "nothing to do" to exactly those users
   * while their skills were genuinely behind.
   *
   * So the choice is the user's, made once, after reading the list of files it
   * covers. That is a different thing from the tool guessing on their behalf,
   * which is what `unknown` exists to refuse.
   */
  adopt?: boolean;
}

export interface UpdateResult {
  plan: UpdatePlan;
  /** What was written, empty on a dry run or a refusal. */
  written: string[];
  /** What was left alone because somebody had changed it. */
  kept: string[];
  applied: boolean;
  harnesses: Harness[];
}

/**
 * The plan, as a person reads it.
 *
 * Grouped by outcome rather than listed by path, because the groups are what a
 * user decides on: *these will be rewritten*, *these I changed and you will not
 * touch*. A flat list of forty paths with a status column is the same
 * information and a worse question.
 */
export function formatPlan(plan: UpdatePlan): string {
  const lines: string[] = [];
  const section = (title: string, files: readonly string[]) => {
    if (files.length === 0) return;
    lines.push(`  ${title} (${files.length}):`);
    for (const f of files) lines.push(`    ${f}`);
  };

  section("to update", plan.byOutcome.updatable);
  section("to add", plan.byOutcome.missing);
  // Named, and named with the reason, because this is the list the whole verb
  // is careful about. A user who does not see it cannot tell that their edits
  // survived on purpose rather than by luck.
  section("yours — edited since we wrote them, left alone", plan.byOutcome.edited);
  section("yours — no record of writing them, left alone", plan.byOutcome.unknown);

  if (plan.byOutcome.unchanged.length > 0) {
    lines.push(`  already current: ${plan.byOutcome.unchanged.length}`);
  }
  // Said outright rather than left to be inferred from the absence of a "to
  // update" section. `already current: 3` is accurate and does not answer the
  // question the user is actually asking, and a verb that makes somebody read a
  // list to find out it has no work is one they stop running.
  //
  // **But "nothing to do" while files sit in `unknown` would be a lie**, and it
  // is the lie every project scaffolded before the manifest existed would be
  // told: no record, so nothing is `updatable`, so `hasWork` is false — while
  // the skills on disk really are behind. A code review found exactly that, and
  // it is the whole installed base.
  if (!plan.hasWork) {
    lines.push(plan.byOutcome.unknown.length > 0 ? `  nothing to do safely` : "  nothing to do");
  }
  if (plan.byOutcome.unknown.length > 0) {
    lines.push(
      "",
      "  This project predates the record of what we wrote, so those files cannot be told",
      "  apart from ones you edited. Review them; if they are ours and unmodified, run",
      "  `ow update --adopt` to take them over and bring them current.",
    );
  }
  return lines.join("\n");
}

/**
 * What to say when there is work and nobody said whether to do it.
 *
 * The refusal names the two ways forward rather than only one, because a
 * caller with no terminal is as likely to want the report as the write.
 */
export function needsConfirmation(): string {
  return [
    "ow update has changes to make and no terminal to ask at.",
    "Run it with --yes to apply them, or --dry-run to see the plan and stop.",
  ].join("\n");
}

/**
 * Move every `unknown` into `updatable` — what `--adopt` means.
 *
 * A new plan rather than a mutation, so the untouched one stays available and
 * the printed report and the applied set cannot drift.
 */
function adoptUnknown(plan: UpdatePlan): UpdatePlan {
  const files = plan.files.map((f) =>
    f.outcome === "unknown" ? { ...f, outcome: "updatable" as const } : f,
  );
  const byOutcome = {
    ...plan.byOutcome,
    updatable: [...plan.byOutcome.updatable, ...plan.byOutcome.unknown],
    unknown: [],
  };
  return {
    files,
    byOutcome,
    hasWork: byOutcome.updatable.length > 0 || byOutcome.missing.length > 0,
  };
}

/**
 * Run the verb.
 *
 * The plan is computed once and handed to `applyUpdate`, so what a user was
 * shown is exactly what runs — recomputing between the question and the act
 * would leave a window where the answer changes.
 */
export function runUpdate(opts: UpdateOptions): UpdateResult {
  const { projectRoot } = opts;
  const current = readSettings(projectRoot);

  // Added, never replaced: 5.4 is "a project can gain another harness", and a
  // replace would strip a project of a convention it already has on disk.
  const asked = opts.harnesses ?? [];
  const merged = HARNESSES.filter((h) => current.harnesses.includes(h) || asked.includes(h));
  const harnesses: Harness[] = merged.length > 0 ? merged : ["claude"];

  const planned = planUpdate(projectRoot, harnesses, current.language);
  // `--adopt` promotes the unknowns, and nothing else about the plan changes —
  // `edited` is untouched by it, because `edited` is a file we *can* tell was
  // changed after we wrote it and adopting says nothing about those.
  const plan = opts.adopt === true ? adoptUnknown(planned) : planned;

  if (opts.dryRun === true || !plan.hasWork) {
    return {
      plan,
      written: [],
      kept: [...plan.byOutcome.edited, ...plan.byOutcome.unknown],
      applied: false,
      harnesses,
    };
  }

  const result = applyUpdate(projectRoot, harnesses, current.language, plan);

  // Record the harnesses only once the files are actually there. Writing the
  // list first and failing the write would leave a project claiming a harness
  // whose convention never landed — which is this plan's own bug.
  if (asked.length > 0) writeSettings(projectRoot, { harnesses });

  // **Only the harnesses this run is actually adding.** The gate is not part of
  // the rendered convention, so it is not hash-tracked and `ow update` cannot
  // tell an edited gate from a stale one — and `writeOpencodePlugin` overwrites
  // unconditionally. Installing for every recorded harness meant that an
  // ordinary update, triggered by a stale *skill*, silently destroyed a
  // hand-edited `.opencode/plugin/open-wiki.ts` that appeared in neither the
  // plan nor the report. A code review reproduced exactly that, and it broke
  // 5.2's promise through the one door that does not go past the planner.
  const gained = asked.filter((h) => !current.harnesses.includes(h));
  if (gained.length > 0) writeGate(projectRoot, gained);

  return { plan, written: result.written, kept: result.kept, applied: true, harnesses };
}

/** `--claude`, `--codex`, `--opencode`, `--yes`, `--dry-run`. */
export function parseUpdateArgs(args: string[]): {
  harnesses: Harness[];
  yes: boolean;
  dryRun: boolean;
  adopt: boolean;
} {
  const named = new Set<Harness>();
  let yes = false;
  let dryRun = false;
  let adopt = false;
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--adopt") adopt = true;
    else if (arg.startsWith("--") && isHarness(arg.slice(2))) named.add(arg.slice(2) as Harness);
  }
  return { harnesses: HARNESSES.filter((h) => named.has(h)), yes, dryRun, adopt };
}

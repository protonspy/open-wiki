import { checkProject, hasErrors, safe, type Finding } from "@open-wiki/access";

/**
 * `ow check` — the integrity checks of group 7, without the application
 * (plan 7.7). One implementation, three readers: an agent that just wrote a
 * page, a CI job on a committed wiki, and 7.6's UI, which renders the same
 * findings.
 *
 * The exit code is the contract, and it is the one this repo already uses for
 * `scc`: `0` clean, `2` it ran and found something, `1` it could not run. A
 * finding is an answer, not a crash — which is what lets a CI job treat `2` as
 * "fix this" and `1` as "the check itself is broken".
 */

export const CHECK_OK = 0;
export const CHECK_FAILED_TO_RUN = 1;
export const CHECK_FOUND = 2;

export interface CheckOptions {
  json: boolean;
  /** Report warnings too. Errors are always reported. */
  warnings: boolean;
}

export function parseCheckArgs(args: string[]): CheckOptions {
  return {
    json: args.includes("--json"),
    // Warnings are on by default: "a source nobody cites" is exactly the thing
    // that disappears from view on its own, so hiding it by default would
    // defeat the check. `--errors-only` is for a CI job that wants a gate.
    warnings: !args.includes("--errors-only"),
  };
}

function renderText(findings: Finding[], counts: { pages: number; sources: number }): string {
  if (findings.length === 0) {
    return `ow check: no findings (${counts.pages} page(s), ${counts.sources} source(s))\n`;
  }

  const lines: string[] = [];
  for (const finding of findings) {
    const where = finding.page ?? (finding.source ? `raw/${finding.source}` : "");
    const at = finding.line === undefined ? where : `${where}:${finding.line}`;
    lines.push(`${finding.severity}: ${finding.code}`);
    // Scrubbed again here, at the one place that writes to a terminal. The
    // messages are built from page content, and a `\r` plus a cursor escape can
    // overwrite the summary a human reads to decide whether the wiki is sound.
    lines.push(`  ${safe(finding.message)}`);
    if (at) lines.push(`  at ${safe(at)}`);
    // The correction path, on every finding. A reader who cannot act on a
    // report repeats the thing that caused it.
    lines.push(`  fix: ${safe(finding.fix)}`);
    lines.push("");
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  lines.push(
    `ow check: ${errors} error(s), ${warnings} warning(s) over ${counts.pages} page(s) and ${counts.sources} source(s)`,
  );
  return lines.join("\n") + "\n";
}

export interface CheckOutput {
  stdout: string;
  code: number;
}

/**
 * Run the checks and render them. Returns the text and the exit code rather
 * than writing and exiting, so a test can drive it — the same split `main.ts`
 * makes for every other verb.
 */
export function runCheck(projectRoot: string, options: CheckOptions): CheckOutput {
  const report = checkProject(projectRoot);
  const findings = options.warnings
    ? report.findings
    : report.findings.filter((f) => f.severity === "error");

  const stdout = options.json
    ? JSON.stringify({ findings, pages: report.pages, sources: report.sources }, null, 2) + "\n"
    : renderText(findings, report);

  // Only an error fails the check. A warning is something a project may
  // legitimately choose — a source uploaded this morning that nothing cites yet
  // must not turn a CI job red.
  return { stdout, code: hasErrors(findings) ? CHECK_FOUND : CHECK_OK };
}

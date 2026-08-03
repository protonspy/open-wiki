import {
  defaultExportPath,
  exportProject,
  humanBytes,
  surveyProject,
  type ExportResult,
} from "@open-wiki/access";

/**
 * `ow export [--out <path>] [--no-sources] [--survey]` — `specs/wiki-export`,
 * R4.2.
 *
 * The whole implementation is in `@open-wiki/access`; this parses the flags,
 * picks a default filename, and renders the result. 9.1's rule, and the same
 * shape every other verb here has.
 */

export interface ExportArgs {
  out?: string;
  sources: boolean;
  survey: boolean;
}

export function parseExportArgs(args: string[]): ExportArgs {
  const parsed: ExportArgs = { sources: true, survey: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out") parsed.out = args[++i];
    else if (arg === "--no-sources") parsed.sources = false;
    else if (arg === "--survey") parsed.survey = true;
  }
  return parsed;
}

function describe(result: ExportResult, sources: boolean): string {
  const what = sources ? "wiki and sources" : "wiki only";
  return `${result.files} files, ${humanBytes(result.bytes)} (${what})`;
}

export async function runExport(
  projectRoot: string,
  args: ExportArgs,
  today: string,
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  const options = { sources: args.sources };

  if (args.survey) {
    // No destination is chosen and none is needed: a survey writes nothing, so
    // requiring `--out` would make the cheap question cost the expensive answer.
    const surveyed = surveyProject(projectRoot, options);
    return { ok: true, stdout: `would export ${describe(surveyed, args.sources)}\n` };
  }

  const destination = args.out ?? defaultExportPath(projectRoot, today);
  try {
    const written = await exportProject(projectRoot, destination, options);
    return { ok: true, stdout: `exported ${describe(written, args.sources)} to ${written.path}\n` };
  } catch (err) {
    // A sentence, not a stack — the thing reading stderr is an agent. The
    // access module's refusals already say what to do about themselves.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

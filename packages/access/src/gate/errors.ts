/**
 * One readable refusal, the same text whether it came from the CLI, a hook or
 * the editor (plan 9.13). The gate collects every reason and the caller renders
 * them; a writer gets the whole list to fix in one pass rather than one reason
 * per round-trip.
 */
export function formatDenial(filePath: string, reasons: string[]): string {
  const bullets = reasons.map((r) => `  - ${r}`).join("\n");
  return `open-wiki refused the write to ${filePath}:\n${bullets}`;
}

import checkbox from "@inquirer/checkbox";
import { HARNESSES, profileFor, type Harness } from "@open-wiki/access";

/**
 * The harness picker (plan `harness-portability.md` 2.4).
 *
 * **Multi-select is why this is a screen rather than a numbered prompt.** A
 * project may carry more than one harness (`adr:0024`), so the question is
 * "which of these" and not "which one" — and a numbered prompt that accepts
 * `1,3` is a multi-select with a worse interface and no way to see what is
 * currently chosen.
 *
 * **Nothing is preselected.** A default here is the silent guess the plan's
 * third divergence refuses: the convention is committed, so a wrong answer is
 * discovered by a colleague next week rather than by the person who gave it. An
 * empty selection is a real answer and the caller decides what it means, which
 * is not this function's business.
 */
export async function pickHarnesses(): Promise<Harness[]> {
  const chosen = await checkbox({
    message: "Which harnesses is this project for?",
    choices: HARNESSES.map((h) => {
      const p = profileFor(h);
      return { name: `${p.label} — ${p.entryFile}, ${p.skillsDir}/`, value: h };
    }),
  });
  // In HARNESSES order rather than the order they were ticked, so two people
  // choosing the same set commit the same `ow.json`.
  return HARNESSES.filter((h) => chosen.includes(h));
}

/**
 * Whether there is a person at the other end to ask.
 *
 * Both streams, not one: a run with piped input and a terminal on stdout is not
 * something a picker can drive, and answering `isTTY` on stdout alone would
 * hang it waiting on input nobody is typing.
 */
export function hasTerminal(
  streams: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } } = process,
): boolean {
  return streams.stdin.isTTY === true && streams.stdout.isTTY === true;
}

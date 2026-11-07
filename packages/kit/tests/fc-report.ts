import type { RunDetails } from "fast-check";

/**
 * Shared fast-check reporting helper (correction 2).
 *
 * For EVERY property — pass or fail — this prints the property name and the
 * ACTUAL metrics taken from the real `RunDetails` object: seed, numRuns,
 * numSkips, numShrinks, and pass/fail. The printed numbers are read from the
 * runner result, never from constants.
 *
 * On failure the ORIGINAL error, the counterexample, and the replay path
 * (seed + counterexamplePath) are preserved and surfaced in the thrown message
 * so a red run is replayable. Nothing is swallowed or replaced with a
 * hardcoded success string.
 *
 * `fail` is injected (Vitest's `expect.fail`) so this module does not import a
 * test framework and stays a plain helper under `tests/`.
 */
export function reportRun<T>(
  name: string,
  result: RunDetails<T>,
  fail: (message: string) => never,
): void {
  const metrics =
    `[fast-check] ${name}: ` +
    `result=${result.failed ? "FAIL" : "PASS"} ` +
    `seed=${result.seed} ` +
    `numRuns=${result.numRuns} ` +
    `numSkips=${result.numSkips} ` +
    `numShrinks=${result.numShrinks}`;

  // Print the real metrics for every property, regardless of outcome.
  // Write straight to stdout so the line is not captured/hidden by Vitest's
  // console interception and always reaches the terminal.
  process.stdout.write(`${metrics}\n`);

  if (result.failed) {
    const original =
      result.errorInstance instanceof Error
        ? `${result.errorInstance.name}: ${result.errorInstance.message}`
        : String(result.errorInstance);
    fail(
      `${metrics}\n` +
        `  originalError=${original}\n` +
        `  counterexample=${JSON.stringify(result.counterexample)}\n` +
        `  replay: seed=${result.seed} path=${result.counterexamplePath}`,
    );
  }
}

import type { RunDetails } from "fast-check";

/**
 * Shared fast-check reporting helper (mirrors packages/kit/tests/fc-report.ts).
 *
 * Prints the property name and the ACTUAL metrics from the real `RunDetails`
 * (seed, numRuns, numSkips, numShrinks, pass/fail). On failure the original
 * error, counterexample and replay path are surfaced so a red run is replayable.
 */
export function reportRun<T>(name: string, result: RunDetails<T>, fail: (message: string) => never): void {
  const metrics =
    `[fast-check] ${name}: ` +
    `result=${result.failed ? "FAIL" : "PASS"} ` +
    `seed=${result.seed} ` +
    `numRuns=${result.numRuns} ` +
    `numSkips=${result.numSkips} ` +
    `numShrinks=${result.numShrinks}`;

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

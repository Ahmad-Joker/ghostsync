import type { RunDetails } from "fast-check";

/**
 * Shared fast-check reporting helper (mirror of packages/capsule/tests/fc-report.ts).
 * Named without `.test.ts` so Vitest does not collect it. Prints the real RunDetails
 * metrics and, on failure, the counterexample and replay information.
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

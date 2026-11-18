/** Scan, Review, Import sequence mapped from the existing QR scan states. Pure: it reads a state, never sets one. */
export interface QrStepsView {
  /** The current step (1 Scan, 2 Review, 3 Import), or 0 when no step is current. */
  readonly active: 0 | 1 | 2 | 3;
  /** How many steps are complete. */
  readonly done: 0 | 1 | 2 | 3;
  /** True when the current step could not continue. */
  readonly error: boolean;
}

const ERROR_STATES: ReadonlySet<string> = new Set(["rejected", "denied", "no-camera", "in-use", "insecure", "unsupported", "failed", "timed-out"]);

export function qrStepsView(state: string): QrStepsView {
  if (state === "requesting" || state === "scanning") return { active: 1, done: 0, error: false };
  if (state === "scanned" || state === "already-imported") return { active: 2, done: 1, error: false };
  if (state === "importing") return { active: 3, done: 2, error: false };
  if (state === "imported") return { active: 0, done: 3, error: false };
  if (ERROR_STATES.has(state)) return { active: 1, done: 0, error: true };
  return { active: 0, done: 0, error: false };
}

export type StepState = "pending" | "current" | "done" | "error";

/** State of step `n` (1 to 3) for a view. */
export function stepState(v: QrStepsView, n: 1 | 2 | 3): StepState {
  if (v.error && v.active === n) return "error";
  if (n <= v.done) return "done";
  if (v.active === n) return "current";
  return "pending";
}

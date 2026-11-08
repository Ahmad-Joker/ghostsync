/**
 * Typed, recoverable persistence error. `code` discriminates the failing check
 * so a caller can branch on the recovery action (REQ-BP-002/005/006). The
 * package never writes to `console`; errors travel as typed values on promise
 * rejections and `onStateChange` (NFR-BP-006 — no PII/secrets in output).
 */
export type PersistenceErrorCode =
  | "DatabaseOpenError"
  | "StorageUnavailableError"
  | "UnsupportedEnvironmentError"
  | "StorageInUseError"
  | "TransactionAbortError"
  | "QuotaExceededError"
  | "BlockedError"
  | "InvalidRecordError"
  | "CloseFailedError"
  | "ClosedError";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  override readonly cause?: unknown;

  constructor(code: PersistenceErrorCode, message: string, cause?: unknown) {
    // Only attach `cause` when one is actually provided
    // (exactOptionalPropertyTypes forbids an explicit `undefined`).
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PersistenceError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Whether `value` is a `PersistenceError` with the given code. */
export function isPersistenceError(
  value: unknown,
  code?: PersistenceErrorCode,
): value is PersistenceError {
  return (
    value instanceof PersistenceError && (code === undefined || value.code === code)
  );
}

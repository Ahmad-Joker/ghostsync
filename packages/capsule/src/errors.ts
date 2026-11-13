/**
 * Typed capsule error contract.
 *
 * `CapsuleError` signals that well-typed bytes are not an acceptable capsule, or
 * that a documented operational condition occurred (crypto unavailable, target
 * unavailable). Programmer misuse (wrong argument types, diff-kind encode, ...)
 * is a plain `TypeError`, never a `CapsuleError`.
 *
 * Messages name the failing check only; they never contain byte contents, keys,
 * or other user data.
 */
export type CapsuleErrorCode =
  | "UnsupportedVersion"
  | "Malformed"
  | "AppIdentityMismatch"
  | "DocumentIdentityMismatch"
  | "OversizedRaw"
  | "OversizedDecoded"
  | "ChecksumMismatch"
  | "SdkRejection"
  | "TargetUnavailable"
  | "CryptoUnavailable";

export class CapsuleError extends Error {
  readonly code: CapsuleErrorCode;

  constructor(code: CapsuleErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CapsuleError";
    this.code = code;
  }
}

export function isCapsuleError(value: unknown, code?: CapsuleErrorCode): value is CapsuleError {
  return value instanceof CapsuleError && (code === undefined || value.code === code);
}

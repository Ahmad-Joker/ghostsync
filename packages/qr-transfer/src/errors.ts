export type QrTransferErrorCode =
  | "TooLarge"
  | "Empty"
  | "NotGhostSync"
  | "UnsupportedVersion"
  | "AnimatedNotSupported"
  | "InvalidLength"
  | "InvalidCharacter"
  | "OutOfRange";

/** Messages name the failed check only. They never contain scanned text. */
export class QrTransferError extends Error {
  readonly code: QrTransferErrorCode;
  constructor(code: QrTransferErrorCode, message: string) {
    super(message);
    this.name = "QrTransferError";
    this.code = code;
  }
}

export function isQrTransferError(err: unknown): err is QrTransferError {
  return err instanceof QrTransferError;
}

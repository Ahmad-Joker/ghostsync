import type { CapsuleErrorCode } from "@ghostsync/capsule";
import type { PersistenceErrorCode } from "@ghostsync/persist";

const trunc = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

export interface CapsuleMetaHint {
  readonly app?: string;
  readonly documentId?: string;
}

export const NOTHING_CHANGED = "Nothing was changed.";

/** Plain-language copy per CapsuleError code. "Nothing was changed." is appended on every reject. */
export function mapCapsuleError(
  code: CapsuleErrorCode | "TypeError" | "ReadFailed",
  current: { documentId: string },
  meta?: CapsuleMetaHint,
): string {
  let msg: string;
  switch (code) {
    case "DocumentIdentityMismatch":
      msg =
        meta?.documentId !== undefined
          ? `This capsule is for a different board (${trunc(meta.documentId)}). You have ${current.documentId} open.`
          : `This capsule is for a different board. You have ${current.documentId} open.`;
      break;
    case "AppIdentityMismatch":
      msg =
        meta?.app !== undefined
          ? `This capsule was made by a different app (${trunc(meta.app)}), not PatchBoard.`
          : "This capsule was made by a different app, not PatchBoard.";
      break;
    case "ChecksumMismatch":
      msg = "This file looks damaged (its checksum does not match). Ask the sender to export it again.";
      break;
    case "Malformed":
      msg = "This is not a valid PatchBoard capsule file, or it is truncated. Ask the sender to export it again.";
      break;
    case "UnsupportedVersion":
      msg =
        "This capsule uses a newer or unknown capsule format version. Update PatchBoard or ask the sender to export with a compatible version.";
      break;
    case "OversizedRaw":
      msg = "This file is larger than the 16 MiB limit.";
      break;
    case "OversizedDecoded":
      msg = "The board data inside is larger than the 8 MiB limit.";
      break;
    case "SdkRejection":
      msg = "The sync engine rejected the data in this capsule. Ask the sender to export it again.";
      break;
    case "TargetUnavailable":
      msg = "This board is not open for editing right now. Reload the page.";
      break;
    case "CryptoUnavailable":
      msg = "This browser cannot verify capsules (secure crypto is unavailable). Use HTTPS or localhost.";
      break;
    case "ReadFailed":
      msg = "Could not read that file.";
      break;
    case "TypeError":
      msg = "Unexpected error.";
      break;
  }
  return `${msg} ${NOTHING_CHANGED}`;
}

export interface MappedPersistError {
  readonly message: string;
  /** Suggested actions (button labels). */
  readonly actions: ReadonlyArray<"Try again" | "Retry save" | "Download backup capsule">;
}

/** Errors from opening a session. */
export function mapPersistError(code: PersistenceErrorCode | "Unknown"): MappedPersistError {
  switch (code) {
    case "StorageInUseError":
      return {
        message:
          "This board is already open in another tab or window on this device. Close the other one, then try again.",
        actions: ["Try again"],
      };
    case "UnsupportedEnvironmentError":
      return {
        message:
          "This browser cannot store data safely (Web Locks or IndexedDB are unavailable). Use a current Chrome, Edge, Firefox or Safari.",
        actions: [],
      };
    case "StorageUnavailableError":
    case "DatabaseOpenError":
      return {
        message:
          "Browser storage is not available (private mode, blocked storage, or disk full). Check browser settings, then try again.",
        actions: ["Try again"],
      };
    case "BlockedError":
      return {
        message: "Another tab is blocking the database. Close other PatchBoard tabs, then try again.",
        actions: ["Try again"],
      };
    case "InvalidRecordError":
      return {
        message:
          "The saved data for this board on this device is damaged or does not match. Nothing was changed, and the damaged data was kept. PatchBoard cannot open or export it. Other boards are not affected: use \"Open a different board\".",
        actions: [],
      };
    case "ClosedError":
      return { message: "This board was closed. Reload the page.", actions: [] };
    case "CloseFailedError":
      return {
        message:
          "Could not save on close. Download a backup capsule, or discard unsaved changes and switch.",
        actions: ["Download backup capsule"],
      };
    case "QuotaExceededError":
    case "TransactionAbortError":
    case "Unknown":
      return mapSaveError(code === "Unknown" ? undefined : code);
  }
}

/** Copy for a failed SAVE by error code (AC-PB-009-5/6). */
export function mapSaveError(code: string | undefined): MappedPersistError {
  const actions = ["Retry save", "Download backup capsule"] as const;
  if (code === "QuotaExceededError") {
    return {
      message:
        "Not enough space, or the board is over the 8 MiB local limit. Download a backup capsule first. Then free browser storage or start a new board. Retrying will keep failing until space or size changes.",
      actions,
    };
  }
  if (code === "TransactionAbortError") {
    return { message: "The browser aborted the write. Retry save usually works.", actions };
  }
  return {
    message: "The save failed. Try Retry save. If it keeps failing, download a backup capsule first.",
    actions,
  };
}

export const UNEXPECTED_ERROR = "Unexpected error. Reload the page. If it keeps happening, download a backup capsule first.";
export const SCHEMA_MISMATCH_MESSAGE =
  "This board was created by an incompatible PatchBoard version. Nothing was changed.";

export type EditErrorKind = "schema-mismatch" | "unexpected";

export interface EditErrorInfo {
  readonly kind: EditErrorKind;
  readonly title: string;
  readonly message: string;
}

/** Copy for a failed EDIT in the ready workspace (not a save failure, not an import result). */
export function mapEditError(kind: EditErrorKind): EditErrorInfo {
  if (kind === "schema-mismatch") {
    return {
      kind,
      title: "Your edit was NOT applied",
      message: `This device's PatchBoard version cannot edit data written with a newer schema. ${SCHEMA_MISMATCH_MESSAGE} Reload the app to get the latest version. You can download a backup capsule first.`,
    };
  }
  return {
    kind,
    title: "Your edit was NOT applied",
    message:
      "Something went wrong while applying your last edit, so it was not made. You can try the edit again, or reload the page. If it keeps happening, download a backup capsule first.",
  };
}

export function isSchemaMismatch(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("GhostSync Kit: schema mismatch");
}

export const LOSS_WARNING =
  "If you close or reload this page before the save succeeds, the imported changes and your newest edits are lost from this device. Download a backup capsule first.";

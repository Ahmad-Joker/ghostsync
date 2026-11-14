/** App-wide constants. */
export const APP_ID = "patchboard" as const;
export const DB_NAME = "patchboard" as const;
/** Equals Persist DEFAULT_MAX_BYTES and Capsule DEFAULT_MAX_UPDATE_BYTES. */
export const MAX_BYTES = 8 * 1024 * 1024;
export const LAST_BOARD_KEY = "patchboard.lastBoardId.v1";
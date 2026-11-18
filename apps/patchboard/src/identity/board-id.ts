/** Board ID normalization and validation. The board ID is the documentId for Kit, Persist and Capsule. */
const BOARD_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const BOARD_ID_RULES =
  "Use 3 to 64 characters: lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit.";

export function normalizeBoardId(raw: string): string {
  return raw.trim().toLowerCase();
}

export type BoardIdResult =
  | { readonly ok: true; readonly boardId: string }
  | { readonly ok: false; readonly message: string };

export function validateBoardId(raw: string): BoardIdResult {
  const boardId = normalizeBoardId(raw);
  if (!BOARD_ID_RE.test(boardId)) {
    return { ok: false, message: `That board ID is not valid. ${BOARD_ID_RULES}` };
  }
  return { ok: true, boardId };
}

export function previewBoardId(raw: string): string {
  const n = normalizeBoardId(raw);
  return n === "" ? "" : `Will open: ${n}`;
}

const ROUTE_RE = /^#\/b\/([^/?#]+)$/;

/** Parse `#/b/<boardId>`; returns a VALID normalized ID or undefined. */
export function parseRoute(hash: string): string | undefined {
  const m = ROUTE_RE.exec(hash);
  if (m === null || m[1] === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
  const r = validateBoardId(decoded);
  return r.ok ? r.boardId : undefined;
}

export function formatRoute(boardId: string): string {
  return `#/b/${encodeURIComponent(boardId)}`;
}
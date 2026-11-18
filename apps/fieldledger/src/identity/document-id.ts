/** Document ID normalization and validation (AC-FL-001-1..3, 001-5). */
const DOCUMENT_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export const DOCUMENT_ID_RULES =
  "Use 3 to 64 characters: lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit.";

export function normalizeDocumentId(raw: string): string {
  return raw.trim().toLowerCase();
}

export type DocumentIdResult =
  | { readonly ok: true; readonly documentId: string }
  | { readonly ok: false; readonly message: string };

export function validateDocumentId(raw: string): DocumentIdResult {
  const documentId = normalizeDocumentId(raw);
  if (!DOCUMENT_ID_RE.test(documentId)) {
    return { ok: false, message: `That incident ID is not valid. ${DOCUMENT_ID_RULES}` };
  }
  return { ok: true, documentId };
}

export function previewDocumentId(raw: string): string {
  const n = normalizeDocumentId(raw);
  return n === "" ? "" : `Will open: ${n}`;
}

const ROUTE_RE = /^#\/i\/([^/?#]+)$/;

/** Parse `#/i/<documentId>`; returns a VALID normalized ID or undefined. */
export function parseRoute(hash: string): string | undefined {
  const m = ROUTE_RE.exec(hash);
  if (m === null || m[1] === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
  const r = validateDocumentId(decoded);
  return r.ok ? r.documentId : undefined;
}

export function formatRoute(documentId: string): string {
  return `#/i/${encodeURIComponent(documentId)}`;
}

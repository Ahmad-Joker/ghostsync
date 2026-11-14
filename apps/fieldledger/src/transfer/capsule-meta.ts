import type { CapsuleMetadata } from "@ghostsync/capsule";

/** Maximum characters shown per capsule metadata value (AC-FL-013-7). */
export const META_VALUE_MAX = 80;

/**
 * Cap one metadata value for display. Values of 80 characters or fewer are shown as is. Longer values are cut so
 * the shown text is exactly 80 characters, the last being "…". Counts code points, so a pair is never split.
 * The result is for textContent only; the full value is not kept in the DOM.
 */
export function capMetaValue(value: string | undefined): string {
  if (value === undefined) return "";
  const points = Array.from(value);
  if (points.length <= META_VALUE_MAX) return value;
  return `${points.slice(0, META_VALUE_MAX - 1).join("")}…`;
}

export interface MetaLine {
  readonly testId: "import-meta-app" | "import-meta-document-id" | "import-meta-created-at";
  readonly label: string;
  readonly value: string;
}

/** The three displayed lines for an applied capsule. No metadata (a rejected import) gives no lines. */
export function metaLines(m: Pick<CapsuleMetadata, "app" | "documentId" | "createdAt"> | undefined): MetaLine[] {
  if (m === undefined) return [];
  return [
    { testId: "import-meta-app", label: "Capsule app", value: capMetaValue(m.app) },
    { testId: "import-meta-document-id", label: "Document", value: capMetaValue(m.documentId) },
    { testId: "import-meta-created-at", label: "Created", value: capMetaValue(m.createdAt) },
  ];
}

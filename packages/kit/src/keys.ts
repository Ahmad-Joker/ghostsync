/**
 * Composite-key codec scoped ENTIRELY to the records map
 * `doc.getMap("ghostsync:records:v1")` (REQ-SDK-002, clarification 1). Pure,
 * browser-safe (no `node:` imports). These sentinels/escaping are NEVER applied
 * to, or consulted for, the legacy `root` map — map membership, not a key-shape
 * predicate, decides ownership, so this module exports no bare-vs-structured
 * classifier.
 *
 * Grammar (keys inside the records map only):
 *
 *   fieldKey = SENTINEL "f" SEP esc(collection) SEP esc(entityId) SEP esc(field)
 *   metaKey  = SENTINEL "m" SEP esc(collection)
 *   esc(s)   = s with "\u0000" -> "\u0000\u0000",
 *                       SENTINEL ("\u0001") -> "\u0000\u0001",
 *                       SEP ("\u001f") -> "\u0000\u001f"
 *
 * `esc` uses NUL ("\u0000") as the escape introducer so the three reserved
 * bytes (`\u0000`, `\u0001`, `\u001f`) in any name are encoded unambiguously;
 * no collection/entity/field name — including one containing a separator, the
 * sentinel, or the kind words "f"/"m" — can forge another address. The single
 * "f"/"m" kind segment sits BEFORE the first SEP, so an escaped name can never
 * be mistaken for the kind tag.
 */

/** Top-level map name holding the structured composite-key records. */
export const RECORDS_MAP = "ghostsync:records:v1";

/** Start-of-Heading: the first char of every structured/meta key. */
export const SENTINEL = "\u0001";
/** Unit-Separator: the segment separator inside a composite key. */
export const SEP = "\u001f";
/** NUL: the escape introducer. */
const NUL = "\u0000";

const KIND_FIELD = "f";
const KIND_META = "m";

/** Escape a single path segment so reserved bytes cannot forge another address. */
function esc(segment: string): string {
  let out = "";
  for (const ch of segment) {
    if (ch === NUL) {
      out += NUL + NUL;
    } else if (ch === SENTINEL) {
      out += NUL + SENTINEL;
    } else if (ch === SEP) {
      out += NUL + SEP;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Inverse of `esc`. Throws on a dangling/invalid escape. */
function unesc(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === NUL) {
      const next = segment[i + 1];
      if (next === undefined) {
        throw new TypeError("GhostSync Kit: malformed composite key (dangling escape)");
      }
      out += next;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Split a composite key body on UNESCAPED SEP bytes. */
function splitUnescaped(body: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === NUL) {
      // An escaped pair: carry both chars literally into the current segment.
      const next = body[i + 1];
      if (next === undefined) {
        throw new TypeError("GhostSync Kit: malformed composite key (dangling escape)");
      }
      current += ch + next;
      i++;
    } else if (ch === SEP) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

/** Composite field key for one entity field inside the records map. */
export function fieldKey(collection: string, id: string, field: string): string {
  return SENTINEL + KIND_FIELD + SEP + esc(collection) + SEP + esc(id) + SEP + esc(field);
}

/** Reserved meta key for one collection inside the records map (JSON value). */
export function metaKey(collection: string): string {
  return SENTINEL + KIND_META + SEP + esc(collection);
}

/** The prefix shared by every field key of one collection (for scanning). */
export function fieldKeyPrefix(collection: string): string {
  return SENTINEL + KIND_FIELD + SEP + esc(collection) + SEP;
}

/** A decoded field key. */
export interface ParsedFieldKey {
  readonly collection: string;
  readonly id: string;
  readonly field: string;
}

/**
 * Parse a records-map key as a field key, or return undefined if it is not a
 * well-formed field key (e.g. a meta key or anything else). Never throws for a
 * recognizable meta key; throws only on a corrupt field key body.
 */
export function parseFieldKey(key: string): ParsedFieldKey | undefined {
  if (key.length < 3 || key[0] !== SENTINEL || key[2] !== SEP) {
    return undefined;
  }
  const kind = key[1];
  if (kind !== KIND_FIELD) {
    return undefined;
  }
  const body = key.slice(3);
  const segments = splitUnescaped(body);
  if (segments.length !== 3) {
    throw new TypeError("GhostSync Kit: malformed composite field key");
  }
  return {
    collection: unesc(segments[0] as string),
    id: unesc(segments[1] as string),
    field: unesc(segments[2] as string),
  };
}

/**
 * Deterministic collection identifier from the adapter's (app, entityType)
 * tuple (clarification 1). Both components are escaped and joined with SEP so
 * two distinct tuples can never encode to the same collection string — e.g.
 * ("a", "b.c") and ("a.b", "c") stay distinct. `schemaVersion` is NOT part of
 * the collection id (it lives in the persisted schema metadata), so bumping the
 * version does not silently open a separate namespace.
 */
export function collectionId(app: string, entityType: string): string {
  return esc(app) + SEP + esc(entityType);
}

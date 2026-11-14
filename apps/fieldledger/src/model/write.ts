import type { Fields, GetResult } from "@ghostsync/kit";
import type { ChecklistItem, IncidentDetails } from "./adapters.js";
import { INCIDENT_RECORD_ID } from "./adapters.js";
import { keyBetween, nextSortKey, renormalize, sortEntries, type Entry } from "./ordering.js";

/** The slice of a guarded collection the write helpers need. */
export interface WritableCollection<T> {
  put(id: string, entity: T): void;
  getResult(id: string): GetResult<T>;
  listResults(): ReadonlyArray<readonly [string, GetResult<T>]>;
  delete(id: string): void;
}

export type WriteOutcome = "ok" | "absent" | "invalid";

/**
 * Read the CURRENT record, change ONE field, put. The Kit writes only changed leaf keys, so
 * a field imported a moment earlier is never clobbered (no long-lived form object).
 */
export function commitItemField<K extends keyof ChecklistItem>(
  items: WritableCollection<ChecklistItem>,
  id: string,
  field: K,
  value: ChecklistItem[K],
): WriteOutcome {
  const r = items.getResult(id);
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  if (Object.is(r.entity[field], value)) return "ok";
  items.put(id, { ...r.entity, [field]: value });
  return "ok";
}

export function commitIncidentField<K extends keyof IncidentDetails>(
  incidents: WritableCollection<IncidentDetails>,
  field: K,
  value: IncidentDetails[K],
): WriteOutcome {
  const r = incidents.getResult(INCIDENT_RECORD_ID);
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  if (Object.is(r.entity[field], value)) return "ok";
  incidents.put(INCIDENT_RECORD_ID, { ...r.entity, [field]: value });
  return "ok";
}

export const DEFAULT_INCIDENT: IncidentDetails = {
  title: "",
  location: "",
  severity: "medium",
  status: "open",
  notes: "",
};

/** Explicit "Create incident details" (AC-FL-006-8). Never overwrites an existing record. */
export function createIncident(incidents: WritableCollection<IncidentDetails>, title: string): boolean {
  const r = incidents.getResult(INCIDENT_RECORD_ID);
  if (r.ok || r.reason === "invalidRecord") return false;
  incidents.put(INCIDENT_RECORD_ID, { ...DEFAULT_INCIDENT, title });
  return true;
}

export function validEntries(items: WritableCollection<ChecklistItem>): Entry[] {
  const out: Entry[] = [];
  for (const [id, r] of items.listResults()) if (r.ok) out.push([id, r.entity]);
  return sortEntries(out);
}

export function addItem(
  items: WritableCollection<ChecklistItem>,
  id: string,
  text: string,
  replicaId: string,
  now: number,
): void {
  const sortKey = nextSortKey(validEntries(items));
  items.put(id, { text, done: false, sortKey, createdBy: replicaId, createdAt: now });
}

/** Move one step (-1 up, +1 down) by writing ONE sortKey; renormalize only when no gap exists. */
export function moveItem(items: WritableCollection<ChecklistItem>, id: string, delta: -1 | 1): boolean {
  const sorted = validEntries(items);
  const from = sorted.findIndex(([i]) => i === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sorted.length) return false;
  const desired = [...sorted];
  const [moved] = desired.splice(from, 1);
  if (moved === undefined) return false;
  desired.splice(to, 0, moved);
  const lo = desired[to - 1]?.[1].sortKey;
  const hi = desired[to + 1]?.[1].sortKey;
  const mid = keyBetween(lo, hi);
  const fits = Number.isFinite(mid) && (lo === undefined || lo < mid) && (hi === undefined || mid < hi);
  if (fits) {
    commitItemField(items, id, "sortKey", mid);
    return true;
  }
  const reordered: Entry[] = desired.map(([i, item]) => [i, item]);
  for (const [i, key] of renormalize(reordered)) commitItemField(items, i, "sortKey", key);
  return true;
}

/** Explicit repair of an invalid record with documented fallbacks (design 3.3). */
export function restoreItem(
  items: WritableCollection<ChecklistItem>,
  id: string,
  fields: Fields,
  replicaId: string,
  now: number,
): void {
  const text = typeof fields.text === "string" && fields.text.length > 0 && fields.text.length <= 200
    ? fields.text
    : "(restored item)";
  const done = typeof fields.done === "boolean" ? fields.done : false;
  const sortKey =
    typeof fields.sortKey === "number" && Number.isFinite(fields.sortKey)
      ? fields.sortKey
      : nextSortKey(validEntries(items));
  const createdBy =
    typeof fields.createdBy === "string" && fields.createdBy.length > 0 && fields.createdBy.length <= 64
      ? fields.createdBy
      : replicaId;
  const createdAt =
    typeof fields.createdAt === "number" && Number.isInteger(fields.createdAt) && fields.createdAt >= 0
      ? fields.createdAt
      : now;
  items.put(id, { text, done, sortKey, createdBy, createdAt });
}

export function discardItem(items: WritableCollection<ChecklistItem>, id: string): void {
  items.delete(id);
}

export function restoreIncident(incidents: WritableCollection<IncidentDetails>, fields: Fields): void {
  const s = (k: string, d: string, max: number): string =>
    typeof fields[k] === "string" && (fields[k] as string).length <= max ? (fields[k] as string) : d;
  const sev = fields.severity;
  const st = fields.status;
  incidents.put(INCIDENT_RECORD_ID, {
    title: s("title", "", 120),
    location: s("location", "", 120),
    notes: s("notes", "", 2000),
    severity: sev === "low" || sev === "medium" || sev === "high" || sev === "critical" ? sev : "medium",
    status: st === "open" || st === "in-progress" || st === "resolved" ? st : "open",
  });
}

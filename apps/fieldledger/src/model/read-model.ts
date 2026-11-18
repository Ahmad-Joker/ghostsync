import type { Fields, GetResult } from "@ghostsync/kit";
import type { ChecklistItem, IncidentDetails } from "./adapters.js";
import { INCIDENT_RECORD_ID } from "./adapters.js";
import { sortEntries, type Entry } from "./ordering.js";

/** Read side of a guarded collection. listResults() is the ONLY read path used for rendering. */
export interface ReadSource<T> {
  listResults(): ReadonlyArray<readonly [string, GetResult<T>]>;
}

export interface InvalidRow {
  readonly id: string;
  readonly fields: Fields;
}

export type IncidentRead =
  | { readonly kind: "absent" }
  | { readonly kind: "ok"; readonly value: IncidentDetails }
  | { readonly kind: "invalid"; readonly fields: Fields };

export interface Model {
  readonly incident: IncidentRead;
  /** Valid items in display order. */
  readonly items: ReadonlyArray<Entry>;
  /** Invalid/incomplete items, ordered by ID (shown after valid ones). */
  readonly invalid: ReadonlyArray<InvalidRow>;
}

export function readModel(incidents: ReadSource<IncidentDetails>, items: ReadSource<ChecklistItem>): Model {
  let incident: IncidentRead = { kind: "absent" };
  for (const [id, r] of incidents.listResults()) {
    if (id !== INCIDENT_RECORD_ID) continue;
    if (r.ok) incident = { kind: "ok", value: r.entity };
    else if (r.reason === "invalidRecord") incident = { kind: "invalid", fields: r.fields };
  }
  const valid: Entry[] = [];
  const invalid: InvalidRow[] = [];
  for (const [id, r] of items.listResults()) {
    if (r.ok) valid.push([id, r.entity]);
    else if (r.reason === "invalidRecord") invalid.push({ id, fields: r.fields });
  }
  invalid.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { incident, items: sortEntries(valid), invalid };
}

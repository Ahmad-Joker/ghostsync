import type { ChecklistItem, IncidentDetails } from "./adapters.js";
import type { Model } from "./read-model.js";

export interface FieldChange {
  readonly field: string;
  readonly before: string | number | boolean;
  readonly after: string | number | boolean;
}
export interface ModelDiff {
  readonly addedItems: string[];
  readonly removedItems: string[];
  readonly changedItems: Array<{ id: string } & FieldChange>;
  readonly changedIncident: FieldChange[];
  readonly becameInvalid: string[];
  readonly noChanges: boolean;
}

const ITEM_FIELDS: ReadonlyArray<keyof ChecklistItem> = ["text", "done", "sortKey"];
const INCIDENT_FIELDS: ReadonlyArray<keyof IncidentDetails> = ["title", "location", "severity", "status", "notes"];

export function diffModels(before: Model, after: Model): ModelDiff {
  const b = new Map(before.items);
  const a = new Map(after.items);
  const bInvalid = new Set(before.invalid.map((r) => r.id));
  const addedItems = [...a.keys()].filter((id) => !b.has(id) && !bInvalid.has(id));
  const removedItems = [...b.keys()].filter((id) => !a.has(id) && !after.invalid.some((r) => r.id === id));
  const becameInvalid = after.invalid.filter((r) => !bInvalid.has(r.id)).map((r) => r.id);
  const changedItems: ModelDiff["changedItems"] = [];
  for (const [id, item] of a) {
    const prev = b.get(id);
    if (prev === undefined) continue;
    for (const f of ITEM_FIELDS) {
      if (prev[f] !== item[f]) changedItems.push({ id, field: f, before: prev[f], after: item[f] });
    }
  }
  const changedIncident: FieldChange[] = [];
  if (before.incident.kind === "ok" && after.incident.kind === "ok") {
    for (const f of INCIDENT_FIELDS) {
      const x = before.incident.value[f];
      const y = after.incident.value[f];
      if (x !== y) changedIncident.push({ field: f, before: x, after: y });
    }
  } else if (before.incident.kind !== after.incident.kind) {
    changedIncident.push({ field: "incident", before: before.incident.kind, after: after.incident.kind });
  }
  const noChanges =
    addedItems.length === 0 &&
    removedItems.length === 0 &&
    changedItems.length === 0 &&
    changedIncident.length === 0 &&
    becameInvalid.length === 0;
  return { addedItems, removedItems, changedItems, changedIncident, becameInvalid, noChanges };
}

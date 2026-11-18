/**
 * A FieldLedger-style entity adapter used by unit tests (and mirrored by the
 * browser harness). Structural validation only.
 */
import type { EntityAdapter, Fields } from "@ghostsync/kit";

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly priority: number;
}

export const incidentAdapter: EntityAdapter<Incident> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
  validate(entity: Incident): void {
    if (typeof entity.id !== "string" || entity.id.length === 0) {
      throw new TypeError("incident.id must be a non-empty string");
    }
    if (typeof entity.title !== "string") {
      throw new TypeError("incident.title must be a string");
    }
    if (typeof entity.priority !== "number" || !Number.isFinite(entity.priority)) {
      throw new TypeError("incident.priority must be a finite number");
    }
  },
  toFields(entity: Incident): Fields {
    return { id: entity.id, title: entity.title, priority: entity.priority };
  },
  fromFields(fields: Fields): Incident {
    return {
      id: String(fields["id"]),
      title: String(fields["title"]),
      priority: Number(fields["priority"]),
    };
  },
};

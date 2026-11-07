/**
 * Two genuinely different adapter consumer fixtures (REQ-SDK-001, task 8).
 * Neither lives in an app package; both exercise the SAME public SDK engine,
 * proving the engine is schema-agnostic. These are test fixtures only.
 */
import type { EntityAdapter, Fields } from "../../src/index.js";

/** FieldLedger — offline incident reporting (genuinely different schema #1). */
export interface Incident {
  title: string;
  severity: "low" | "medium" | "high";
  reportedAt: number; // epoch ms
  resolved: boolean;
  notes: string | null;
}

export const incidentAdapter: EntityAdapter<Incident> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
  validate(i) {
    if (typeof i.title !== "string" || i.title.length === 0) {
      throw new TypeError("incident.title required");
    }
    if (!["low", "medium", "high"].includes(i.severity)) {
      throw new TypeError("incident.severity invalid");
    }
    if (!Number.isFinite(i.reportedAt)) {
      throw new TypeError("incident.reportedAt invalid");
    }
    if (typeof i.resolved !== "boolean") {
      throw new TypeError("incident.resolved invalid");
    }
    if (!(i.notes === null || typeof i.notes === "string")) {
      throw new TypeError("incident.notes invalid");
    }
  },
  toFields: (i): Fields => ({
    title: i.title,
    severity: i.severity,
    reportedAt: i.reportedAt,
    resolved: i.resolved,
    notes: i.notes,
  }),
  fromFields: (f): Incident => ({
    title: f.title as string,
    severity: f.severity as Incident["severity"],
    reportedAt: f.reportedAt as number,
    resolved: f.resolved as boolean,
    notes: f.notes as string | null,
  }),
};

/** PatchBoard — offline kanban (genuinely different schema #2). */
export interface Card {
  column: "todo" | "doing" | "done";
  title: string;
  order: number;
  assignee: string | null;
}

export const cardAdapter: EntityAdapter<Card> = {
  schema: { app: "patchboard", schemaVersion: 1, entityType: "card" },
  validate(c) {
    if (!["todo", "doing", "done"].includes(c.column)) {
      throw new TypeError("card.column invalid");
    }
    if (typeof c.title !== "string") {
      throw new TypeError("card.title invalid");
    }
    if (!Number.isFinite(c.order)) {
      throw new TypeError("card.order invalid");
    }
    if (!(c.assignee === null || typeof c.assignee === "string")) {
      throw new TypeError("card.assignee invalid");
    }
  },
  toFields: (c): Fields => ({
    column: c.column,
    title: c.title,
    order: c.order,
    assignee: c.assignee,
  }),
  fromFields: (f): Card => ({
    column: f.column as Card["column"],
    title: f.title as string,
    order: f.order as number,
    assignee: f.assignee as string | null,
  }),
};

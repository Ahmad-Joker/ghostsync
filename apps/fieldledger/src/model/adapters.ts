import type { EntityAdapter, Fields } from "@ghostsync/kit";
import { APP_ID } from "../config.js";

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = ["open", "in-progress", "resolved"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type IncidentStatus = (typeof STATUSES)[number];

export interface IncidentDetails {
  readonly title: string;
  readonly location: string;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly notes: string;
}

export interface ChecklistItem {
  readonly text: string;
  readonly done: boolean;
  readonly sortKey: number;
  readonly createdBy: string;
  readonly createdAt: number;
}

export const INCIDENT_RECORD_ID = "incident" as const;
export const LIMITS = { title: 120, location: 120, notes: 2000, itemText: 200, createdBy: 64 } as const;

function has(fields: Fields, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(fields, key);
}
function str(fields: Fields, key: string): string {
  const v = has(fields, key) ? fields[key] : undefined;
  if (typeof v !== "string") throw new TypeError(`field "${key}" must be a string`);
  return v;
}
function num(fields: Fields, key: string): number {
  const v = has(fields, key) ? fields[key] : undefined;
  if (typeof v !== "number") throw new TypeError(`field "${key}" must be a number`);
  return v;
}
function bool(fields: Fields, key: string): boolean {
  const v = has(fields, key) ? fields[key] : undefined;
  if (typeof v !== "boolean") throw new TypeError(`field "${key}" must be a boolean`);
  return v;
}
function bounded(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  if (value.length < min || value.length > max) {
    throw new TypeError(`${name} must be ${min} to ${max} characters`);
  }
}
function oneOf<T extends string>(list: readonly T[], value: unknown, name: string): T {
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) {
    throw new TypeError(`${name} is not an allowed value`);
  }
  return value as T;
}

export const incidentAdapter: EntityAdapter<IncidentDetails> = {
  schema: { app: APP_ID, entityType: "incident", schemaVersion: 1 },
  validate(e: IncidentDetails): void {
    bounded(e.title, "title", 0, LIMITS.title);
    bounded(e.location, "location", 0, LIMITS.location);
    bounded(e.notes, "notes", 0, LIMITS.notes);
    oneOf(SEVERITIES, e.severity, "severity");
    oneOf(STATUSES, e.status, "status");
  },
  toFields(e: IncidentDetails): Fields {
    return { title: e.title, location: e.location, severity: e.severity, status: e.status, notes: e.notes };
  },
  fromFields(f: Fields): IncidentDetails {
    return {
      title: str(f, "title"),
      location: str(f, "location"),
      severity: oneOf(SEVERITIES, str(f, "severity"), "severity"),
      status: oneOf(STATUSES, str(f, "status"), "status"),
      notes: str(f, "notes"),
    };
  },
};

export const checklistItemAdapter: EntityAdapter<ChecklistItem> = {
  schema: { app: APP_ID, entityType: "checklistItem", schemaVersion: 1 },
  validate(e: ChecklistItem): void {
    bounded(e.text, "text", 1, LIMITS.itemText);
    if (typeof e.done !== "boolean") throw new TypeError("done must be a boolean");
    if (typeof e.sortKey !== "number" || !Number.isFinite(e.sortKey)) {
      throw new TypeError("sortKey must be a finite number");
    }
    bounded(e.createdBy, "createdBy", 1, LIMITS.createdBy);
    if (typeof e.createdAt !== "number" || !Number.isInteger(e.createdAt) || e.createdAt < 0) {
      throw new TypeError("createdAt must be a non-negative integer");
    }
  },
  toFields(e: ChecklistItem): Fields {
    return { text: e.text, done: e.done, sortKey: e.sortKey, createdBy: e.createdBy, createdAt: e.createdAt };
  },
  fromFields(f: Fields): ChecklistItem {
    return {
      text: str(f, "text"),
      done: bool(f, "done"),
      sortKey: num(f, "sortKey"),
      createdBy: str(f, "createdBy"),
      createdAt: num(f, "createdAt"),
    };
  },
};

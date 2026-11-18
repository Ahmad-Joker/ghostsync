import type { EntityAdapter, Fields } from "@ghostsync/kit";
import { APP_ID } from "../config.js";
import { parsePlacement } from "./placement.js";

export interface Card {
  readonly title: string;
  readonly notes: string;
  readonly placement: string;
}

export const LIMITS = { title: 120, notes: 2000 } as const;

function str(fields: Fields, key: string): string {
  const v = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
  if (typeof v !== "string") throw new TypeError(`field "${key}" must be a string`);
  return v;
}

function bounded(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  if (value.length < min || value.length > max) {
    throw new TypeError(`${name} must be ${min} to ${max} characters`);
  }
}

export const cardAdapter: EntityAdapter<Card> = {
  schema: { app: APP_ID, entityType: "card", schemaVersion: 1 },
  validate(e: Card): void {
    bounded(e.title, "title", 1, LIMITS.title);
    bounded(e.notes, "notes", 0, LIMITS.notes);
    if (typeof e.placement !== "string" || parsePlacement(e.placement) === undefined) {
      throw new TypeError("placement is not valid");
    }
  },
  toFields(e: Card): Fields {
    return { title: e.title, notes: e.notes, placement: e.placement };
  },
  fromFields(f: Fields): Card {
    return { title: str(f, "title"), notes: str(f, "notes"), placement: str(f, "placement") };
  },
};
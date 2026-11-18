/**
 * Typed application-adapter contract (REQ-SDK-001).
 *
 * An application declares its own schema, validation, and field mapping through
 * an `EntityAdapter<T>`. The sync engine never imports an adapter and never
 * references an app-specific type; a consumer wires the adapter in via
 * `replica.collection(adapter)`. Browser-compatible: no `node:` imports.
 */
import type { Scalar } from "./types.js";

/**
 * App/schema identity an adapter declares and a collection records inside the
 * document as a reserved meta key so it travels with the data (REQ-SDK-003-2).
 */
export interface SchemaIdentity {
  /** Application identifier, e.g. "fieldledger" | "patchboard". */
  readonly app: string;
  /** Monotonic schema version per app. */
  readonly schemaVersion: number;
  /** Entity type within the app, e.g. "incident" | "card". */
  readonly entityType: string;
}

/** Scalar field record an entity is stored as. Field values are scalars only. */
export type Fields = Record<string, Scalar>;

/**
 * App-supplied, typed contract for ONE entity type (REQ-SDK-001). The engine
 * never imports an adapter; a consumer passes it to `replica.collection(adapter)`.
 */
export interface EntityAdapter<T> {
  /** The schema identity recorded in-doc for the collection this adapter opens. */
  readonly schema: SchemaIdentity;
  /**
   * Throw (TypeError) if `entity` is not a valid T for this schema. Structural
   * scalar/shape validation only; deferred app business rules are out of scope.
   */
  validate(entity: T): void;
  /** Project a validated T to a flat scalar field record for storage. */
  toFields(entity: T): Fields;
  /** Reconstruct a typed T from a stored scalar field record. */
  fromFields(fields: Fields): T;
}

/**
 * Validate the three schema-identity components at runtime (clarification 1).
 * Throws a TypeError if any component is malformed, before the identity is
 * recorded or compared. Keeps a bad adapter from writing a corrupt meta key.
 */
export function assertSchemaIdentity(schema: unknown): asserts schema is SchemaIdentity {
  if (typeof schema !== "object" || schema === null) {
    throw new TypeError("GhostSync Kit: adapter.schema must be an object");
  }
  const candidate = schema as {
    app?: unknown;
    schemaVersion?: unknown;
    entityType?: unknown;
  };
  if (typeof candidate.app !== "string" || candidate.app.length === 0) {
    throw new TypeError("GhostSync Kit: schema.app must be a non-empty string");
  }
  if (typeof candidate.entityType !== "string" || candidate.entityType.length === 0) {
    throw new TypeError("GhostSync Kit: schema.entityType must be a non-empty string");
  }
  if (
    typeof candidate.schemaVersion !== "number" ||
    !Number.isInteger(candidate.schemaVersion) ||
    candidate.schemaVersion < 0
  ) {
    throw new TypeError(
      "GhostSync Kit: schema.schemaVersion must be a non-negative integer",
    );
  }
}

/** Whether two schema identities are equal in all three components. */
export function schemaIdentityEqual(a: SchemaIdentity, b: SchemaIdentity): boolean {
  return (
    a.app === b.app &&
    a.schemaVersion === b.schemaVersion &&
    a.entityType === b.entityType
  );
}

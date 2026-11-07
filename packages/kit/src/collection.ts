/**
 * Typed structured view over one entity type inside a document
 * (REQ-SDK-001/002/003A). A `Collection<T>` reads and writes ONLY the records
 * map (`ghostsync:records:v1`) via the composite-key codec; it never touches
 * the legacy `root` map. Browser-compatible: no `node:` imports.
 */
import type * as Y from "yjs";

import {
  assertSchemaIdentity,
  schemaIdentityEqual,
  type EntityAdapter,
  type Fields,
} from "./adapter.js";
import {
  collectionId,
  fieldKey,
  fieldKeyPrefix,
  metaKey,
  parseFieldKey,
} from "./keys.js";
import { assertScalar } from "./scalars.js";
import type { Scalar } from "./types.js";

/** A typed view over one entity type inside a document. */
export interface Collection<T> {
  /**
   * Create-or-overwrite the entity at `id` by CHANGED-FIELDS DIFF
   * (REQ-SDK-003A): validate (throw before mutating on failure), then in ONE
   * local transaction write only the leaf keys whose scalar value changed,
   * delete leaf keys for fields omitted from `entity`, and leave unchanged
   * fields untouched. Never a full rewrite — an unchanged field generates no
   * write (defect-B guard).
   *
   * Comparison is against CURRENT LOCAL state: a stale full entity can still
   * express an overwrite (its changed fields win by LWW); `put` does not and
   * cannot promise stale-form safety.
   */
  put(id: string, entity: T): void;
  /**
   * Read and reconstruct the entity at `id`, or `undefined` if it has no live
   * field keys. Runs the adapter's `fromFields` + `validate` on the read
   * (clarification 4): an incomplete/invalid record (e.g. a field deleted
   * concurrently with an edit) is a CONTROLLED error surfaced via
   * `getResult`/the thrown `IncompleteRecordError` — the underlying fields are
   * preserved, never manufactured or deleted.
   */
  get(id: string): T | undefined;
  /**
   * Like `get`, but returns a controlled outcome instead of throwing on an
   * incomplete/invalid record (clarification 4).
   */
  getResult(id: string): GetResult<T>;
  /** List all [id, entity] pairs whose stored fields reconstruct a valid T. */
  list(): ReadonlyArray<readonly [string, T]>;
  /**
   * Enumerate EVERY stored entity id in this collection — INCLUDING
   * invalid/incomplete records — as `[entityId, GetResult<T>]` tuples, without
   * deleting, repairing, or fabricating any field. This is the discovery path
   * for records `list()` intentionally omits: `list()` returns only the valid
   * entities, whereas `listResults()` also surfaces every `invalidRecord`
   * outcome so a caller can inspect the preserved fields.
   *
   * A caller discovers invalid records by filtering for `!result.ok &&
   * result.reason === "invalidRecord"`; for each such tuple the original stored
   * fields are available on `result.fields` (and the reconstruction error on
   * `result.cause`), exactly as `getResult(id)` would return them. The `absent`
   * reason never appears here because every id enumerated has at least one live
   * field key.
   */
  listResults(): ReadonlyArray<readonly [string, GetResult<T>]>;
  /**
   * Delete the entity at `id` — remove all its field leaf keys in ONE local
   * transaction. No-op if absent (AC-SDK-002-5).
   */
  delete(id: string): void;
  /** Whether an entity has at least one live field key at `id`. */
  has(id: string): boolean;
}

/** Controlled read outcome (clarification 4). */
export type GetResult<T> =
  | { readonly ok: true; readonly entity: T }
  | { readonly ok: false; readonly reason: "absent" }
  | {
      readonly ok: false;
      readonly reason: "invalidRecord";
      readonly id: string;
      readonly fields: Fields;
      readonly cause: unknown;
    };

/**
 * Controlled error for an incomplete/invalid stored record (clarification 4).
 * Thrown only by `get` (not `getResult`/`list`); it never corrupts or deletes
 * the underlying fields.
 */
export class IncompleteRecordError extends Error {
  readonly id: string;
  readonly fields: Fields;
  readonly cause: unknown;
  constructor(id: string, fields: Fields, cause: unknown) {
    super(
      `GhostSync Kit: record "${id}" is incomplete or invalid for this schema`,
    );
    this.name = "IncompleteRecordError";
    this.id = id;
    this.fields = fields;
    this.cause = cause;
  }
}

/**
 * Engine seam a collection resolves lazily (clarification 3). A `Collection`
 * handle keeps working across a staging/swap because it never captures a `Y.Doc`
 * reference — it calls `recordsMap()`/`transactLocal()` which resolve the
 * CURRENT committed doc each time.
 */
export interface CollectionHost {
  /** The current committed records map (`ghostsync:records:v1`). */
  recordsMap(): Y.Map<unknown>;
  /** Run `fn` inside one local-origin transaction on the committed doc. */
  transactLocal(fn: () => void): void;
}

export class CollectionImpl<T> implements Collection<T> {
  readonly #host: CollectionHost;
  readonly #adapter: EntityAdapter<T>;
  readonly #collection: string;

  constructor(host: CollectionHost, adapter: EntityAdapter<T>) {
    assertSchemaIdentity(adapter.schema);
    this.#host = host;
    this.#adapter = adapter;
    this.#collection = collectionId(adapter.schema.app, adapter.schema.entityType);
  }

  /** Ensure the schema-identity meta key is compatible with this adapter.
   *  Recorded on first write and re-checked BEFORE every public operation
   *  (put/get/getResult/list/listResults/delete/has) and on open, so a
   *  conflicting version brought in by a remote import — even one that becomes
   *  the LWW winner AFTER this handle was created — is detected on the next
   *  operation through this handle, not only at initial open (clarification 5).
   *  The parsed meta value is itself validated (`assertSchemaIdentity`) before
   *  comparison, so a corrupt persisted meta (non-string, unparseable JSON,
   *  `null`, a non-object, or a value missing/mistyping app/entityType/
   *  schemaVersion) raises a CONTROLLED schema-mismatch error rather than
   *  crashing or silently passing. */
  #assertSchemaCompatible(): void {
    const map = this.#host.recordsMap();
    const key = metaKey(this.#collection);
    const stored = map.get(key);
    if (stored === undefined) {
      return; // no recorded identity yet — compatible by default
    }
    if (typeof stored !== "string") {
      throw new Error(
        `GhostSync Kit: schema mismatch for collection ${this.#adapter.schema.app}/${this.#adapter.schema.entityType} (corrupt meta)`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch (cause) {
      throw new Error(
        `GhostSync Kit: schema mismatch for collection ${this.#adapter.schema.app}/${this.#adapter.schema.entityType} (unparseable meta)`,
        { cause },
      );
    }
    // Validate the PARSED value before comparing: a parseable-but-malformed meta
    // (e.g. the literal `null`, a non-object, or a missing/wrong-typed field)
    // must become a controlled schema error, not a crash inside the comparison.
    try {
      assertSchemaIdentity(parsed);
    } catch (cause) {
      throw new Error(
        `GhostSync Kit: schema mismatch for collection ${this.#adapter.schema.app}/${this.#adapter.schema.entityType} (corrupt meta)`,
        { cause },
      );
    }
    if (!schemaIdentityEqual(parsed, this.#adapter.schema)) {
      throw new Error(
        `GhostSync Kit: schema mismatch for collection ${this.#adapter.schema.app}/${this.#adapter.schema.entityType}: ` +
          `stored ${JSON.stringify(parsed)} != adapter ${JSON.stringify(this.#adapter.schema)}`,
      );
    }
  }

  /** Called by the host at open time to record/verify the schema identity. */
  open(): void {
    this.#assertSchemaCompatible();
    const map = this.#host.recordsMap();
    const key = metaKey(this.#collection);
    if (map.get(key) === undefined) {
      this.#host.transactLocal(() => {
        this.#host.recordsMap().set(key, JSON.stringify(this.#adapter.schema));
      });
    }
  }

  /** Live stored fields of one entity (null-prototype), from the records map. */
  #storedFields(id: string): Fields {
    const map = this.#host.recordsMap();
    const prefix = fieldKeyPrefix(this.#collection);
    const out = Object.create(null) as Record<string, Scalar>;
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const parsed = parseFieldKey(key);
      if (parsed === undefined || parsed.collection !== this.#collection || parsed.id !== id) {
        continue;
      }
      Object.defineProperty(out, parsed.field, {
        value: map.get(key) as Scalar,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out as Fields;
  }

  put(id: string, entity: T): void {
    // Validate + schema-compat + scalar guard BEFORE any mutation
    // (clarification 6: validate and compute all changes before mutating).
    this.#assertSchemaCompatible();
    this.#adapter.validate(entity);
    const next = this.#adapter.toFields(entity);
    for (const value of Object.values(next)) {
      assertScalar(value);
    }

    const current = this.#storedFields(id);
    const nextKeys = Object.keys(next);
    const nextKeySet = new Set(nextKeys);

    // Compute the exact write/delete set vs current local state.
    const toSet: Array<readonly [string, Scalar]> = [];
    for (const field of nextKeys) {
      const value = next[field] as Scalar;
      if (!Object.prototype.hasOwnProperty.call(current, field) || !Object.is(current[field], value)) {
        toSet.push([field, value]);
      }
    }
    const toDelete: string[] = [];
    for (const field of Object.keys(current)) {
      if (!nextKeySet.has(field)) {
        toDelete.push(field);
      }
    }

    if (toSet.length === 0 && toDelete.length === 0) {
      return; // nothing changed — no transaction, no notification
    }

    this.#host.transactLocal(() => {
      const map = this.#host.recordsMap();
      for (const [field, value] of toSet) {
        map.set(fieldKey(this.#collection, id, field), value);
      }
      for (const field of toDelete) {
        map.delete(fieldKey(this.#collection, id, field));
      }
    });
  }

  getResult(id: string): GetResult<T> {
    // Recheck schema identity before the read (clarification 5 / correction 1):
    // an incompatible handle rejects with the schema-mismatch error rather than
    // degrading into an "absent" or "invalidRecord" outcome.
    this.#assertSchemaCompatible();
    const fields = this.#storedFields(id);
    if (Object.keys(fields).length === 0) {
      return { ok: false, reason: "absent" };
    }
    try {
      const entity = this.#adapter.fromFields(fields);
      this.#adapter.validate(entity);
      return { ok: true, entity };
    } catch (cause) {
      // Incomplete/invalid record (clarification 4): the underlying fields are
      // preserved (not deleted, not manufactured); a controlled outcome is
      // returned rather than a corrupting throw.
      return { ok: false, reason: "invalidRecord", id, fields, cause };
    }
  }

  get(id: string): T | undefined {
    const result = this.getResult(id);
    if (result.ok) {
      return result.entity;
    }
    if (result.reason === "absent") {
      return undefined;
    }
    throw new IncompleteRecordError(result.id, result.fields, result.cause);
  }

  /** Collect every entity id with at least one live field key in this collection. */
  #entityIds(): Set<string> {
    const map = this.#host.recordsMap();
    const prefix = fieldKeyPrefix(this.#collection);
    const ids = new Set<string>();
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const parsed = parseFieldKey(key);
      if (parsed !== undefined && parsed.collection === this.#collection) {
        ids.add(parsed.id);
      }
    }
    return ids;
  }

  list(): ReadonlyArray<readonly [string, T]> {
    // Recheck before enumerating so an empty-but-incompatible collection still
    // rejects (correction 1); each per-id getResult rechecks too.
    this.#assertSchemaCompatible();
    const out: Array<readonly [string, T]> = [];
    for (const id of this.#entityIds()) {
      const result = this.getResult(id);
      if (result.ok) {
        out.push([id, result.entity]);
      }
    }
    return out;
  }

  listResults(): ReadonlyArray<readonly [string, GetResult<T>]> {
    // Recheck before enumerating (correction 1): an incompatible handle rejects
    // with the schema-mismatch error for listResults exactly like list().
    this.#assertSchemaCompatible();
    const out: Array<readonly [string, GetResult<T>]> = [];
    for (const id of this.#entityIds()) {
      // getResult preserves invalid-record fields verbatim (never repairs,
      // deletes, or fabricates) and never returns "absent" for an id that has a
      // live field key, so every enumerated id yields an ok or invalidRecord.
      out.push([id, this.getResult(id)]);
    }
    return out;
  }

  delete(id: string): void {
    // Recheck before any mutation: deletion through an incompatible handle must
    // NOT mutate anything and must NOT notify (correction 1) — the throw here
    // precedes any key scan or transaction.
    this.#assertSchemaCompatible();
    const map = this.#host.recordsMap();
    const prefix = fieldKeyPrefix(this.#collection);
    const keys: string[] = [];
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const parsed = parseFieldKey(key);
      if (parsed !== undefined && parsed.collection === this.#collection && parsed.id === id) {
        keys.push(key);
      }
    }
    if (keys.length === 0) {
      return;
    }
    this.#host.transactLocal(() => {
      const live = this.#host.recordsMap();
      for (const key of keys) {
        live.delete(key);
      }
    });
  }

  has(id: string): boolean {
    // Recheck before the read (correction 1): an incompatible handle rejects
    // rather than returning a boolean derived from a foreign schema's data.
    this.#assertSchemaCompatible();
    const map = this.#host.recordsMap();
    const prefix = fieldKeyPrefix(this.#collection);
    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const parsed = parseFieldKey(key);
      if (parsed !== undefined && parsed.collection === this.#collection && parsed.id === id) {
        return true;
      }
    }
    return false;
  }
}

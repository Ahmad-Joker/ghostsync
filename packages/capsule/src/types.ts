import type { ApplyOutcome, State } from "@ghostsync/kit";

import type { CapsuleMetadata } from "./metadata.js";

/** Structural surface of an in-memory Kit `Replica`. */
export interface ReplicaTarget {
  readonly documentId: string;
  applyUpdate(carrier: unknown): ApplyOutcome;
}

/** Used only by the plain replica helper; the persisted helper takes its app from the target. */
export interface ImportExpectation {
  readonly app: string;
}

export interface ImportResult {
  readonly applied: true;
  readonly metadata: CapsuleMetadata;
}

/**
 * Structural surface a real `PersistSession` satisfies unchanged. `identity` is
 * a minimal projection (a session's extra `replicaId` is fine); nothing is
 * imported from `@ghostsync/persist`.
 */
export interface PersistTarget {
  readonly identity: { readonly app: string; readonly documentId: string };
  applyUpdate(carrier: unknown): ApplyOutcome;
  flush(): Promise<void>;
  getState(): State;
}

/** Minimal structural shape of the error a failed flush produced (e.g. a PersistenceError). */
export interface PersistLikeError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export interface PersistImportResult {
  readonly applied: true;
  readonly metadata: CapsuleMetadata;
  /** true iff flush() resolved after the apply. */
  readonly persisted: boolean;
  /** Present iff persisted === false (apply succeeded, flush failed). */
  readonly saveError?: PersistLikeError;
}

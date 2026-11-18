/**
 * Raw IndexedDB layer (REQ-BP-003, REQ-BP-006). Dependency-free: one object
 * store, get/put inside a readwrite transaction, durability gated on
 * `transaction.oncomplete` (NOT request `onsuccess`), and `onupgradeneeded`
 * creating the store.
 */
import { PersistenceError } from "./errors.js";
import type { StoredRecord } from "./record.js";

const STORE = "replicas";
const DB_VERSION = 1;

/** A thin wrapper over an open IDBDatabase connection. */
export interface IdbConnection {
  readonly db: IDBDatabase;
  close(): void;
}

/**
 * Open (and if needed upgrade) the IndexedDB database. Rejects with:
 *   - StorageUnavailableError when `indexedDB` is absent;
 *   - BlockedError on `onblocked`;
 *   - DatabaseOpenError on `onerror`.
 *
 * Handles a LATE success after an earlier blocked/error rejection: if the open
 * eventually succeeds, the abandoned connection is CLOSED rather than leaked.
 */
export function openDatabase(dbName: string): Promise<IdbConnection> {
  const idb = globalThis.indexedDB;
  if (idb === undefined || idb === null) {
    return Promise.reject(
      new PersistenceError(
        "StorageUnavailableError",
        "GhostSync Persist: IndexedDB is unavailable in this environment",
      ),
    );
  }

  return new Promise<IdbConnection>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(dbName, DB_VERSION);
    } catch (cause) {
      reject(
        new PersistenceError(
          "StorageUnavailableError",
          "GhostSync Persist: indexedDB.open threw",
          cause,
        ),
      );
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "storageKey" });
      }
    };

    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(
          new PersistenceError(
            "BlockedError",
            "GhostSync Persist: database upgrade blocked by another connection",
          ),
        );
      }
    };

    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(
          new PersistenceError(
            "DatabaseOpenError",
            "GhostSync Persist: failed to open the database",
            request.error,
          ),
        );
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // An earlier onblocked/onerror already rejected; this success arrived
        // LATE — close the abandoned connection rather than leak it.
        db.close();
        return;
      }
      settled = true;
      // Let an upgrade from another tab proceed by closing on versionchange.
      db.onversionchange = () => {
        db.close();
      };
      resolve({
        db,
        close: () => {
          db.close();
        },
      });
    };
  });
}

/** Read a record by key within a readonly transaction. Resolves the raw value. */
export function readRecord(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, "readonly");
    } catch (cause) {
      reject(
        new PersistenceError(
          "DatabaseOpenError",
          "GhostSync Persist: could not open a readonly transaction",
          cause,
        ),
      );
      return;
    }
    const request = tx.objectStore(STORE).get(key);
    let value: unknown;
    let requestError: DOMException | null = null;
    request.onsuccess = () => {
      value = request.result;
    };
    request.onerror = () => {
      // Record the request error for diagnosis, but SETTLE on the transaction's
      // terminal event (oncomplete/onabort) — onerror alone is not terminal.
      requestError = request.error;
    };
    tx.oncomplete = () => {
      resolve(value);
    };
    tx.onabort = () => {
      reject(mapTxError(tx, requestError));
    };
  });
}

/**
 * Optional hook handed the live write `IDBTransaction` the instant it opens, so
 * a caller can TRACK it (and `abort()` it) for lifecycle correctness — e.g. the
 * session aborts or awaits an active write before releasing the Web Lock so a
 * transaction can never complete and publish "saved" after ownership release
 * (fix 2). This is an INTERNAL plumbing parameter, not a public failure-
 * injection API: it only exposes the transaction the write already owns.
 */
export type TransactionHook = (tx: IDBTransaction) => void;

/**
 * Write a record with a read-modify-write generation guard. The write promise
 * SETTLES ONLY on the transaction's TERMINAL event — `tx.oncomplete` (success)
 * or `tx.onabort` (terminal failure) — never on `request.onerror`/`tx.onerror`,
 * which can fire BEFORE the terminal event (and `tx.onerror` precedes
 * `tx.onabort`). Request/transaction errors are recorded and surfaced through
 * the abort rejection. This ordering guarantee lets teardown await the real
 * transaction termination before releasing ownership (fix 2).
 *
 * Reads the stored sequence via the request callback (never as a synchronous
 * returned value), skips the put when the stored sequence is newer-or-equal,
 * and surfaces an abort as TransactionAbortError / QuotaExceededError.
 *
 * Returns `{ written }`: `false` when the stale-write guard skipped the put.
 */
export function writeRecord(
  db: IDBDatabase,
  record: StoredRecord,
  onTransaction?: TransactionHook,
): Promise<{ readonly written: boolean }> {
  return new Promise<{ readonly written: boolean }>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, "readwrite");
    } catch (cause) {
      reject(
        new PersistenceError(
          "DatabaseOpenError",
          "GhostSync Persist: could not open a readwrite transaction",
          cause,
        ),
      );
      return;
    }
    if (onTransaction !== undefined) {
      onTransaction(tx);
    }
    const store = tx.objectStore(STORE);
    let written = false;
    // Capture request/transaction errors as they surface, but NEVER settle the
    // write promise from an `onerror` handler — `request.onerror` and
    // `tx.onerror` can both fire BEFORE the transaction's terminal event, and
    // `tx.onerror` precedes `tx.onabort`. We settle the write lifecycle ONLY on
    // the actual terminal event: `tx.oncomplete` (success) or `tx.onabort`
    // (terminal failure). This guarantees a caller awaiting the write — i.e.
    // teardown awaiting the active transaction before releasing the Web Lock —
    // does not resolve before the transaction has truly terminated (fix 2).
    let firstError: DOMException | null = null;

    // Read the existing record via the request CALLBACK (an async get request is
    // NOT a synchronously returned value), then compare and conditionally put —
    // all inside this single transaction so the compare and the put are atomic.
    const getReq = store.get(record.storageKey);
    getReq.onsuccess = () => {
      const existing = getReq.result as { sequence?: unknown } | undefined;
      const existingSeq =
        existing !== undefined && typeof existing.sequence === "number"
          ? existing.sequence
          : -1;
      if (existingSeq >= record.sequence) {
        // A newer-or-equal snapshot already landed — drop this stale write.
        // `sequence` never regresses.
        return;
      }
      const putReq = store.put(record);
      written = true;
      putReq.onerror = () => {
        if (firstError === null) {
          firstError = putReq.error;
        }
      };
    };
    getReq.onerror = () => {
      if (firstError === null) {
        firstError = getReq.error;
      }
    };

    tx.oncomplete = () => {
      resolve({ written });
    };
    tx.onabort = () => {
      // Terminal failure. If the put was skipped by the guard, `written` stays
      // false; a true abort of an attempted put reports it as written-but-aborted
      // via the rejection regardless.
      reject(mapTxError(tx, firstError));
    };
  });
}

/** Map a transaction error/abort to a typed PersistenceError. */
function mapTxError(tx: IDBTransaction, requestError?: DOMException | null): PersistenceError {
  const err = tx.error ?? requestError ?? null;
  if (err !== null && err.name === "QuotaExceededError") {
    return new PersistenceError(
      "QuotaExceededError",
      "GhostSync Persist: write failed — storage quota exceeded",
      err,
    );
  }
  return new PersistenceError(
    "TransactionAbortError",
    "GhostSync Persist: write transaction aborted",
    err,
  );
}

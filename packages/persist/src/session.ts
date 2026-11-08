/**
 * PersistSession implementation + `openReplica` (REQ-BP-002..006).
 *
 * Lifecycle: `openReplica` acquires the exclusive Web Lock BEFORE reading the
 * record, validates, seeds a fresh public SDK replica through `applyUpdate`,
 * then exposes the session. Saves are single-flight: capture immutable bytes →
 * compute SHA-256 → open a readwrite transaction whose body is purely
 * synchronous (read-compare-put) → resolve durability on `oncomplete`.
 */
import { createKit, type EntityAdapter, type Replica } from "@ghostsync/kit";

import { PersistenceError } from "./errors.js";
import {
  lockName,
  resolveIdentity,
  storageKey,
  type ResolvedIdentity,
} from "./identity.js";
import { acquireExclusiveLock, type AcquiredLock } from "./locks.js";
import { openDatabase, readRecord, writeRecord, type IdbConnection } from "./idb.js";
import {
  buildRecord,
  DEFAULT_MAX_BYTES,
  isValidSequence,
  sha256Hex,
  validateRecord,
  type RecordIdentity,
} from "./record.js";
import type {
  ApplyOutcome,
  ChangeListener,
  ExportDiffResult,
  GuardedCollection,
  OpenOptions,
  PersistSession,
  SaveState,
  SaveStateInfo,
  SaveStateListener,
  Scalar,
  State,
  StateVector,
  TransportUpdate,
  Unsubscribe,
} from "./types.js";

const DEFAULT_DB_NAME = "ghostsync";

/** The session's internal lifecycle beyond the save-state machine. */
type Phase = "open" | "closing" | "closed" | "recovery";

/**
 * Open (or create) a persisted replica. Resolves only after the record is read,
 * validated, and seeded — no handle exists before then (AC-BP-002-2).
 */
export async function openReplica(options: OpenOptions): Promise<PersistSession> {
  const identity = resolveIdentity(options);
  const dbName =
    options.dbName !== undefined && options.dbName.length > 0
      ? options.dbName
      : DEFAULT_DB_NAME;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("GhostSync Persist: maxBytes must be a positive integer");
  }
  const key = storageKey(identity.app, identity.documentId, identity.replicaId);
  const recordIdentity: RecordIdentity = {
    storageKey: key,
    app: identity.app,
    documentId: identity.documentId,
    replicaId: identity.replicaId,
  };

  // (1) Acquire the exclusive lock BEFORE any read. Contention/absence rejects
  //     with zero writes.
  const lock = await acquireExclusiveLock(lockName(dbName, key));

  // (2) Open the database. On failure release the lock (no leaked resources).
  let conn: IdbConnection;
  try {
    conn = await openDatabase(dbName);
  } catch (err) {
    lock.release();
    throw err;
  }

  // (3) Read + validate the stored record, then seed. On ANY failure release the
  //     DB connection and the lock, and leave the stored record untouched.
  let replica: Replica;
  let restored: boolean;
  let initialSequence: number;
  try {
    const raw = await readRecord(conn.db, key);
    if (raw === undefined) {
      // No record — a fresh replica.
      replica = createKit().createReplica(identity.documentId);
      restored = false;
      initialSequence = 0;
    } else {
      const record = await validateRecord(raw, recordIdentity, maxBytes);
      // SEED via the PUBLIC applyUpdate boundary on a fresh accessible replica
      // (clarification 4): create an empty replica, apply the validated stored
      // update, and destroy that ACCESSIBLE replica if the apply rejects — no
      // reliance on cleaning a private Y.Doc inside a thrown constructor.
      const seeded = createKit().createReplica(identity.documentId);
      const outcome = seeded.applyUpdate({
        documentId: identity.documentId,
        bytes: record.bytes,
      });
      if (!outcome.ok) {
        seeded.destroy();
        throw new PersistenceError(
          "InvalidRecordError",
          `GhostSync Persist: stored bytes rejected on seed (${outcome.reason})`,
        );
      }
      replica = seeded;
      restored = true;
      // Initialize the generation counter from the VALIDATED stored sequence.
      initialSequence = isValidSequence(record.sequence) ? record.sequence : 0;
    }
  } catch (err) {
    conn.close();
    lock.release();
    throw err;
  }

  return new PersistSessionImpl(
    replica,
    identity,
    key,
    recordIdentity,
    conn,
    lock,
    restored,
    initialSequence,
    maxBytes,
    options.onStateChange,
  );
}

class PersistSessionImpl implements PersistSession {
  readonly #replica: Replica;
  readonly identity: ResolvedIdentity;
  readonly storageKey: string;
  readonly #recordIdentity: RecordIdentity;
  #conn: IdbConnection | undefined;
  #lock: AcquiredLock | undefined;
  readonly restored: boolean;
  readonly #maxBytes: number;

  #phase: Phase = "open";
  #state: SaveState;

  /** Monotonic generation counter, initialized from the stored sequence. */
  #generation: number;
  /** Last durably persisted generation. */
  #persistedSequence: number;
  /** The newest edit's generation (set when a mutation marks dirty). */
  #dirtyGeneration: number;
  /** The generation currently being written (0 when idle). */
  #savingGeneration = 0;

  /** Single-flight save promise (undefined when idle). */
  #inFlight: Promise<void> | undefined;
  /** Whether a follow-up save is needed after the in-flight one settles. */
  #followUp = false;
  /** The live write transaction (undefined when none is open). */
  #activeTx: IDBTransaction | undefined;
  /**
   * Set once terminal teardown begins. A save continuation that resumes after an
   * await (hash/transaction) MUST NOT write, advance the marker, or publish state
   * once this is true — ownership is being released (fix 2).
   */
  #terminating = false;

  readonly #listeners = new Set<SaveStateListener>();
  #unsubscribeLocal: Unsubscribe | undefined;
  #lifecycleCleanup: (() => void) | undefined;

  /** Waiters for flush(): resolve when `targetGeneration` is persisted. */
  readonly #flushWaiters: Array<{
    readonly targetGeneration: number;
    readonly resolve: () => void;
    readonly reject: (err: unknown) => void;
  }> = [];

  #lastError: PersistenceError | undefined;

  /**
   * The in-progress terminal teardown (a successful close()'s release phase or a
   * dispose()). Shared so CONCURRENT close()/dispose() calls settle on the SAME
   * release rather than racing or hanging (fix 2). Cleared is never needed —
   * once terminal release starts, the phase becomes "closed".
   */
  #terminalRelease: Promise<void> | undefined;

  constructor(
    replica: Replica,
    identity: ResolvedIdentity,
    key: string,
    recordIdentity: RecordIdentity,
    conn: IdbConnection,
    lock: AcquiredLock,
    restored: boolean,
    initialSequence: number,
    maxBytes: number,
    onStateChange: SaveStateListener | undefined,
  ) {
    this.#replica = replica;
    this.identity = identity;
    this.storageKey = key;
    this.#recordIdentity = recordIdentity;
    this.#conn = conn;
    this.#lock = lock;
    this.restored = restored;
    this.#maxBytes = maxBytes;
    this.#generation = initialSequence;
    this.#persistedSequence = initialSequence;
    this.#dirtyGeneration = initialSequence;
    this.#state = "saved";

    if (onStateChange !== undefined) {
      this.#listeners.add(onStateChange);
    }

    // Supplement for LOCAL edits: mark dirty on local-origin change events. The
    // authoritative import guarantee is the routed applyUpdate return value.
    this.#unsubscribeLocal = replica.subscribe((event) => {
      if (event.origin === "local") {
        this.#markDirty();
      }
    });

    this.#installLifecycleHandlers();
  }

  get state(): SaveState {
    return this.#state;
  }

  // --- guards ---

  #assertMutable(): void {
    if (this.#phase === "open") {
      return;
    }
    throw new PersistenceError(
      "ClosedError",
      this.#phase === "recovery"
        ? "GhostSync Persist: session is recovery-only after a failed close()"
        : "GhostSync Persist: session is closed",
    );
  }

  #assertReadable(): void {
    // Reads/exports work while open AND in recovery-only; only a successful
    // close/dispose makes them reject.
    if (this.#phase === "closed") {
      throw new PersistenceError("ClosedError", "GhostSync Persist: session is closed");
    }
  }

  // --- reads / exports ---

  get(key: string): Scalar | undefined {
    this.#assertReadable();
    return this.#replica.get(key);
  }

  has(key: string): boolean {
    this.#assertReadable();
    return this.#replica.has(key);
  }

  getState(): State {
    this.#assertReadable();
    return this.#replica.getState();
  }

  exportState(): TransportUpdate {
    this.#assertReadable();
    return this.#replica.exportState();
  }

  exportStateVector(): StateVector {
    this.#assertReadable();
    return this.#replica.exportStateVector();
  }

  exportDiff(remoteStateVector: unknown): ExportDiffResult {
    this.#assertReadable();
    return this.#replica.exportDiff(remoteStateVector);
  }

  exportBytes(): Uint8Array {
    if (this.#phase === "closed") {
      throw new PersistenceError("ClosedError", "GhostSync Persist: session is closed");
    }
    return this.#replica.exportState().bytes;
  }

  subscribe(listener: ChangeListener): Unsubscribe {
    this.#assertReadable();
    return this.#replica.subscribe(listener);
  }

  /**
   * Open a GUARDED collection. Opening the collection is a MUTATION (the Kit
   * writes schema meta on first open), so it is rejected when not mutable.
   */
  collection<T>(adapter: EntityAdapter<T>): GuardedCollection<T> {
    this.#assertMutable();
    const inner = this.#replica.collection(adapter);
    const markDirty = () => this.#markDirty();
    const assertMutable = () => this.#assertMutable();
    const assertReadable = () => this.#assertReadable();
    return {
      put(id: string, entity: T): void {
        assertMutable();
        inner.put(id, entity);
        markDirty();
      },
      delete(id: string): void {
        assertMutable();
        inner.delete(id);
        markDirty();
      },
      // Reads pass through the session's READABLE guard (fix 4): a handle
      // captured while open — including this one — returns a TYPED ClosedError
      // after a terminal close/dispose instead of a raw destroyed-Yjs-doc error,
      // while recovery-only reads (after a FAILED close) stay allowed.
      get: (id) => {
        assertReadable();
        return inner.get(id);
      },
      getResult: (id) => {
        assertReadable();
        return inner.getResult(id);
      },
      list: () => {
        assertReadable();
        return inner.list();
      },
      listResults: () => {
        assertReadable();
        return inner.listResults();
      },
      has: (id) => {
        assertReadable();
        return inner.has(id);
      },
    };
  }

  // --- local edits ---

  set(key: string, value: Scalar): void {
    this.#assertMutable();
    this.#replica.set(key, value);
    this.#markDirty();
  }

  delete(key: string): void {
    this.#assertMutable();
    this.#replica.delete(key);
    this.#markDirty();
  }

  // --- routed import (the only supported import path) ---

  applyUpdate(carrier: unknown): ApplyOutcome {
    this.#assertMutable();
    const outcome = this.#replica.applyUpdate(carrier);
    if (outcome.ok) {
      // Persist EVERY accepted update — including an out-of-order (pending)
      // accept and a no-op accept that fires NO change notification.
      this.#markDirty();
    }
    return outcome;
  }

  // --- save-state machine ---

  #markDirty(): void {
    if (this.#phase === "closed" || this.#phase === "recovery") {
      return;
    }
    this.#dirtyGeneration = ++this.#generation;
    this.#setState("dirty");
    this.#scheduleSave();
  }

  #scheduleSave(): void {
    if (this.#inFlight !== undefined) {
      // A save is running; mark that another one is needed afterwards.
      this.#followUp = true;
      return;
    }
    this.#inFlight = this.#runSave();
  }

  async #runSave(): Promise<void> {
    try {
      while (true) {
        // Ownership released (dispose/successful close) — no queued continuation
        // may touch the replica or write after release.
        if (this.#conn === undefined) {
          break;
        }
        this.#followUp = false;
        const targetGeneration = this.#dirtyGeneration;
        // Nothing newer than what is already persisted — done.
        if (targetGeneration <= this.#persistedSequence) {
          break;
        }
        await this.#saveOnce(targetGeneration);
        // A failed save must NOT auto-retry in a tight loop — retry is
        // caller-triggered on the next flush()/dirty mark (REQ-BP-003-6).
        if (this.#state === "error") {
          break;
        }
        // If more edits arrived during the save, loop again.
        if (!this.#followUp && this.#dirtyGeneration <= this.#persistedSequence) {
          break;
        }
      }
    } finally {
      // Clear the in-flight marker FIRST so the coordination step below can
      // schedule a fresh worker.
      this.#inFlight = undefined;
      // COORDINATE flush-waiter settlement with worker cleanup (fix 1): a
      // retry flush() that arrived WHILE this worker was unwinding sees
      // `#inFlight` still set and declines to schedule, so its waiter is now
      // stranded here. Service it by starting a fresh save (which re-attempts
      // the write and will resolve on success or reject again on repeated
      // failure). This runs only while the session still owns its connection
      // and is not tearing down — teardown rejects every waiter itself.
      if (
        this.#conn !== undefined &&
        !this.#terminating &&
        this.#hasPendingFlushWaiter()
      ) {
        this.#scheduleSave();
      }
    }
  }

  /** Whether any flush waiter targets a generation that is not yet persisted. */
  #hasPendingFlushWaiter(): boolean {
    for (const waiter of this.#flushWaiters) {
      if (waiter.targetGeneration > this.#persistedSequence) {
        return true;
      }
    }
    return false;
  }

  async #saveOnce(generation: number): Promise<void> {
    // Ownership may have been released (or be releasing) between scheduling and
    // now — never start a new save once terminal teardown has begun.
    if (this.#conn === undefined || this.#terminating) {
      return;
    }
    this.#savingGeneration = generation;
    this.#setState("saving");

    // Capture an IMMUTABLE snapshot of the bytes for THIS generation.
    const captured = this.#replica.exportState().bytes.slice();

    // Enforce maxBytes BEFORE writing: never report saving a snapshot the next
    // open would reject as oversized. Preserve in-memory data; expose the error.
    if (captured.length > this.#maxBytes) {
      this.#failSave(
        new PersistenceError(
          "QuotaExceededError",
          `GhostSync Persist: snapshot exceeds maxBytes (${captured.length} > ${this.#maxBytes})`,
        ),
        generation,
      );
      return;
    }

    // Compute SHA-256 BEFORE opening the write transaction.
    let checksum: string;
    try {
      checksum = await sha256Hex(captured);
    } catch (cause) {
      this.#failSave(
        new PersistenceError("TransactionAbortError", "GhostSync Persist: checksum failed", cause),
        generation,
      );
      return;
    }

    const conn = this.#conn;
    if (conn === undefined || this.#terminating) {
      // Disposed/closed (or terminating) mid-hash — do NOT open a write
      // transaction after (or during) ownership release.
      return;
    }

    const record = buildRecord(this.#recordIdentity, captured, generation, checksum);
    let result: { readonly written: boolean };
    try {
      result = await writeRecord(conn.db, record, (tx) => {
        // Track the live transaction so terminal teardown can ABORT or
        // AWAIT-SETTLE it before releasing the Web Lock (fix 2).
        this.#activeTx = tx;
      });
    } catch (cause) {
      this.#activeTx = undefined;
      this.#failSave(
        cause instanceof PersistenceError
          ? cause
          : new PersistenceError("TransactionAbortError", "GhostSync Persist: write failed", cause),
        generation,
      );
      return;
    }

    // The transaction has settled (oncomplete) — stop tracking it.
    this.#activeTx = undefined;

    // Disposed/closed (or terminating) while the write transaction ran — do NOT
    // publish "saved" or advance the persisted marker after ownership release
    // (fix 2). Terminal teardown awaited this transaction's settlement, so the
    // record on disk is consistent; we simply do not announce it post-release.
    if (this.#conn === undefined || this.#terminating) {
      return;
    }

    if (!result.written) {
      // The transaction completed but the stale-generation guard SKIPPED the put
      // because a NEWER-or-equal record already sits on disk. THIS generation's
      // bytes never reached storage, so we must NOT claim them saved. Reporting
      // "saved" here would lose the current edit on reopen (fix 3). Surface an
      // explicit conflict, preserve the in-memory edit AND the newer stored
      // record (no clobber), and let a caller-triggered retry re-attempt it.
      this.#failSave(
        new PersistenceError(
          "TransactionAbortError",
          "GhostSync Persist: write skipped — a newer snapshot already exists on disk (stale-generation conflict)",
        ),
        generation,
      );
      return;
    }

    // Durable (oncomplete) AND actually written. Advance the persisted marker to
    // THIS generation. An OLDER transaction completing never reports the whole
    // session saved if a NEWER edit remains pending.
    if (generation > this.#persistedSequence) {
      this.#persistedSequence = generation;
    }
    this.#lastError = undefined;

    const sessionFullySaved = this.#dirtyGeneration <= this.#persistedSequence;
    if (sessionFullySaved) {
      this.#setState("saved");
    } else {
      // A newer edit is still pending — stay out of "saved" and keep working.
      this.#setState("dirty");
    }
    this.#resolveFlushWaiters();
  }

  #failSave(error: PersistenceError, generation: number): void {
    this.#lastError = error;
    this.#savingGeneration = 0;
    this.#setState("error");
    // Dirty data is RETAINED: `#dirtyGeneration` stays ahead of
    // `#persistedSequence`, so a later retry (next flush/dirty) re-attempts it.
    void generation;
    this.#rejectFlushWaiters(error);
  }

  #setState(next: SaveState): void {
    this.#state = next;
    // Once terminal teardown has begun, do NOT emit state notifications: a save
    // routine unwinding against an aborted transaction must not publish a late
    // "saved"/"error" after ownership release (fix 2).
    if (this.#terminating) {
      return;
    }
    const info: SaveStateInfo =
      next === "error" && this.#lastError !== undefined
        ? { sequence: this.#persistedSequence, error: this.#lastError }
        : { sequence: this.#persistedSequence };
    for (const listener of [...this.#listeners]) {
      try {
        listener(next, info);
      } catch {
        // Isolate onStateChange callback exceptions from persistence outcomes.
      }
    }
  }

  onStateChange(listener: SaveStateListener): Unsubscribe {
    // Registering a NEW save-state subscription after a terminal close/dispose
    // is rejected with a typed ClosedError — consistent with the read/subscribe
    // guards (#assertReadable). Recovery-only (after a FAILED close) still
    // allows registration so a caller can observe a retry. (fix 3)
    this.#assertReadable();
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.#listeners.delete(listener);
    };
  }

  // --- flush ---

  flush(): Promise<void> {
    if (this.#phase === "closed" || this.#phase === "recovery") {
      return Promise.reject(
        new PersistenceError("ClosedError", "GhostSync Persist: session is not writable"),
      );
    }
    // flush() covers edits accepted BEFORE this call.
    const target = this.#dirtyGeneration;
    if (target <= this.#persistedSequence) {
      return Promise.resolve();
    }
    // Register the waiter BEFORE triggering a save. A save can fail (or succeed)
    // SYNCHRONOUSLY before its first await — e.g. the pre-write maxBytes check in
    // #saveOnce — which settles flush waiters inline. If the waiter were pushed
    // after #scheduleSave(), that synchronous settlement would run against an
    // empty waiter list and this promise would hang forever (fix 1).
    return new Promise<void>((resolve, reject) => {
      this.#flushWaiters.push({ targetGeneration: target, resolve, reject });
      // Ensure a save is scheduled even if none is in flight (e.g. after error).
      if (this.#inFlight === undefined) {
        this.#scheduleSave();
      }
    });
  }

  #resolveFlushWaiters(): void {
    for (let i = this.#flushWaiters.length - 1; i >= 0; i--) {
      const waiter = this.#flushWaiters[i];
      if (waiter !== undefined && waiter.targetGeneration <= this.#persistedSequence) {
        this.#flushWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  #rejectFlushWaiters(error: PersistenceError): void {
    // Only reject waiters whose target cannot yet be satisfied.
    for (let i = this.#flushWaiters.length - 1; i >= 0; i--) {
      const waiter = this.#flushWaiters[i];
      if (waiter !== undefined && waiter.targetGeneration > this.#persistedSequence) {
        this.#flushWaiters.splice(i, 1);
        waiter.reject(error);
      }
    }
  }

  // --- close / dispose ---

  async close(): Promise<void> {
    if (this.#phase === "closed") {
      return; // idempotent: a successful close stays closed
    }
    // A terminal release (from a concurrent close()/dispose()) is already in
    // progress — settle on the SAME teardown instead of racing it (fix 2).
    if (this.#terminalRelease !== undefined) {
      return this.#terminalRelease;
    }
    if (this.#phase === "recovery") {
      // A prior close() failed; close() again rejects (dispose releases).
      throw new PersistenceError(
        "CloseFailedError",
        "GhostSync Persist: session is recovery-only; call dispose() to release",
      );
    }
    // Prevent further mutations as soon as closing begins.
    this.#phase = "closing";

    // Flush all edits accepted before closing.
    try {
      await this.#drainToPersisted();
    } catch (error) {
      // A concurrent dispose() may have begun terminal teardown while we drained
      // — if so, settle on it rather than entering recovery.
      if (this.#terminalRelease !== undefined) {
        return this.#terminalRelease;
      }
      // Final save failed → recovery-only. RETAIN the session + lock; keep
      // exportBytes() and read access available.
      this.#phase = "recovery";
      throw error instanceof PersistenceError
        ? new PersistenceError("CloseFailedError", "GhostSync Persist: final save failed", error)
        : new PersistenceError("CloseFailedError", "GhostSync Persist: final save failed", error);
    }

    // A concurrent dispose() may have started terminal teardown during the drain.
    if (this.#terminalRelease !== undefined) {
      return this.#terminalRelease;
    }

    // Success: release resources + ownership, then every op rejects ClosedError.
    const release = this.#releaseResources();
    this.#terminalRelease = release;
    await release;
    this.#phase = "closed";
  }

  async dispose(): Promise<void> {
    if (this.#phase === "closed") {
      return; // already released
    }
    // Settle on an in-progress terminal release (concurrent close()/dispose()).
    if (this.#terminalRelease !== undefined) {
      return this.#terminalRelease;
    }
    // Explicit, IDEMPOTENT, NON-durable discard. Prevent further mutation and
    // release resources/ownership WITHOUT claiming unsaved data was saved.
    this.#phase = "closing";
    const release = this.#releaseResources();
    this.#terminalRelease = release;
    await release;
    this.#phase = "closed";
  }

  /** Drain pending saves until the latest dirty generation is persisted. */
  async #drainToPersisted(): Promise<void> {
    // Give one final save attempt a chance (retry after a prior error), then
    // surface any failure — never loop a failing save forever.
    while (this.#dirtyGeneration > this.#persistedSequence) {
      // A concurrent dispose() began terminal teardown (ownership is being
      // released) — stop draining; the terminal release settles this close()
      // on the shared #terminalRelease (fix 2). Looping here would spin forever
      // because #saveOnce now short-circuits on #conn === undefined/#terminating.
      if (this.#terminating || this.#conn === undefined) {
        return;
      }
      if (this.#inFlight === undefined) {
        // Only (re)schedule if we have not just failed this generation.
        if (this.#state === "error") {
          throw this.#lastError ??
            new PersistenceError("CloseFailedError", "GhostSync Persist: save failed during close");
        }
        this.#scheduleSave();
      }
      const inFlight = this.#inFlight;
      if (inFlight === undefined) {
        break;
      }
      await inFlight;
      if (this.#state === "error" && this.#dirtyGeneration > this.#persistedSequence) {
        throw this.#lastError ??
          new PersistenceError("CloseFailedError", "GhostSync Persist: save failed during close");
      }
    }
  }

  /**
   * Terminal teardown. ORDER MATTERS (fix 2):
   *   1. Mark terminating + cancel continuations so no resumed save writes or
   *      publishes state after this point.
   *   2. Finish any ACTIVE write transaction — abort it (dispose: discard) or
   *      await its settlement — BEFORE touching the connection or the lock, so a
   *      transaction can never complete and flip state to "saved" after release.
   *   3. Await the in-flight save routine's own unwinding.
   *   4. Tear down subscriptions/listeners/replica/connection.
   *   5. Release the Web Lock and AWAIT its actual release so a same-key reopen
   *      that races the disposal can acquire the lock (proves it was freed).
   */
  async #releaseResources(): Promise<void> {
    // (1) Cancel continuations: drop the connection reference first so a resumed
    //     #saveOnce sees it undefined, and set #terminating so no post-await
    //     branch advances the marker or publishes "saved".
    this.#terminating = true;
    const conn = this.#conn;
    this.#conn = undefined;

    if (this.#unsubscribeLocal !== undefined) {
      this.#unsubscribeLocal();
      this.#unsubscribeLocal = undefined;
    }
    if (this.#lifecycleCleanup !== undefined) {
      this.#lifecycleCleanup();
      this.#lifecycleCleanup = undefined;
    }

    // (2) Finish an active write transaction before releasing ownership. Abort
    //     it so it cannot commit-then-notify after disposal; a benign
    //     "already finished" throw is ignored. The in-flight save awaits the
    //     transaction's abort/complete event, so step (3) settles it.
    const activeTx = this.#activeTx;
    if (activeTx !== undefined) {
      try {
        activeTx.abort();
      } catch {
        // The transaction may have already completed/aborted — nothing to do.
      }
    }

    // (3) Await the in-flight save routine so its transaction event has fired
    //     and it has fully unwound (it will not write/publish — see #terminating
    //     and the #conn === undefined guards).
    const inFlight = this.#inFlight;
    if (inFlight !== undefined) {
      try {
        await inFlight;
      } catch {
        // Save rejections during teardown are expected (aborted txn) — swallow.
      }
    }
    this.#activeTx = undefined;

    // (4) Reject any outstanding flush waiters — the session is going away.
    for (const waiter of this.#flushWaiters.splice(0)) {
      waiter.reject(
        new PersistenceError("ClosedError", "GhostSync Persist: session closed during flush"),
      );
    }
    this.#listeners.clear();
    this.#replica.destroy();
    if (conn !== undefined) {
      conn.close();
    }

    // (5) Release the Web Lock and AWAIT the manager actually freeing it, so a
    //     same-key reopen immediately after disposal can acquire it.
    if (this.#lock !== undefined) {
      const lock = this.#lock;
      this.#lock = undefined;
      await lock.release();
    }
  }

  // --- page lifecycle best-effort flush ---

  #installLifecycleHandlers(): void {
    const target = globalThis as unknown as {
      addEventListener?: (type: string, handler: () => void) => void;
      removeEventListener?: (type: string, handler: () => void) => void;
      document?: { visibilityState?: string };
    };
    if (typeof target.addEventListener !== "function") {
      return;
    }
    const onPageHide = (): void => {
      // Best-effort only — no durability promise on unload (AC-BP-003-8).
      if (this.#phase === "open" && this.#dirtyGeneration > this.#persistedSequence) {
        if (this.#inFlight === undefined) {
          this.#scheduleSave();
        }
      }
    };
    const onVisibility = (): void => {
      if (target.document?.visibilityState === "hidden") {
        onPageHide();
      }
    };
    target.addEventListener("pagehide", onPageHide);
    target.addEventListener("visibilitychange", onVisibility);
    this.#lifecycleCleanup = () => {
      target.removeEventListener?.("pagehide", onPageHide);
      target.removeEventListener?.("visibilitychange", onVisibility);
    };
  }
}

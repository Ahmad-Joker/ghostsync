/**
 * Exclusive, non-waiting Web Locks acquisition (REQ-BP-005).
 *
 * The lock is held for the WHOLE session lifetime by keeping the
 * `navigator.locks.request` callback's promise pending until the holder calls
 * `release()`. We use `{ mode: "exclusive", ifAvailable: true }` — a NON-waiting
 * acquisition with NO silent unlocked fallback:
 *   - `navigator.locks` absent        → UnsupportedEnvironmentError
 *   - callback receives `null` (held) → StorageInUseError (zero writes)
 *
 * The lock is acquired BEFORE reading/restoring the record and released only on
 * a successful close()/dispose() or page unload.
 */
import { PersistenceError } from "./errors.js";

export interface AcquiredLock {
  /**
   * Release the lock (idempotent). Resolving the held promise frees it. The
   * returned promise settles once the Web Locks manager has ACTUALLY released
   * the lock (the `navigator.locks.request` promise completing), so a caller
   * can await real release before resolving a terminal disposal (fix 2).
   */
  release(): Promise<void>;
}

/**
 * Acquire the exclusive lock for `name`, or reject. Resolves only once the lock
 * is actually held. The returned `release()` resolves the inner promise so the
 * Web Locks manager frees the lock.
 */
export function acquireExclusiveLock(name: string): Promise<AcquiredLock> {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) {
    return Promise.reject(
      new PersistenceError(
        "UnsupportedEnvironmentError",
        "GhostSync Persist: navigator.locks is unavailable (no unprotected fallback)",
      ),
    );
  }

  return new Promise<AcquiredLock>((resolveOuter, rejectOuter) => {
    let release!: () => void;
    // The promise returned to Web Locks stays pending until `release` is called.
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });

    let settled = false;

    const requestResult = locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      (lock: Lock | null): Promise<void> => {
        if (lock === null) {
          // Another session owns the key — reject with zero writes.
          settled = true;
          rejectOuter(
            new PersistenceError(
              "StorageInUseError",
              "GhostSync Persist: another session owns the exclusive lock for this key",
            ),
          );
          return Promise.resolve();
        }
        // We hold the lock. Hand the release handle to the caller and keep the
        // lock until they release it. `release()` resolves the held promise AND
        // returns the request promise, which the manager settles only after it
        // has actually freed the lock — so a caller can await real release.
        settled = true;
        resolveOuter({
          release: (): Promise<void> => {
            release();
            // Swallow any request rejection: for release purposes we only care
            // that the manager has finished with the lock.
            return requestResult.then(
              () => undefined,
              () => undefined,
            );
          },
        });
        return held;
      },
    );

    // If the request itself rejects (e.g. a SecurityError) before the callback
    // runs, surface it as a DatabaseOpenError-adjacent unsupported condition.
    requestResult.catch((cause: unknown) => {
      if (!settled) {
        settled = true;
        rejectOuter(
          new PersistenceError(
            "UnsupportedEnvironmentError",
            "GhostSync Persist: Web Locks request failed",
            cause,
          ),
        );
      }
    });
  });
}

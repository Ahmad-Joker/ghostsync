/**
 * TEST-ONLY instrumentation (NODE unit tests) for fix 2: a one-shot real
 * IndexedDB transaction abort plus observers that record the ORDER of the
 * terminal transaction event, the Web Lock release, and dispose resolution.
 *
 * This lives entirely in test support — the shipped `@ghostsync/persist`
 * package exposes NO production failure-injection API. It mirrors the browser
 * harness's `armWriteAbortOnce` so the Node suite can deterministically exercise
 * the terminal-event ordering without a browser.
 */

/** A shared, append-only log of lifecycle events in the order they occur. */
export type EventLog = string[];

export interface ArmedWriteAbort {
  /** Resolves the instant the instrumented write transaction's put is enqueued
   *  (and the abort has been requested) — so a test can deterministically
   *  dispose WHILE the transaction is the session's active write. */
  readonly aborting: Promise<void>;
  /** Restore the prototype and disarm. */
  restore(): void;
}

/**
 * Arm a ONE-SHOT abort of the next readwrite transaction opened on ANY
 * connection. After the first underlying `put` is enqueued the live transaction
 * is aborted — a genuine mid-transaction abort (`tx.onabort` fires;
 * `tx.oncomplete` never does). When it aborts, "tx:abort" is appended to `log`,
 * and the returned `aborting` promise resolves right after the abort is
 * requested so the caller can dispose while the write is active.
 */
export function armWriteAbortOnce(log: EventLog): ArmedWriteAbort {
  const proto = IDBDatabase.prototype;
  const realTransaction = proto.transaction;
  let armed = true;
  let signalAborting!: () => void;
  const aborting = new Promise<void>((resolve) => {
    signalAborting = resolve;
  });

  proto.transaction = function patchedTransaction(
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase["transaction"]>
  ): IDBTransaction {
    const tx = realTransaction.apply(this, args);
    const mode = args[1];
    if (armed && mode === "readwrite") {
      armed = false;
      // Use addEventListener (not onabort) so this observer STACKS with the
      // handler writeRecord installs rather than being overwritten by it.
      tx.addEventListener("abort", () => {
        log.push("tx:abort");
      });
      const realObjectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name: string): IDBObjectStore => {
        const store = realObjectStore(name);
        const realPut = store.put.bind(store);
        store.put = (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
          const req = realPut(value as never, key as never);
          try {
            tx.abort();
          } catch {
            // Already settling — ignore.
          }
          signalAborting();
          return req;
        };
        return store;
      };
    }
    return tx;
  } as IDBDatabase["transaction"];

  return {
    aborting,
    restore: () => {
      armed = false;
      proto.transaction = realTransaction;
    },
  };
}

/**
 * Wrap `navigator.locks.request` so that when the held lock's callback promise
 * resolves (the manager actually frees the lock), "lock:release" is appended to
 * `log`. Returns a restore function.
 */
export function observeLockRelease(log: EventLog): () => void {
  const locks = globalThis.navigator.locks as {
    request: (
      name: string,
      options: unknown,
      callback: (lock: unknown) => Promise<void> | void,
    ) => Promise<unknown>;
  };
  const realRequest = locks.request.bind(locks);
  locks.request = (
    name: string,
    options: unknown,
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown> => {
    const wrapped = (lock: unknown): Promise<void> | void => {
      const result = callback(lock);
      if (lock !== null && result instanceof Promise) {
        // The held promise resolves when the holder releases — record it.
        return result.then(() => {
          log.push("lock:release");
        });
      }
      return result;
    };
    return realRequest(name, options, wrapped);
  };
  return () => {
    locks.request = realRequest as typeof locks.request;
  };
}

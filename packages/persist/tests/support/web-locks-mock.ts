/**
 * Minimal single-process Web Locks mock for NODE UNIT TESTS ONLY (NOT acceptance
 * evidence). It implements exactly the slice the package uses:
 * `navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, cb)`.
 *
 * The real `navigator.locks` API in Chromium is the ACCEPTANCE target; this mock
 * exists so the codec / generation / state-machine unit suite can run under
 * Node. Contention semantics (exclusive, non-waiting `ifAvailable`) are
 * reproduced; nothing else.
 */

interface MockLockOptions {
  readonly mode?: "exclusive" | "shared";
  readonly ifAvailable?: boolean;
}

type MockLock = { readonly name: string; readonly mode: "exclusive" | "shared" };

class MockLockManager {
  readonly #held = new Set<string>();

  async request(
    name: string,
    options: MockLockOptions,
    callback: (lock: MockLock | null) => Promise<void> | void,
  ): Promise<void> {
    const ifAvailable = options.ifAvailable === true;
    if (this.#held.has(name)) {
      if (ifAvailable) {
        // Non-waiting: invoke with null, let the callback settle, resolve.
        await callback(null);
        return;
      }
      // We never use the waiting path; fail fast to catch misuse.
      throw new Error("web-locks-mock: waiting acquisition is not implemented");
    }
    this.#held.add(name);
    try {
      await callback({ name, mode: options.mode ?? "exclusive" });
    } finally {
      this.#held.delete(name);
    }
  }
}

/** Install the mock on `globalThis.navigator.locks` (idempotent per process). */
export function installWebLocksMock(): void {
  const g = globalThis as unknown as { navigator?: { locks?: unknown } };
  const manager = new MockLockManager();
  if (g.navigator === undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: { locks: manager },
      configurable: true,
      writable: true,
    });
    return;
  }
  if (g.navigator.locks === undefined) {
    try {
      Object.defineProperty(g.navigator, "locks", {
        value: manager,
        configurable: true,
        writable: true,
      });
    } catch {
      // navigator may be read-only; replace the whole object.
      Object.defineProperty(globalThis, "navigator", {
        value: { ...g.navigator, locks: manager },
        configurable: true,
        writable: true,
      });
    }
  }
}

/**
 * Reset helper for the fake-indexeddb-backed unit tests. Each test opens its own
 * db name to stay isolated, but this clears a named db when needed.
 */
export function deleteDb(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

let counter = 0;
/** A unique db name per call, so parallel tests never share storage. */
export function uniqueDbName(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

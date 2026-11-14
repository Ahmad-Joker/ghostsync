/** Per (profile, document) stable replica ID over an injected key-value store (AC-PB-002-2/3/6). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function replicaStorageKey(documentId: string): string {
  return `patchboard.replicaId.v1.${documentId}`;
}

/** Storage errors propagate to the caller (AC-PB-002-7). */
export function getOrCreateReplicaId(
  store: KeyValueStore,
  documentId: string,
  randomUUID: () => string,
): string {
  const key = replicaStorageKey(documentId);
  const existing = store.getItem(key);
  if (existing !== null && UUID_RE.test(existing)) return existing;
  const created = randomUUID();
  store.setItem(key, created);
  return created;
}

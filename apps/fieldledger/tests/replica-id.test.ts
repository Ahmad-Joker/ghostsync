import { describe, expect, it } from "vitest";
import { getOrCreateReplicaId, replicaStorageKey, type KeyValueStore } from "../src/identity/replica-id.js";

const mem = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const UUID_A = "3f9a1c2e-0000-4000-8000-000000000001";
const UUID_B = "3f9a1c2e-0000-4000-8000-000000000002";

describe("replica id store", () => {
  it("generates once and reuses it on reopen", () => {
    const s = mem();
    let n = 0;
    const gen = (): string => (n++ === 0 ? UUID_A : UUID_B);
    expect(getOrCreateReplicaId(s, "inc-1234", gen)).toBe(UUID_A);
    expect(getOrCreateReplicaId(s, "inc-1234", gen)).toBe(UUID_A);
    expect(n).toBe(1);
  });
  it("is distinct per document and keyed per document", () => {
    const s = mem();
    let n = 0;
    const gen = (): string => (n++ === 0 ? UUID_A : UUID_B);
    expect(getOrCreateReplicaId(s, "inc-1111", gen)).toBe(UUID_A);
    expect(getOrCreateReplicaId(s, "inc-2222", gen)).toBe(UUID_B);
    expect(replicaStorageKey("inc-1111")).toBe("fieldledger.replicaId.v1.inc-1111");
  });
  it("regenerates a missing or malformed stored value", () => {
    const s = mem();
    s.data.set(replicaStorageKey("inc-1234"), "not-a-uuid");
    expect(getOrCreateReplicaId(s, "inc-1234", () => UUID_B)).toBe(UUID_B);
    expect(s.data.get(replicaStorageKey("inc-1234"))).toBe(UUID_B);
  });
  it("does not swallow storage errors", () => {
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(() => getOrCreateReplicaId(bad, "inc-1234", () => UUID_A)).toThrow("SecurityError");
  });
});
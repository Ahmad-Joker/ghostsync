import { describe, expect, it } from "vitest";
import { getOrCreateReplicaId, replicaStorageKey, type KeyValueStore } from "../src/identity/replica-id.js";

function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const UUID_A = "0a1b2c3d-1111-4222-8333-444455556666";
const UUID_B = "9f8e7d6c-1111-4222-8333-444455556666";

describe("U-PB-02 replica id", () => {
  it("is stable across reopen for one board", () => {
    const s = store();
    const first = getOrCreateReplicaId(s, "board-one", () => UUID_A);
    expect(first).toBe(UUID_A);
    expect(getOrCreateReplicaId(s, "board-one", () => UUID_B)).toBe(UUID_A);
    expect(s.data.get(replicaStorageKey("board-one"))).toBe(UUID_A);
  });
  it("is distinct per board", () => {
    const s = store();
    expect(getOrCreateReplicaId(s, "board-one", () => UUID_A)).toBe(UUID_A);
    expect(getOrCreateReplicaId(s, "board-two", () => UUID_B)).toBe(UUID_B);
  });
  it("replaces a malformed stored value", () => {
    const s = store();
    s.data.set(replicaStorageKey("board-one"), "not-a-uuid");
    expect(getOrCreateReplicaId(s, "board-one", () => UUID_A)).toBe(UUID_A);
    expect(s.data.get(replicaStorageKey("board-one"))).toBe(UUID_A);
  });
  it("propagates storage errors", () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(() => getOrCreateReplicaId(throwing, "board-one", () => UUID_A)).toThrow("blocked");
  });
});
/**
 * REQ-BP-001 — storage key escaping / collision. Pins expected key strings so
 * any drift in the copied esc/SEP codec is caught (NIT-5 ownership note).
 * Node unit — fast feedback, NOT acceptance evidence.
 */
import { describe, expect, it } from "vitest";

import { esc, lockName, resolveIdentity, SEP, storageKey } from "../src/identity.js";

describe("storageKey (REQ-BP-001)", () => {
  it("joins escaped components with SEP in a pinned format", () => {
    expect(storageKey("fieldledger", "incident-42", "r1")).toBe(
      "fieldledger" + SEP + "incident-42" + SEP + "r1",
    );
  });

  it("escapes the three reserved bytes so names cannot forge a separator", () => {
    // A documentId containing a raw SEP must be escaped (NUL + SEP), so it cannot
    // split the key into extra components.
    const key = storageKey("app", "a" + SEP + "b", "r");
    expect(key).toBe("app" + SEP + "a\u0000\u001fb" + SEP + "r");
  });

  it("maps distinct triples to distinct keys (no collision)", () => {
    // ("a", "b\u001fc", "r") vs ("a\u001fb", "c", "r") would collide without
    // escaping; with escaping they must differ.
    const k1 = storageKey("a", "b" + SEP + "c", "r");
    const k2 = storageKey("a" + SEP + "b", "c", "r");
    expect(k1).not.toBe(k2);
  });

  it("escapes NUL and SENTINEL in esc()", () => {
    expect(esc("x\u0000y")).toBe("x\u0000\u0000y");
    expect(esc("x\u0001y")).toBe("x\u0000\u0001y");
  });

  it("same documentId, different replicaId → distinct keys", () => {
    expect(storageKey("app", "doc", "rA")).not.toBe(storageKey("app", "doc", "rB"));
  });
});

describe("resolveIdentity (REQ-BP-001-4)", () => {
  it("generates a replicaId when omitted (not derived from a clientID)", () => {
    const a = resolveIdentity({ app: "app", documentId: "doc" });
    const b = resolveIdentity({ app: "app", documentId: "doc" });
    expect(a.replicaId).toMatch(/[0-9a-f-]{36}/);
    expect(a.replicaId).not.toBe(b.replicaId);
  });

  it("keeps a caller-supplied replicaId", () => {
    expect(resolveIdentity({ app: "app", documentId: "doc", replicaId: "fixed" }).replicaId).toBe(
      "fixed",
    );
  });

  it("rejects an empty app/documentId/replicaId", () => {
    expect(() => resolveIdentity({ app: "", documentId: "doc" })).toThrow(TypeError);
    expect(() => resolveIdentity({ app: "app", documentId: "" })).toThrow(TypeError);
    expect(() => resolveIdentity({ app: "app", documentId: "doc", replicaId: "" })).toThrow(
      TypeError,
    );
  });
});

describe("lockName (REQ-BP-005 clarification 3)", () => {
  it("includes both dbName and storageKey unambiguously", () => {
    const key = storageKey("app", "doc", "r");
    const name = lockName("ghostsync", key);
    expect(name).toContain("ghostsync");
    expect(name).toContain(key);
    // Different db → different lock for the same key.
    expect(lockName("other", key)).not.toBe(name);
  });
});

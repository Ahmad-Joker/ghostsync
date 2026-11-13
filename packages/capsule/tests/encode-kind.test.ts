import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeCapsule, encodeCapsule } from "../src/index.js";
import { APP, DOC, replicaWith, rejection } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC-CAP-002-3/5 encode kind and identity", () => {
  it("rejects a kind:diff TransportUpdate with TypeError", async () => {
    const r = replicaWith(DOC, { k: 1 });
    const full = r.exportState();
    const e = await rejection(encodeCapsule({ app: APP, documentId: DOC, update: { ...full, kind: "diff" } }));
    expect(e).toBeInstanceOf(TypeError);
  });

  it("encode rejects a TransportUpdate whose documentId differs from input.documentId, before any hashing", async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest");
    const r = replicaWith("doc-A", { k: 1 });
    const e = await rejection(encodeCapsule({ app: APP, documentId: "doc-B", update: r.exportState() }));
    expect(e).toBeInstanceOf(TypeError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("encode accepts a matching full TransportUpdate", async () => {
    const r = replicaWith(DOC, { k: 1 });
    const cap = await encodeCapsule({ app: APP, documentId: DOC, update: r.exportState() });
    expect((await decodeCapsule(cap)).metadata.documentId).toBe(DOC);
  });

  it("encode of raw bytes uses the caller-asserted documentId (no cross-check)", async () => {
    const r = replicaWith("doc-A", { k: 1 });
    const cap = await encodeCapsule({ app: APP, documentId: "asserted-id", update: r.exportState().bytes });
    expect((await decodeCapsule(cap)).metadata.documentId).toBe("asserted-id");
  });
});

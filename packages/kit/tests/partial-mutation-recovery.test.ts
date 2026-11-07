/**
 * Correction 3 — REAL partial-mutation recovery regression.
 *
 * The malformed bytes are crafted exactly as the independent reviewer did with
 * the pinned Yjs: encode a full update whose root map carries injected="bad",
 * then truncate the final byte. Applying those bytes to a RAW Y.Doc throws
 * ONLY AFTER "injected" has already entered the doc — genuine partial mutation
 * past a decoded struct, not an early-decode no-op. The control assertion proves
 * that, then the SAME bytes are fed through the public applyUpdate to prove the
 * SDK's snapshot-rollback recovery fully restores the committed projection.
 *
 * No production API is added to inject failures; the failure is driven purely
 * by crafted bytes through the public applyUpdate boundary.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit, type UpdateCarrier } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-partial-mutation-recovery";

const inc = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

/**
 * Bytes that partially mutate a raw Y.Doc before throwing: a full-state update
 * carrying root["injected"]="bad", truncated by its final byte. Verified in
 * this environment to throw AFTER "injected" enters the target doc.
 */
function partialMutationBytes(): Uint8Array {
  const src = new Y.Doc();
  try {
    src.getMap<unknown>("root").set("injected", "bad");
    const full = Y.encodeStateAsUpdate(src);
    return full.slice(0, -1);
  } finally {
    src.destroy();
  }
}

describe("Correction 3: real partial-mutation recovery through applyUpdate", () => {
  it("CONTROL: truncated bytes partially mutate a raw Y.Doc before throwing", () => {
    const bytes = partialMutationBytes();
    const raw = new Y.Doc();
    try {
      let threw = false;
      try {
        Y.applyUpdate(raw, bytes);
      } catch {
        threw = true;
      }
      // Proves the bytes exercise REAL partial mutation past a struct: the apply
      // throws, yet "injected" already landed in the raw doc.
      expect(threw).toBe(true);
      expect(raw.getMap<unknown>("root").get("injected")).toBe("bad");
    } finally {
      raw.destroy();
    }
  });

  it("SDK applyUpdate rejects the same bytes with state preserved and injected absent", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    const peer = kit.createReplica(DOC);
    try {
      // Populate legacy keys + structured records; hold a collection handle and
      // an active subscriber.
      r.set("legacy1", "L1");
      r.set("legacy2", 7);
      const col = r.collection(incidentAdapter);
      col.put("E1", inc("one"));
      col.put("E2", inc("two"));

      const legacyBefore = r.getState();
      const structuredBefore = [...col.list()].sort((a, b) => a[0].localeCompare(b[0]));

      let notifications = 0;
      const unsub = r.subscribe(() => notifications++);

      // Feed the crafted partial-mutation bytes through the public boundary.
      const carrier: UpdateCarrier & { kind: "full" } = {
        documentId: DOC,
        bytes: partialMutationBytes(),
        kind: "full",
      };
      expect(r.applyUpdate(carrier)).toEqual({ ok: false, reason: "malformedUpdate" });

      // Legacy AND structured state fully preserved (deep-equal to before).
      expect(r.getState()).toEqual(legacyBefore);
      expect([...col.list()].sort((a, b) => a[0].localeCompare(b[0]))).toEqual(structuredBefore);
      // The injected field never entered the committed replica.
      expect(r.has("injected")).toBe(false);
      expect(r.getState()["injected"]).toBeUndefined();
      // Zero notifications for the rejected apply.
      expect(notifications).toBe(0);

      // Held handle + subscriber still work; a subsequent local edit notifies.
      expect(col.get("E1")).toEqual(inc("one"));
      col.put("E3", inc("three"));
      r.set("legacy3", true);
      expect(notifications).toBe(2); // the two post-reject local writes

      // Differential sync with a peer converges across the rejected apply.
      expect(peer.applyUpdate(r.exportState()).ok).toBe(true);
      const psv = peer.exportStateVector();
      const diff = r.exportDiff(psv);
      expect(diff.ok).toBe(true);
      if (!diff.ok) throw new Error("unreachable");
      expect(peer.applyUpdate(diff.update).ok).toBe(true);

      const pcol = peer.collection(incidentAdapter);
      const sort = (xs: ReadonlyArray<readonly [string, Incident]>) =>
        [...xs].sort((a, b) => a[0].localeCompare(b[0]));
      expect(sort(pcol.list())).toEqual(sort(col.list()));
      expect(peer.getState()).toEqual(r.getState());
      expect(peer.has("injected")).toBe(false);
      unsub();
    } finally {
      r.destroy();
      peer.destroy();
    }
  });

  it("a pending dependent update survives a rejected malformed apply, then converges on prerequisite delivery", () => {
    const kit = createKit();
    const source = kit.createReplica(DOC);
    const receiver = kit.createReplica(DOC);
    try {
      const scol = source.collection(incidentAdapter);

      // Build a genuine dependency chain of differential updates.
      const svEmpty = kit.createReplica(DOC);
      const baseSv = svEmpty.exportStateVector();
      svEmpty.destroy();

      scol.put("E", inc("base")); // u0: meta + E base structure
      const d0 = source.exportDiff(baseSv);
      const sv1 = source.exportStateVector();
      scol.put("E", { ...inc("final"), severity: "high" }); // u1: depends on u0
      const d1 = source.exportDiff(sv1);
      expect(d0.ok && d1.ok).toBe(true);
      if (!d0.ok || !d1.ok) throw new Error("unreachable");

      // Deliver the DEPENDENT update (u1) first — Yjs holds it pending.
      expect(receiver.applyUpdate(d1.update).ok).toBe(true);

      // An intervening malformed apply is rejected; the pending u1 must survive
      // the snapshot rollback.
      expect(
        receiver.applyUpdate({ documentId: DOC, kind: "full", bytes: partialMutationBytes() }),
      ).toEqual({ ok: false, reason: "malformedUpdate" });
      expect(receiver.has("injected")).toBe(false);

      // Deliver the prerequisite u0; the previously-pending u1 now integrates.
      expect(receiver.applyUpdate(d0.update).ok).toBe(true);

      // Convergence: every expected edit preserved across the rejected apply.
      const rcol = receiver.collection(incidentAdapter);
      const got = rcol.get("E");
      expect(got?.title).toBe("final");
      expect(got?.severity).toBe("high");
      expect(got).toEqual(scol.get("E"));
    } finally {
      source.destroy();
      receiver.destroy();
    }
  });
});

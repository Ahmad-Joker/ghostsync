import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-malformed-update";

const inc = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-007 malformed/staged apply (AC-SDK-007-3/4/5/6/7)", () => {
  it("truncated/garbage bytes past shape+kind+id are rejected malformedUpdate, projection unchanged", () => {
    const r = createKit().createReplica(DOC);
    r.set("alpha", 1);
    const before = r.getState();
    let notifications = 0;
    r.subscribe(() => notifications++);

    const garbage = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(r.applyUpdate({ documentId: DOC, bytes: garbage })).toEqual({
      ok: false,
      reason: "malformedUpdate",
    });
    expect(r.getState()).toEqual(before);
    expect(notifications).toBe(0);
    r.destroy();
  });

  it("documentId mismatch and zero-length are rejected with the correct reasons", () => {
    const r = createKit().createReplica(DOC);
    r.set("alpha", 1);
    expect(r.applyUpdate({ documentId: "other", bytes: new Uint8Array([1]) })).toEqual({
      ok: false,
      reason: "documentIdMismatch",
    });
    expect(r.applyUpdate({ documentId: DOC, bytes: new Uint8Array(0) })).toEqual({
      ok: false,
      reason: "invalidCarrier",
    });
    r.destroy();
  });

  it("continued local write + sync still works AFTER a rejected apply (handles & subscriptions survive)", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", inc("first"));

    const events: string[] = [];
    r.subscribe((e) => events.push(e.origin));

    // Rejected apply.
    expect(r.applyUpdate({ documentId: DOC, bytes: new Uint8Array([7, 7, 7]) })).toEqual({
      ok: false,
      reason: "malformedUpdate",
    });

    // The SAME collection handle still reads and writes after the rejection.
    expect(col.get("E")).toEqual(inc("first"));
    col.put("E2", inc("second"));
    expect(events.filter((e) => e === "local").length).toBe(1); // only the post-reject put

    // And still syncs with a peer.
    const peer = kit.createReplica(DOC);
    expect(peer.applyUpdate(r.exportState()).ok).toBe(true);
    expect(peer.collection(incidentAdapter).get("E2")).toEqual(inc("second"));
    r.destroy();
    peer.destroy();
  });

  it("clarification 2: out-of-order incremental updates WITH DEPENDENCIES converge; a swap happens between", () => {
    const kit = createKit();
    // Source replica produces GENUINE incremental updates, each captured as the
    // differential against the prior state vector so later updates depend on the
    // structure introduced by earlier ones (a real dependency chain).
    const source = kit.createReplica(DOC);
    const scol = source.collection(incidentAdapter);

    // Baseline state vector of a TRULY EMPTY replica — d0 built against it
    // carries the full base structure (meta key + E's first fields) that d1/d2
    // then depend on, forming a genuine dependency chain.
    const svEmpty = kit.createReplica(DOC).exportStateVector();

    scol.put("E", inc("dep-base")); // creates E (title=dep-base, + all fields)
    const d0 = source.exportDiff(svEmpty); // u0: introduces meta + E base

    const sv1 = source.exportStateVector();
    scol.put("E", { ...inc("dep-base"), severity: "high" }); // edits severity
    const d1 = source.exportDiff(sv1); // u1: depends on u0

    const sv2 = source.exportStateVector();
    scol.put("E", { ...inc("dep-final"), severity: "high" }); // edits title
    const d2 = source.exportDiff(sv2); // u2: depends on u0 (and u1)

    expect(d0.ok && d1.ok && d2.ok).toBe(true);
    if (!d0.ok || !d1.ok || !d2.ok) throw new Error("unreachable");

    // Receiver: deliver the LATER update (u2) before its prerequisite (u0).
    const receiver = kit.createReplica(DOC);
    expect(receiver.applyUpdate(d2.update).ok).toBe(true); // Yjs holds pending

    // Perform ANOTHER successful apply that exercises staging/swap in between.
    const other = kit.createReplica(DOC);
    other.set("unrelated", 42);
    expect(receiver.applyUpdate(other.exportState()).ok).toBe(true);

    // Now deliver the prerequisites u0 then u1.
    expect(receiver.applyUpdate(d0.update).ok).toBe(true);
    expect(receiver.applyUpdate(d1.update).ok).toBe(true);

    // Convergence: the final title (which depended on the base structure) is
    // preserved across the intervening swap — no expected edit lost.
    const rcol = receiver.collection(incidentAdapter);
    const got = rcol.get("E");
    expect(got?.title).toBe("dep-final");
    expect(got?.severity).toBe("high");
    expect(receiver.get("unrelated")).toBe(42);
    // And it matches the source after full delivery.
    expect(got).toEqual(source.collection(incidentAdapter).get("E"));

    source.destroy();
    receiver.destroy();
    other.destroy();
  });

  it("clarification 2: delete-before-insert delivery converges", () => {
    const kit = createKit();
    const srcDoc = new Y.Doc();
    const updates: Uint8Array[] = [];
    srcDoc.on("update", (u: Uint8Array) => updates.push(u));
    const map = srcDoc.getMap<unknown>("root");
    srcDoc.transact(() => map.set("k", "v")); // u0 insert
    srcDoc.transact(() => map.delete("k")); // u1 delete (depends on u0)

    const receiver = kit.createReplica(DOC);
    const u0 = updates[0] as Uint8Array;
    const u1 = updates[1] as Uint8Array;
    // delete arrives BEFORE the insert it removes
    expect(receiver.applyUpdate({ documentId: DOC, kind: "diff", bytes: u1 }).ok).toBe(true);
    expect(receiver.applyUpdate({ documentId: DOC, kind: "diff", bytes: u0 }).ok).toBe(true);
    // The deletion wins; k is absent.
    expect(receiver.has("k")).toBe(false);
    receiver.destroy();
    srcDoc.destroy();
  });

  it("snapshot/restore round-trips through the swap-based apply", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", inc("snap"));
    a.set("legacy", 3);
    const saved = a.exportState();
    a.destroy();

    const restored = kit.createReplica(saved.documentId, saved.bytes);
    expect(restored.collection(incidentAdapter).get("E")).toEqual(inc("snap"));
    expect(restored.get("legacy")).toBe(3);
    // and it can still apply further updates after restore
    const peer = kit.createReplica(DOC);
    peer.set("more", 1);
    expect(restored.applyUpdate(peer.exportState()).ok).toBe(true);
    expect(restored.get("more")).toBe(1);
    restored.destroy();
    peer.destroy();
  });
});

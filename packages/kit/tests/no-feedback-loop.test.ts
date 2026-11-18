import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-no-feedback";

const inc = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-005 no feedback loop (AC-SDK-005-3/6)", () => {
  it("two cross-wired replicas re-broadcast only on origin:local; the loop reaches a fixpoint", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    // Open both collections FIRST so the one-time schema-meta write is not
    // counted by the subscribers wired below.
    const ca = a.collection(incidentAdapter);
    b.collection(incidentAdapter);

    let aRemoteApplies = 0;
    let bRemoteApplies = 0;

    // Wire a -> b and b -> a, re-broadcasting ONLY on origin === "local".
    a.subscribe((e) => {
      if (e.origin === "local") {
        const out = b.applyUpdate(a.exportState());
        expect(out.ok).toBe(true);
      }
    });
    b.subscribe((e) => {
      if (e.origin === "local") {
        const out = a.applyUpdate(b.exportState());
        expect(out.ok).toBe(true);
      }
    });

    // Count remote applies that actually changed state (via a 2nd subscriber).
    a.subscribe((e) => {
      if (e.origin === "remote") aRemoteApplies++;
    });
    b.subscribe((e) => {
      if (e.origin === "remote") bRemoteApplies++;
    });

    // One local write on A triggers a bounded exchange that terminates.
    ca.put("E", inc("hello"));

    // Convergence.
    expect(b.collection(incidentAdapter).get("E")).toEqual(inc("hello"));
    expect(a.collection(incidentAdapter).get("E")).toEqual(inc("hello"));

    // Fixpoint mechanism: B received exactly one changing remote apply; the
    // echo back to A was an already-known no-op → fired ZERO remote notifications
    // on A, so A never re-broadcast again.
    expect(bRemoteApplies).toBe(1);
    expect(aRemoteApplies).toBe(0);
    a.destroy();
    b.destroy();
  });
});

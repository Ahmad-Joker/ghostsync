import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-notifications";

const inc = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-005 notifications (AC-SDK-005-1/2/4/5/6/7)", () => {
  it("local write to EITHER map fires origin:local once per transaction", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    const events: string[] = [];
    r.subscribe((e) => events.push(e.origin));

    r.set("alpha", 1); // legacy root
    col.put("E", inc("x")); // records map

    expect(events).toEqual(["local", "local"]);
    r.destroy();
  });

  it("an applied remote update changing either map fires origin:remote once", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("alpha", 1);
    a.collection(incidentAdapter).put("E", inc("x"));

    const events: string[] = [];
    b.subscribe((e) => events.push(e.origin));
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(events).toEqual(["remote"]);
    a.destroy();
    b.destroy();
  });

  it("a no-op application fires ZERO notifications even though afterTransaction fired (defect C)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("alpha", 1);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    const events: string[] = [];
    b.subscribe((e) => events.push(e.origin));
    // Re-apply the SAME update: no key changes.
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(events).toEqual([]);
    a.destroy();
    b.destroy();
  });

  it("unsubscribe stops only that listener", () => {
    const r = createKit().createReplica(DOC);
    const seen1: number[] = [];
    const seen2: number[] = [];
    const stop1 = r.subscribe(() => seen1.push(1));
    r.subscribe(() => seen2.push(1));

    r.set("a", 1);
    stop1();
    r.set("b", 2);

    expect(seen1.length).toBe(1);
    expect(seen2.length).toBe(2);
    // unsubscribe is idempotent
    expect(() => stop1()).not.toThrow();
    r.destroy();
  });

  it("a throwing listener does not stop others and does not change the write/apply outcome", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const seen: string[] = [];
    b.subscribe(() => {
      throw new Error("listener boom");
    });
    b.subscribe((e) => seen.push(e.origin));

    a.set("alpha", 1);
    const outcome = b.applyUpdate(a.exportState());
    expect(outcome).toEqual({ ok: true }); // listener error never becomes malformedUpdate
    expect(seen).toEqual(["remote"]); // the non-throwing listener still ran

    // local write with a throwing listener also still succeeds
    expect(() => b.set("beta", 2)).not.toThrow();
    a.destroy();
    b.destroy();
  });

  it("post-destroy subscribe throws the baseline destroyed error", () => {
    const r = createKit().createReplica(DOC);
    r.destroy();
    expect(() => r.subscribe(() => {})).toThrow("GhostSync Kit: replica has been destroyed");
  });
});

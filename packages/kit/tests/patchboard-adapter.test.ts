import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { cardAdapter, incidentAdapter, type Card } from "./fixtures/adapters.js";

const DOC = "doc-patchboard";

describe("REQ-SDK-001 PatchBoard card adapter — same engine, different schema (AC-SDK-001-3)", () => {
  it("card create/get/update/delete/list via Collection<Card>", () => {
    const r = createKit().createReplica(DOC);
    const cards = r.collection(cardAdapter);

    const nine: Card = { column: "todo", title: "Wire QR tier", order: 10, assignee: null };
    cards.put("card-9", nine);
    expect(cards.get("card-9")).toEqual(nine);

    cards.put("card-9", { ...nine, column: "doing" });
    expect(cards.get("card-9")).toEqual({ ...nine, column: "doing" });

    cards.put("card-10", { column: "done", title: "Ship", order: 1, assignee: "sam" });
    expect([...cards.list()].map(([id]) => id).sort()).toEqual(["card-10", "card-9"]);

    cards.delete("card-9");
    expect(cards.has("card-9")).toBe(false);
    r.destroy();
  });

  it("the SAME engine serves both FieldLedger and PatchBoard with no engine change", () => {
    // Two distinct schemas over ONE replica/engine.
    const r = createKit().createReplica(DOC);
    const incidents = r.collection(incidentAdapter);
    const cards = r.collection(cardAdapter);

    incidents.put("inc-1", {
      title: "Leak",
      severity: "low",
      reportedAt: 1,
      resolved: false,
      notes: null,
    });
    cards.put("card-1", { column: "todo", title: "t", order: 0, assignee: null });

    expect(incidents.get("inc-1")?.title).toBe("Leak");
    expect(cards.get("card-1")?.column).toBe("todo");
    // Distinct entityType namespaces: the incident id does not appear as a card.
    expect(cards.has("inc-1")).toBe(false);
    expect(incidents.has("card-1")).toBe(false);
    r.destroy();
  });
});

/**
 * REQ-BP-004 — routed import marks dirty on every ok (including pending/no-op
 * accepts that fire NO notification) and does nothing on a rejected import.
 * Node unit on fake-indexeddb + mocked Web Locks — fast feedback, NOT
 * acceptance evidence.
 */
import { createKit } from "@ghostsync/kit";
import { describe, expect, it } from "vitest";

import { openReplica } from "../src/session.js";
import type { SaveState } from "../src/types.js";
import { uniqueDbName } from "./support/fake-reset.js";

/**
 * Build two chained updates from a SOURCE replica where update2 depends on
 * update1 (an incremental diff). Applying update2 alone to a fresh replica is
 * accepted as PENDING (ok:true) but fires no observable change.
 */
function chainedUpdates(documentId: string): { first: Uint8Array; second: Uint8Array } {
  // Build a single source timeline: write "a", capture the state vector, then
  // write "b". The "b" diff (taken against the post-"a" state vector) DEPENDS on
  // the "a" update, so applying it alone to a fresh replica is accepted as
  // PENDING without any observable change.
  const source = createKit().createReplica(documentId);
  source.set("a", 1);
  const svAfterA = source.exportStateVector();
  const firstBytes = source.exportState().bytes.slice(); // full-state with "a"
  source.set("b", 2);
  const secondDiff = source.exportDiff(svAfterA);
  if (!secondDiff.ok) {
    throw new Error("failed to build chained second update");
  }
  const second = secondDiff.update.bytes.slice();
  source.destroy();
  return { first: firstBytes, second };
}

describe("routed applyUpdate (REQ-BP-004)", () => {
  it("marks dirty on a pending (out-of-order) accept with no notification", async () => {
    const documentId = "doc";
    const { second } = chainedUpdates(documentId);
    const states: SaveState[] = [];
    const session = await openReplica({
      app: "a",
      documentId,
      dbName: uniqueDbName(),
      onStateChange: (s) => states.push(s),
    });

    let notified = false;
    session.subscribe(() => {
      notified = true;
    });

    const outcome = session.applyUpdate({ documentId, kind: "diff", bytes: second });
    expect(outcome.ok).toBe(true);
    // The dependent update is accepted but applies no observable key → no notify.
    expect(notified).toBe(false);
    // Yet the session is dirty and will persist the pending update.
    expect(session.state === "dirty" || session.state === "saving").toBe(true);
    await session.flush();
    expect(session.state).toBe("saved");
    await session.close();
  });

  it("does nothing on a rejected import", async () => {
    const session = await openReplica({ app: "a", documentId: "doc", dbName: uniqueDbName() });
    await session.flush();
    const before = session.state;
    const outcome = session.applyUpdate({ documentId: "WRONG", kind: "full", bytes: new Uint8Array([1, 2]) });
    expect(outcome.ok).toBe(false);
    expect(session.state).toBe(before);
    await session.close();
  });

  it("integrates a pending update once its prerequisite arrives", async () => {
    const documentId = "doc";
    const { first, second } = chainedUpdates(documentId);
    const session = await openReplica({ app: "a", documentId, dbName: uniqueDbName() });

    expect(session.applyUpdate({ documentId, kind: "diff", bytes: second }).ok).toBe(true);
    expect(session.get("b")).toBeUndefined(); // still pending
    expect(session.applyUpdate({ documentId, kind: "full", bytes: first }).ok).toBe(true);
    // Now both integrate.
    expect(session.get("a")).toBe(1);
    expect(session.get("b")).toBe(2);
    await session.close();
  });
});

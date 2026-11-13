/**
 * file-capsules — persistence of IMPORTED capsule data against the REAL
 * PersistSession, real IndexedDB, and real Chromium. No result is mocked: the
 * `applied` / `persisted` / `saveError` values come from the real
 * importCapsuleIntoPersisted call, and failures are driven by genuine
 * IndexedDB behavior (a real aborted write transaction; a real
 * `maxBytes` pre-write violation reported by the session).
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

interface ImportView {
  ok: boolean;
  applied: boolean;
  persisted: boolean | undefined;
  saveError: { code: string | undefined; message: string } | undefined;
  error: { code: string | undefined; message: string } | undefined;
  recovery: string;
}

test.describe("capsule import persistence (real Chromium + IndexedDB)", () => {
  test("imported legacy AND structured data survive reload after a successful flush", async ({ page, context }) => {
    const srcDb = uniqueDbName("cap-src");
    const tgtDb = uniqueDbName("cap-tgt");
    await loadHarnessOffline(page, context);

    const imported = await page.evaluate(
      async (a: { srcDb: string; tgtDb: string }) => {
        await window.__gs.open("src", { app: "fieldledger", documentId: "incident-9", replicaId: "rS", dbName: a.srcDb });
        window.__gs.set("src", "status", "open");
        window.__gs.putIncident("src", "i1", { id: "i1", title: "Spill", priority: 1 });
        const hex = (await window.__gs.exportCapsuleHex("src")) as string;

        await window.__gs.open("tgt", { app: "fieldledger", documentId: "incident-9", replicaId: "rT", dbName: a.tgtDb });
        const view = await window.__gs.importCapsuleHex("tgt", hex);
        await window.__gs.close("tgt");
        await window.__gs.close("src");
        return view;
      },
      { srcDb, tgtDb },
    );
    expect(imported).toMatchObject({ ok: true, applied: true, persisted: true });
    expect(imported.saveError).toBeUndefined();

    await reloadHarnessOffline(page, context);

    const restored = await page.evaluate(async (db: string) => {
      const opened = await window.__gs.open("tgt", { app: "fieldledger", documentId: "incident-9", replicaId: "rT", dbName: db });
      const out = {
        opened,
        status: window.__gs.get("tgt", "status"),
        incident: window.__gs.getIncident("tgt", "i1"),
      };
      await window.__gs.close("tgt");
      return out;
    }, tgtDb);
    expect(restored.opened).toMatchObject({ ok: true, restored: true });
    expect(restored.status).toBe("open");
    expect(restored.incident).toEqual({ id: "i1", title: "Spill", priority: 1 });
  });

  test("genuine aborted write after import: applied:true, persisted:false, readable, error state, retry persists", async ({
    page,
    context,
  }) => {
    const srcDb = uniqueDbName("cap-src");
    const tgtDb = uniqueDbName("cap-tgt");
    await loadHarnessOffline(page, context);

    const out = await page.evaluate(
      async (a: { srcDb: string; tgtDb: string }) => {
        type FlushView = { ok?: boolean; state?: string; code?: string };

        await window.__gs.open("src", { app: "a", documentId: "d", replicaId: "rS", dbName: a.srcDb });
        window.__gs.set("src", "incoming", "from-capsule");
        // Settle the source's setup save BEFORE arming: the abort is a one-shot on the NEXT
        // readwrite transaction on ANY connection, so an unsettled setup save could consume it.
        const srcFlush = (await window.__gs.flush("src")) as FlushView;
        const hex = (await window.__gs.exportCapsuleHex("src")) as string;

        await window.__gs.open("tgt", { app: "a", documentId: "d", replicaId: "rT", dbName: a.tgtDb });
        window.__gs.set("tgt", "own", "kept");
        // Same for the target's own setup edit.
        const tgtFlush = (await window.__gs.flush("tgt")) as FlushView;

        // Never arm (or import) on top of a failed setup: the abort must be consumed by the IMPORT write.
        if (srcFlush.ok !== true || tgtFlush.ok !== true) {
          throw new Error(
            `setup flush failed before arming: src=${JSON.stringify(srcFlush)} tgt=${JSON.stringify(tgtFlush)}`,
          );
        }

        // Real one-shot IndexedDB abort of the NEXT readwrite transaction, armed immediately
        // before the import so it is consumed by the import's write.
        window.__gs.armWriteAbortOnce();
        const view = await window.__gs.importCapsuleHex("tgt", hex);

        const stateAfter = window.__gs.state("tgt");
        const incoming = window.__gs.get("tgt", "incoming");
        const own = window.__gs.get("tgt", "own");
        const retried = await window.__gs.flush("tgt");
        const stateRetried = window.__gs.state("tgt");
        await window.__gs.close("tgt");
        return { srcFlush, tgtFlush, view, stateAfter, incoming, own, retried, stateRetried };
      },
      { srcDb, tgtDb },
    );
    // Both setup flushes succeeded before the abort was armed.
    expect(out.srcFlush).toMatchObject({ ok: true, state: "saved" });
    expect(out.tgtFlush).toMatchObject({ ok: true, state: "saved" });
    const view = out.view as ImportView;
    expect(view.applied).toBe(true);
    expect(view.persisted).toBe(false);
    expect(view.saveError?.code).toBe("TransactionAbortError");
    expect(view.recovery).toContain("NOT saved");
    expect(out.stateAfter).toBe("error");
    expect(out.incoming).toBe("from-capsule");
    expect(out.own).toBe("kept");
    expect(out.retried).toMatchObject({ ok: true, state: "saved" });
    expect(out.stateRetried).toBe("saved");

    // The visible result region shows the failure and the recovery guidance.
    const result = page.locator("#capsule-result");
    await expect(result).toHaveAttribute("data-applied", "true");
    await expect(result).toHaveAttribute("data-persisted", "false");
    await expect(result).toHaveAttribute("data-error-code", "TransactionAbortError");
    await expect(result).toContainText("NOT saved");

    // The retried snapshot is durable.
    await reloadHarnessOffline(page, context);
    const restored = await page.evaluate(async (db: string) => {
      await window.__gs.open("tgt", { app: "a", documentId: "d", replicaId: "rT", dbName: db });
      const r = { incoming: window.__gs.get("tgt", "incoming"), own: window.__gs.get("tgt", "own") };
      await window.__gs.close("tgt");
      return r;
    }, tgtDb);
    expect(restored).toEqual({ incoming: "from-capsule", own: "kept" });
  });

  test("merged snapshot over maxBytes: applied:true, persisted:false (QuotaExceededError), measured S_merged > maxBytes", async ({
    page,
    context,
  }) => {
    const srcDb = uniqueDbName("cap-src");
    const tgtDb = uniqueDbName("cap-tgt");
    await loadHarnessOffline(page, context);

    const out = await page.evaluate(
      async (a: { srcDb: string; tgtDb: string }) => {
        // 1. Source (default maxBytes): ~2 KB payload, far below the capsule limits.
        await window.__gs.open("src", { app: "a", documentId: "d", replicaId: "rS", dbName: a.srcDb });
        window.__gs.set("src", "payload", "x".repeat(2048));
        const capsuleHex = (await window.__gs.exportCapsuleHex("src")) as string;

        // 2. Target with maxBytes 1024 (existing OpenOptions forwarding): small snapshot saves fine.
        await window.__gs.open("tgt", { app: "a", documentId: "d", replicaId: "rT", dbName: a.tgtDb, maxBytes: 1024 });
        window.__gs.set("tgt", "t", "small");
        const firstFlush = await window.__gs.flush("tgt");
        const s1Hex = window.__gs.exportHex("tgt") as string;

        // 3. Import: the merged snapshot cannot be saved under maxBytes.
        const view = await window.__gs.importCapsuleHex("tgt", capsuleHex);

        // 4. MEASURE the actual post-import full-state update (public session export).
        const mergedHex = window.__gs.exportHex("tgt") as string;
        const stateAfter = window.__gs.state("tgt");
        const t = window.__gs.get("tgt", "t");
        const payload = window.__gs.get("tgt", "payload");
        const secondFlush = await window.__gs.flush("tgt");
        return {
          firstFlush,
          s1: s1Hex.length / 2,
          view,
          sMerged: mergedHex.length / 2,
          stateAfter,
          t,
          payload,
          secondFlush,
        };
      },
      { srcDb, tgtDb },
    );

    console.log(`[capsule-size] maxBytes=1024 S1=${out.s1} S_merged=${out.sMerged}`);

    expect(out.firstFlush).toMatchObject({ ok: true, state: "saved" });
    expect(out.s1).toBeLessThan(1024);

    const view = out.view as ImportView;
    expect(view.applied).toBe(true);
    expect(view.persisted).toBe(false);
    expect(view.saveError?.code).toBe("QuotaExceededError");
    expect(view.saveError?.message).toContain("snapshot exceeds maxBytes");

    expect(out.sMerged).toBeGreaterThan(1024);
    expect(out.stateAfter).toBe("error");
    expect(out.t).toBe("small");
    expect(out.payload).toBe("x".repeat(2048));
    expect(out.secondFlush).toMatchObject({ ok: false, code: "QuotaExceededError" });
  });
});

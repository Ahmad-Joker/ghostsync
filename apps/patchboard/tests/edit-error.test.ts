import { describe, expect, it } from "vitest";
import { mapEditError } from "../src/state/errors.js";
import { controllerOver, type Seams } from "./controller-seams.js";

const putThrows = (err: Error) => <T extends object>(col: T): T =>
  new Proxy(col, {
    get(target, prop, receiver) {
      if (prop === "put") {
        return () => {
          throw err;
        };
      }
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });

describe("U-PB-17 edit errors", () => {
  it("copy names the cause and the action", () => {
    const s = mapEditError("schema-mismatch");
    expect(s.message).toContain("newer schema");
    expect(s.message).toContain("Reload the app");
    const u = mapEditError("unexpected");
    expect(u.message).toContain("was not made");
    for (const m of [s, u]) expect(m.title).toContain("NOT applied");
  });
  it("a throwing put sets editError, keeps phase ready and save state", () => {
    const { c } = controllerOver(putThrows(new TypeError("boom")));
    const saveBefore = c.save;
    c.addCard("Alpha", "");
    expect(c.editError?.kind).toBe("unexpected");
    expect(c.phase).toBe("ready");
    expect(c.save).toBe(saveBefore);
    expect(c.errorMessage).toBe("");
    expect(c.importView).toBeUndefined();
  });
  it("a Kit-style schema mismatch maps to the schema-mismatch kind", () => {
    const { c } = controllerOver(putThrows(new Error("GhostSync Kit: schema mismatch for collection patchboard/card: stored x != adapter y")));
    c.addCard("Alpha", "");
    expect(c.editError?.kind).toBe("schema-mismatch");
  });
  it("add with an empty title is rejected by the adapter and surfaces as an edit error", () => {
    const { c } = controllerOver();
    c.addCard("", "");
    expect(c.editError?.kind).toBe("unexpected");
    expect(c.model?.columns.todo).toEqual([]);
  });
  it("edit and listResults both reject with a schema mismatch: last good model kept, no re-read", () => {
    let broken = false;
    let listCalls = 0;
    const mismatch = (): Error => new Error("GhostSync Kit: schema mismatch for collection patchboard/card: stored x != adapter y");
    const { c } = controllerOver(<T extends object>(col: T): T =>
      new Proxy(col, {
        get(target, prop, receiver) {
          if (broken && prop === "listResults") return () => ((listCalls += 1), (() => { throw mismatch(); })());
          if (broken && typeof prop === "string" && ["put", "get", "getResult", "list", "has", "delete"].includes(prop)) return () => { throw mismatch(); };
          const v = Reflect.get(target, prop, receiver) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }),
    );
    c.addCard("Alpha", "");
    const lastGood = c.model;
    expect(lastGood?.columns.todo.map((p) => p.card.title)).toEqual(["Alpha"]);
    const revision = c.revision;
    const saveBefore = c.save;
    broken = true;
    listCalls = 0;
    expect(() => c.saveCard("card-x", { title: "n" })).not.toThrow();
    expect(listCalls).toBe(0);
    expect(c.editError?.kind).toBe("schema-mismatch");
    expect(c.model).toBe(lastGood);
    expect(c.revision).toBe(revision);
    expect(c.phase).toBe("ready");
    expect(c.save).toBe(saveBefore);
    expect(c.refresh()).toBe(false);
    expect(c.model).toBe(lastGood);
    expect(c.revision).toBe(revision);
  });
  it("dismiss clears the error and a later successful edit clears it too", () => {
    const { c, notified } = controllerOver(putThrows(new TypeError("boom")));
    c.addCard("x", "");
    const before = notified();
    c.dismissEditError();
    expect(c.editError).toBeUndefined();
    expect(notified()).toBeGreaterThan(before);
    const ok = controllerOver();
    ok.c.editError = mapEditError("unexpected");
    ok.c.addCard("Alpha", "");
    expect(ok.c.editError).toBeUndefined();
    expect(ok.c.model?.columns.todo.map((p) => p.card.title)).toEqual(["Alpha"]);
    expect((ok.c as unknown as Seams).phase).toBe("ready");
  });
});
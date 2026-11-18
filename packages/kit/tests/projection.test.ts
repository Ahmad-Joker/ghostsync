import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-projection";

describe("correction 4: safe state projection", () => {
  it("preserves __proto__, constructor, and toString as own data properties", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);

    r.set("__proto__", "p-value");
    r.set("constructor", "c-value");
    r.set("toString", "t-value");
    r.set("normal", 1);

    const snap = r.getState();

    // own enumerable data properties, not prototype accessors
    expect(Object.prototype.hasOwnProperty.call(snap, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snap, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snap, "toString")).toBe(true);

    // values round-trip
    const proto = Object.getOwnPropertyDescriptor(snap, "__proto__");
    expect(proto?.value).toBe("p-value");
    expect(proto?.enumerable).toBe(true);
    expect((snap as Record<string, unknown>)["constructor"]).toBe("c-value");
    expect((snap as Record<string, unknown>)["toString"]).toBe("t-value");
    expect(snap["normal"]).toBe(1);

    // the three reserved keys are present as own keys
    const keys = Object.keys(snap).sort();
    expect(keys).toEqual(["__proto__", "constructor", "normal", "toString"]);

    r.destroy();
  });

  it("mutating a returned snapshot cannot mutate the replica", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    r.set("a", "original");

    const snap = r.getState();
    (snap as Record<string, unknown>)["a"] = "tampered";
    (snap as Record<string, unknown>)["injected"] = "nope";

    // the replica's state is unaffected
    expect(r.get("a")).toBe("original");
    expect(r.has("injected")).toBe(false);

    // a fresh snapshot still reflects only real state
    expect(r.getState()).toEqual({ a: "original" });

    // each call returns a distinct object
    expect(r.getState()).not.toBe(r.getState());

    r.destroy();
  });
});

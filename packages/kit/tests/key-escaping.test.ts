import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter } from "../src/index.js";
import {
  collectionId,
  fieldKey,
  metaKey,
  parseFieldKey,
  SENTINEL,
  SEP,
} from "../src/keys.js";

const DOC = "doc-key-escaping";

/** A generic single-field adapter parameterized by its schema identity. */
function singleFieldAdapter(
  app: string,
  entityType: string,
  field: string,
): EntityAdapter<{ value: string }> {
  return {
    schema: { app, schemaVersion: 1, entityType },
    validate(v) {
      if (typeof v.value !== "string") throw new TypeError("value must be string");
    },
    toFields: (v) => ({ [field]: v.value }),
    fromFields: (f) => ({ value: f[field] as string }),
  };
}

describe("REQ-SDK-002 composite-key codec + collision regressions (AC-SDK-002-9/10/11)", () => {
  it("names with SEP / SENTINEL / NUL / kind words round-trip unambiguously", () => {
    const tricky = [
      `col${SEP}x`,
      `${SENTINEL}weird`,
      "f",
      "m",
      "plain",
      "\u0000nul",
      `${SEP}${SENTINEL}\u0000`,
    ];
    for (const collection of tricky) {
      for (const id of tricky) {
        for (const field of tricky) {
          const key = fieldKey(collection, id, field);
          const parsed = parseFieldKey(key);
          expect(parsed).toEqual({ collection, id, field });
        }
      }
    }
    // Two distinct (app, entityType) tuples never collide in their collection id.
    expect(collectionId("a", "b.c")).not.toBe(collectionId("a.b", "c"));
    // A meta key is not parsed as a field key.
    expect(parseFieldKey(metaKey("col"))).toBeUndefined();
  });

  it("two distinct collections with the SAME entity id never mix fields (clarification 1)", () => {
    const r = createKit().createReplica(DOC);
    const colA = r.collection(singleFieldAdapter("appA", "typeA", "fa"));
    const colB = r.collection(singleFieldAdapter("appB", "typeB", "fb"));

    colA.put("1", { value: "A-value" });
    colB.put("1", { value: "B-value" });

    expect(colA.get("1")).toEqual({ value: "A-value" });
    expect(colB.get("1")).toEqual({ value: "B-value" });
    a_assertDistinct(colA.get("1")?.value, colB.get("1")?.value);
    r.destroy();
  });

  it("collision test 1: a legacy key byte-identical to a structured field key stays independent", () => {
    const r = createKit().createReplica(DOC);
    const field = "title";
    const col = r.collection(singleFieldAdapter("fieldledger", "incident", field));
    col.put("E", { value: "STRUCTURED" });

    // Build the exact byte string of that structured field key and set it as a
    // LEGACY key via replica.set.
    const colId = collectionId("fieldledger", "incident");
    const byteIdentical = fieldKey(colId, "E", field);
    r.set(byteIdentical, "LEGACY");

    // Legacy read sees the legacy value; structured read sees the structured value.
    expect(r.get(byteIdentical)).toBe("LEGACY");
    expect(col.get("E")).toEqual({ value: "STRUCTURED" });
    // getState projects the legacy key (it is a valid root key).
    expect(r.getState()[byteIdentical]).toBe("LEGACY");
    r.destroy();
  });

  it("collision test 2: a sentinel-prefixed legacy key is an ordinary legacy key", () => {
    const r = createKit().createReplica(DOC);
    const key = `${SENTINEL}anything`;
    r.set(key, "v");
    expect(r.has(key)).toBe(true);
    expect(r.get(key)).toBe("v");
    expect(r.getState()[key]).toBe("v");
    r.delete(key);
    expect(r.has(key)).toBe(false);
    r.destroy();
  });
});

function a_assertDistinct(x: unknown, y: unknown): void {
  expect(x).not.toBe(y);
}

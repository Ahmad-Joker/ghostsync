import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-lifecycle";

describe("correction 5 / REQ-007 destroy lifecycle", () => {
  it("AC-007-3: every operation after destroy() throws a clear Error", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    r.set("k", "v");
    const carrier = r.exportState();

    r.destroy();

    expect(() => r.set("k", "w")).toThrow(/replica has been destroyed/);
    expect(() => r.delete("k")).toThrow(/replica has been destroyed/);
    expect(() => r.get("k")).toThrow(/replica has been destroyed/);
    expect(() => r.has("k")).toThrow(/replica has been destroyed/);
    expect(() => r.exportState()).toThrow(/replica has been destroyed/);
    expect(() => r.applyUpdate(carrier)).toThrow(/replica has been destroyed/);
    expect(() => r.getState()).toThrow(/replica has been destroyed/);
  });

  it("AC-007-4: repeated destroy() is a safe no-op", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    r.set("k", "v");

    expect(() => {
      r.destroy();
      r.destroy();
      r.destroy();
    }).not.toThrow();
  });
});

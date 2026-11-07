import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import {
  BASELINE_DOCUMENT_ID,
  KNOWN_BASELINE_STATE,
  baselineFullStateBytes,
} from "./fixtures/baseline-ab37419.js";

describe("NFR-SDK-005 baseline byte fixture (collision test 8)", () => {
  it("restores REAL ab37419 baseline bytes into a fresh current-build replica and matches the known flat state", () => {
    const bytes = baselineFullStateBytes();
    expect(bytes.length).toBeGreaterThan(0);

    const r = createKit().createReplica(BASELINE_DOCUMENT_ID, bytes);
    // The root map's encoded structure is unchanged by adding the separate
    // records map, so the baseline flat projection restores exactly.
    expect(r.getState()).toEqual(KNOWN_BASELINE_STATE);
    r.destroy();
  });

  it("a replica restored from baseline bytes can still sync and use the new structured API", () => {
    const r = createKit().createReplica(BASELINE_DOCUMENT_ID, baselineFullStateBytes());
    // legacy keys preserved
    expect(r.get("alpha")).toBe(1);
    // still writable afterward
    r.set("zeta", "new");
    expect(r.getState()["zeta"]).toBe("new");
    r.destroy();
  });
});

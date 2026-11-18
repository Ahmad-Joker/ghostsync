import { describe, expect, it } from "vitest";
import { qrStepsView, stepState } from "../src/ui/qr-steps.js";

const states = (state: string): string[] => ([1, 2, 3] as const).map((n) => stepState(qrStepsView(state), n));

describe("qrStepsView (KW-UNIT-QR-STEPS)", () => {
  it("maps each real scan state to the Scan, Review, Import steps", () => {
    expect(qrStepsView("scanning")).toEqual({ active: 1, done: 0, error: false });
    expect(qrStepsView("requesting")).toEqual({ active: 1, done: 0, error: false });
    expect(qrStepsView("scanned")).toEqual({ active: 2, done: 1, error: false });
    expect(qrStepsView("already-imported")).toEqual({ active: 2, done: 1, error: false });
    expect(qrStepsView("importing")).toEqual({ active: 3, done: 2, error: false });
    expect(qrStepsView("imported")).toEqual({ active: 0, done: 3, error: false });
  });
  it("marks every failure state as an error on the Scan step", () => {
    for (const s of ["rejected", "denied", "no-camera", "in-use", "insecure", "unsupported", "failed", "timed-out"]) {
      expect(qrStepsView(s).error, s).toBe(true);
      expect(states(s), s).toEqual(["error", "pending", "pending"]);
    }
  });
  it("shows nothing as current for idle or an unknown state", () => {
    for (const s of ["idle", "something-new", ""]) expect(qrStepsView(s)).toEqual({ active: 0, done: 0, error: false });
  });
  it("derives per-step states", () => {
    expect(states("scanning")).toEqual(["current", "pending", "pending"]);
    expect(states("scanned")).toEqual(["done", "current", "pending"]);
    expect(states("importing")).toEqual(["done", "done", "current"]);
    expect(states("imported")).toEqual(["done", "done", "done"]);
    expect(states("idle")).toEqual(["pending", "pending", "pending"]);
  });
});

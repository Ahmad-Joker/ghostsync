import { describe, expect, it } from "vitest";
import { saveLabel } from "../src/state/save-label.js";

describe("saveLabel", () => {
  it("maps every state; 'Saved locally' only for saved with sequence > 0", () => {
    expect(saveLabel("dirty", { sequence: 5 }).label).toBe("Changes not yet saved");
    expect(saveLabel("saving", { sequence: 5 }).label).toBe("Saving to this device...");
    expect(saveLabel("saved", { sequence: 1 }).label).toBe("Saved locally");
    expect(saveLabel("saved", { sequence: 0 }).label).toBe("Nothing to save yet");
    expect(saveLabel("error", { sequence: 3 }).label).toBe("NOT saved to this device");
    expect(saveLabel("error", { sequence: 3 }).role).toBe("alert");
  });
  it("never claims 'Saved locally' for any non-saved state", () => {
    for (const s of ["dirty", "saving", "error"] as const) {
      for (const sequence of [0, 1, 99]) expect(saveLabel(s, { sequence }).label).not.toContain("Saved locally");
    }
  });
  it("announces only on saved(>0) and error", () => {
    expect(saveLabel("dirty", { sequence: 1 }).announce).toBe(false);
    expect(saveLabel("saving", { sequence: 1 }).announce).toBe(false);
    expect(saveLabel("saved", { sequence: 0 }).announce).toBe(false);
    expect(saveLabel("saved", { sequence: 2 }).announce).toBe(true);
    expect(saveLabel("error", { sequence: 2 }).announce).toBe(true);
  });
});
import { describe, expect, it } from "vitest";
import { offlineCopy, showFirstVisitNotice } from "../src/offline/status-copy.js";

describe("offline copy", () => {
  it("has exact copy for every state", () => {
    expect(offlineCopy("ready")).toBe("Ready to work offline.");
    expect(offlineCopy("registering")).toContain("Stay online until this says");
    expect(offlineCopy("installing")).toContain("Preparing offline use");
    expect(offlineCopy("waiting")).toBe("A new version is ready. Save your work, then update.");
    expect(offlineCopy("unsupported")).toContain("HTTPS or localhost");
    expect(offlineCopy("failed", "precache incomplete")).toBe(
      "Offline use is not available: precache incomplete. You can keep working while online. Your edits still save to this device.",
    );
  });
  it("shows the first-visit notice whenever not ready", () => {
    expect(showFirstVisitNotice("ready")).toBe(false);
    for (const s of ["unsupported", "registering", "installing", "waiting", "failed"] as const) {
      expect(showFirstVisitNotice(s)).toBe(true);
    }
  });
});
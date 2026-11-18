import { describe, expect, it } from "vitest";
import { offlineBannerView, OFFLINE_TITLE } from "../src/ui/offline-banner.js";

describe("offlineBannerView (KW-UNIT-BANNER)", () => {
  it("is visible only while offline and carries the fixed title", () => {
    expect(offlineBannerView(true, "ready", "saved").visible).toBe(false);
    const off = offlineBannerView(false, "ready", "saved");
    expect(off.visible).toBe(true);
    expect(off.title).toBe(OFFLINE_TITLE);
    expect(OFFLINE_TITLE).toBe("The network vanished. Your work didn't.");
  });
  it("says changes still save only when saving works", () => {
    expect(offlineBannerView(false, "ready", "saved").state).toBe("Changes still save on this device.");
    expect(offlineBannerView(false, "ready", "saving").state).toBe("Changes still save on this device.");
  });
  it("never says saved when saving failed or the board is in recovery", () => {
    for (const [phase, save] of [["ready", "error"], ["recovery", "saved"], ["recovery", "error"]] as const) {
      const s = offlineBannerView(false, phase, save).state;
      expect(s).toBe("Changes are NOT saved to this device.");
      expect(s.replace("NOT saved", "")).not.toMatch(/saved|save on/);
    }
  });
  it("before a board is open, only says that a known board still opens", () => {
    expect(offlineBannerView(false, "join", "saved").state).toBe("An incident already opened on this device still opens.");
  });
  it("keeps the reserved slot the same height online and offline by computing the same state line", () => {
    expect(offlineBannerView(true, "ready", "saved").state).toBe(offlineBannerView(false, "ready", "saved").state);
  });
});

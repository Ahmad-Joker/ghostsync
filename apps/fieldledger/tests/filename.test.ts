import { describe, expect, it } from "vitest";
import { capsuleFilename } from "../src/transfer/filename.js";

const now = new Date(Date.UTC(2026, 10, 10, 9, 15, 30));
describe("capsuleFilename", () => {
  it("follows the convention in UTC", () => {
    expect(capsuleFilename("inc-2026-0042", "3f9a1c2e-0000-4000-8000-000000000001", now, "export")).toBe(
      "fieldledger_inc-2026-0042_3f9a1c2e_20261110T091530Z.gscap",
    );
  });
  it("adds the backup suffix", () => {
    expect(capsuleFilename("inc-2026-0042", "3f9a1c2e-0", now, "backup")).toBe(
      "fieldledger_inc-2026-0042_3f9a1c2e_20261110T091530Z_backup.gscap",
    );
  });
  it("sanitizes unexpected characters", () => {
    expect(capsuleFilename("a/b\\c", "x y", now, "export")).toBe("fieldledger_a_b_c_x_y_20261110T091530Z.gscap");
  });
});
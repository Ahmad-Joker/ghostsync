import { describe, expect, it } from "vitest";
import { downloadBytes, type DownloadDeps } from "../src/transfer/export.js";
import { capsuleFilename } from "../src/transfer/filename.js";

const now = new Date(Date.UTC(2026, 10, 10, 9, 15, 30));
describe("capsuleFilename", () => {
  it("follows the convention in UTC", () => {
    expect(capsuleFilename("sprint-board", "0a1b2c3d-1111-4222-8333-444455556666", new Date("2026-03-04T05:06:07Z"), "export")).toBe(
      "patchboard_sprint-board_0a1b2c3d_20260304T050607Z.gscap",
    );
  });
  it("adds the backup suffix", () => {
    expect(capsuleFilename("sprint-board", "0a1b2c3d-1111-4222-8333-444455556666", new Date("2026-03-04T05:06:07Z"), "backup")).toBe(
      "patchboard_sprint-board_0a1b2c3d_20260304T050607Z_backup.gscap",
    );
  });
  it("sanitizes unexpected characters", () => {
    expect(capsuleFilename("a/b\\c", "x y", now, "export")).toBe("patchboard_a_b_c_x_y_20261110T091530Z.gscap");
  });
});
describe("downloadBytes", () => {
  it("clicks one anchor with the filename and revokes the object URL exactly once", () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicks: Array<{ href: string; download: string }> = [];
    const anchor = { href: "", download: "", hidden: false, click: () => clicks.push({ href: anchor.href, download: anchor.download }), remove: () => undefined };
    const deps = {
      urlApi: { createObjectURL: () => (created.push("blob:1"), "blob:1"), revokeObjectURL: (u: string) => void revoked.push(u) },
      doc: { createElement: () => anchor, body: { append: () => undefined } },
      schedule: (fn: () => void) => fn(),
    } as unknown as DownloadDeps;
    downloadBytes(new Uint8Array([1, 2, 3]), "x.gscap", deps);
    expect(created).toEqual(["blob:1"]);
    expect(clicks).toEqual([{ href: "blob:1", download: "x.gscap" }]);
    expect(revoked).toEqual(["blob:1"]);
  });
});
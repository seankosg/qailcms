import { describe, expect, it } from "vitest";
import { runWithConcurrency, verifyItemList, VERIFY_BATCH_MAX } from "./ocs-increment-verify";
import { verifiedKey } from "./ocs-increment-collision";

describe("ocs increment verify", () => {
  it("rejects items missing required fields", () => {
    expect(() => verifyItemList([{ bucket: "b", path: "p" }])).toThrow(/expected_sha256/);
    expect(() =>
      verifyItemList([{ bucket: "b", path: "p", expected_sha256: "aa" }]),
    ).toThrow(/expected_byte_size/);
  });

  it("normalizes hash to lowercase", () => {
    const [it0] = verifyItemList([
      { bucket: "b", path: "p", expected_sha256: "AABB", expected_byte_size: 3 },
    ]);
    expect(it0?.expected_sha256).toBe("aabb");
  });

  it("keeps batch size bounded", () => {
    expect(VERIFY_BATCH_MAX).toBeLessThanOrEqual(50);
  });

  it("runs with bounded concurrency and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("verified key binds bucket/path/hash/size", () => {
    expect(verifiedKey("b", "p", "AB", 10)).toBe("b::p::ab::10");
    expect(verifiedKey("b", "p", "ab", 11)).not.toBe(verifiedKey("b", "p", "ab", 10));
  });
});

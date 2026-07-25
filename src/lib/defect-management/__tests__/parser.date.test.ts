import { describe, it, expect } from "vitest";
import { dohaDateOnly } from "@/lib/time/doha";

// Simulates the Date object xlsx `cellDates:true` produces for a sheet cell
// containing 2027-01-20 — it is built with LOCAL wall-clock components in
// whatever timezone the browser runs in.
function excelWallDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe("pure-date import (day-only) is timezone-invariant", () => {
  it("KST/UTC/Doha all yield the same YYYY-MM-DD via dohaDateOnly", () => {
    // We can't hot-swap process TZ mid-run in JSDOM, so we assert the
    // invariant that dohaDateOnly reads local Y/M/D directly and equals
    // the components the caller passed in. That property is what makes
    // the fix TZ-independent.
    for (const [y, m, d] of [
      [2027, 1, 20],
      [2026, 7, 9],
      [2026, 12, 31],
      [2027, 2, 28],
    ] as const) {
      const v = excelWallDate(y, m, d);
      expect(dohaDateOnly(v)).toBe(
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      );
    }
  });

  it("does not depend on getTime()/toISOString (regression: KST −1 day)", () => {
    const v = excelWallDate(2027, 1, 20);
    // getTime()-based UTC slice would drift by TZ offset; dohaDateOnly must not.
    expect(dohaDateOnly(v)).toBe("2027-01-20");
  });
});
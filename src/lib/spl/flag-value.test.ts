import { describe, expect, it } from "vitest";
import { normalizeSplFlagValue } from "./flag-value";

describe("normalizeSplFlagValue", () => {
  it("사전대로 정규화한다", () => {
    expect(normalizeSplFlagValue("O")).toBe("REQUIRED");
    expect(normalizeSplFlagValue("YES")).toBe("REQUIRED");
    expect(normalizeSplFlagValue("Not yet")).toBe("REQUIRED");
    expect(normalizeSplFlagValue("Rqrd-Not final")).toBe("REQUIRED");
    expect(normalizeSplFlagValue("x")).toBe("N/A");
    expect(normalizeSplFlagValue(" N/A ")).toBe("N/A");
    expect(normalizeSplFlagValue("0")).toBe("N/A");
  });
  it("빈 칸은 null, 사전에 없으면 UNKNOWN", () => {
    expect(normalizeSplFlagValue("")).toBeNull();
    expect(normalizeSplFlagValue(null)).toBeNull();
    expect(normalizeSplFlagValue("??")).toBe("UNKNOWN");
  });
});

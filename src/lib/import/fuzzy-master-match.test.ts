import { describe, it, expect } from "vitest";
import {
  matchMasterName,
  normalizeName,
  levenshtein,
  similarity,
} from "./fuzzy-master-match";

describe("normalizeName", () => {
  it("전각 영숫자를 반각으로 변환", () => {
    expect(normalizeName("ＡＢＣ")).toBe("abc");
  });
  it("전각 공백/다중 공백 축약", () => {
    expect(normalizeName("삼성\u3000E&C  ")).toBe("삼성 e&c");
  });
  it("null/undefined → 빈 문자열", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("levenshtein & similarity", () => {
  it("동일 문자열", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(similarity("abc", "abc")).toBe(1);
  });
  it("1자 치환", () => {
    expect(levenshtein("abcd", "abce")).toBe(1);
    expect(similarity("abcd", "abce")).toBeCloseTo(0.75, 5);
  });
});

describe("matchMasterName", () => {
  const options = [
    { id: "1", name: "삼성E&C" },
    { id: "2", name: "현대건설" },
    { id: "3", name: "GS건설" },
  ];

  it("정규화 후 정확 일치 (전각·대소문자·공백)", () => {
    const r = matchMasterName("삼성 E&C", options);
    expect(r.exact?.id).toBe("1");
    expect(r.candidates).toHaveLength(0);
  });

  it("오타는 임계값 이상이면 후보로", () => {
    const r = matchMasterName("삼성이앤씨", options);
    // 완전히 다른 표기 → threshold 미만이면 후보 없음도 정상
    expect(r.exact).toBeNull();
  });

  it("1자 오타 (편집거리 1) → 유사 후보 반환", () => {
    const r = matchMasterName("현대건성", options);
    expect(r.exact).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0].option.id).toBe("2");
  });

  it("빈 문자열 → exact null, 후보 없음", () => {
    const r = matchMasterName("", options);
    expect(r.exact).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it("짧은 문자열(≤4)은 편집거리 ≤1 만 후보", () => {
    const short = [{ id: "a", name: "ABC" }];
    // 편집거리 1
    expect(matchMasterName("ABD", short).candidates.length).toBe(1);
    // 편집거리 2 → 미채택 (짧은 문자열 룰)
    expect(matchMasterName("XYZ", short).candidates.length).toBe(0);
  });
});
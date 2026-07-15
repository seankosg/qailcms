import { describe, it, expect } from "vitest";
import {
  collectUnresolvedNames,
  applyNameDecisions,
  formatUnresolvedNamesNote,
  type NameFieldSpec,
} from "./master-name-validation";
import type { MasterKind, MasterOption } from "@/hooks/useMasterOptions";

interface Row {
  subcontractor?: string | null;
  hdec_pic?: string | null;
}

const specs: NameFieldSpec<Row>[] = [
  {
    fieldLabel: "Subcontractor",
    masterKind: "subcontractor",
    read: (r) => r.subcontractor,
    write: (r, v) => (r.subcontractor = v),
  },
  {
    fieldLabel: "HDEC PIC",
    masterKind: "hdec_pic",
    read: (r) => r.hdec_pic,
    write: (r, v) => (r.hdec_pic = v),
  },
];

const optionsByKind: Record<MasterKind, readonly MasterOption[]> = {
  subcontractor: [
    { id: "s1", name: "삼성E&C" },
    { id: "s2", name: "현대건설" },
  ],
  subsub: [],
  hdec_pic: [{ id: "p1", name: "김철수" }],
  hdec_eng: [],
};

describe("collectUnresolvedNames", () => {
  it("정확 일치는 결과에 포함되지 않음", () => {
    const rows: Row[] = [{ subcontractor: "삼성E&C", hdec_pic: "김철수" }];
    const r = collectUnresolvedNames(rows, specs, optionsByKind);
    expect(r).toHaveLength(0);
  });

  it("정규화된 정확 일치도 통과 (공백/전각/대소문자)", () => {
    const rows: Row[] = [{ subcontractor: "삼성 E&c" }];
    const r = collectUnresolvedNames(rows, specs, optionsByKind);
    expect(r).toHaveLength(0);
  });

  it("미해결 이름은 occurrences 로 집계", () => {
    const rows: Row[] = [
      { subcontractor: "삼성이앤씨" },
      { subcontractor: "삼성이앤씨" },
      { subcontractor: "새로운회사" },
    ];
    const r = collectUnresolvedNames(rows, specs, optionsByKind);
    expect(r).toHaveLength(2);
    // 빈도순 정렬
    expect(r[0].rawName).toBe("삼성이앤씨");
    expect(r[0].occurrences).toBe(2);
  });

  it("빈 값/공백은 무시", () => {
    const rows: Row[] = [
      { subcontractor: "" },
      { subcontractor: "   " },
      { subcontractor: null },
    ];
    expect(collectUnresolvedNames(rows, specs, optionsByKind)).toHaveLength(0);
  });
});

describe("applyNameDecisions", () => {
  it('action="map" 이면 mappedName 으로 교체', () => {
    const rows: Row[] = [{ subcontractor: "삼성이앤씨" }];
    const decisions = new Map([
      [
        "subcontractor::삼성이앤씨",
        { action: "map" as const, mappedName: "삼성E&C" },
      ],
    ]);
    applyNameDecisions(rows, specs, decisions);
    expect(rows[0].subcontractor).toBe("삼성E&C");
  });

  it('action="skip" 이면 원본 유지', () => {
    const rows: Row[] = [{ subcontractor: "새회사" }];
    const decisions = new Map([
      ["subcontractor::새회사", { action: "skip" as const }],
    ]);
    applyNameDecisions(rows, specs, decisions);
    expect(rows[0].subcontractor).toBe("새회사");
  });

  it("decisions 에 없으면 변경 없음", () => {
    const rows: Row[] = [{ subcontractor: "삼성E&C" }];
    applyNameDecisions(rows, specs, new Map());
    expect(rows[0].subcontractor).toBe("삼성E&C");
  });
});

describe("formatUnresolvedNamesNote", () => {
  it("빈 배열 → 빈 문자열", () => {
    expect(formatUnresolvedNamesNote([])).toBe("");
  });

  it("필드 라벨별 그룹화 요약", () => {
    const rows: Row[] = [
      { subcontractor: "A새회사" },
      { subcontractor: "B새회사" },
      { hdec_pic: "이영희" },
    ];
    const entries = collectUnresolvedNames(rows, specs, optionsByKind);
    const note = formatUnresolvedNamesNote(entries);
    expect(note).toMatch(/^\[master-mapping\]/);
    expect(note).toContain("Subcontractor(2)");
    expect(note).toContain("HDEC PIC(1)");
    expect(note).toContain("이영희");
  });

  it("maxPerKind 초과 시 overflow 표기", () => {
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
      subcontractor: `회사${i}`,
    }));
    const entries = collectUnresolvedNames(rows, specs, optionsByKind);
    const note = formatUnresolvedNamesNote(entries, 3);
    expect(note).toContain("Subcontractor(12)");
    expect(note).toContain("…+9");
  });
});
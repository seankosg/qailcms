import { describe, it, expect } from "vitest";
import type { TeamOption } from "@/lib/team/team-master";
import { canonicalizeTeamOnRows, collectUnknownTeamCodes } from "./team-validation";

const teamOptions: TeamOption[] = [
  { id: "1", code: "MECH", name: "기계", sort_order: 1, is_active: true, aliases: ["설비", "MECHANICAL"] },
  { id: "2", code: "ELEC", name: "전기", sort_order: 2, is_active: true, aliases: ["ELECTRICAL"] },
  { id: "3", code: "ARCH", name: "건축", sort_order: 3, is_active: true, aliases: [] },
];

interface Row {
  team?: string | null;
}

describe("canonicalizeTeamOnRows", () => {
  it("코드 정확 일치 → canonical 로 세팅", () => {
    const rows: Row[] = [{ team: "mech" }, { team: "ELEC" }];
    const res = canonicalizeTeamOnRows(
      rows,
      teamOptions,
      (r) => r.team,
      (r, v) => (r.team = v),
    );
    expect(rows[0].team).toBe("MECH");
    expect(rows[1].team).toBe("ELEC");
    expect(res.unknown).toEqual([]);
    expect(res.nullRows).toBe(0);
  });

  it("별칭(한글/영문) 매칭", () => {
    const rows: Row[] = [{ team: "설비" }, { team: "electrical" }];
    canonicalizeTeamOnRows(
      rows,
      teamOptions,
      (r) => r.team,
      (r, v) => (r.team = v),
    );
    expect(rows[0].team).toBe("MECH");
    expect(rows[1].team).toBe("ELEC");
  });

  it("미등록 코드는 unknown 에 수집되고 원본(정규화) 유지", () => {
    const rows: Row[] = [{ team: "plumb" }, { team: "PLUMB" }];
    const res = canonicalizeTeamOnRows(
      rows,
      teamOptions,
      (r) => r.team,
      (r, v) => (r.team = v),
    );
    expect(res.unknown).toEqual(["PLUMB"]);
    expect(rows[0].team).toBe("PLUMB");
  });

  it("빈/공백/undefined 는 nullRows 로 집계", () => {
    const rows: Row[] = [{ team: "" }, { team: "  " }, { team: null }, { team: undefined }];
    const res = canonicalizeTeamOnRows(
      rows,
      teamOptions,
      (r) => r.team,
      (r, v) => (r.team = v),
    );
    expect(res.nullRows).toBe(4);
    expect(res.unknown).toEqual([]);
  });
});

describe("collectUnknownTeamCodes", () => {
  it("등록/미등록 혼재에서 미등록만 정렬 반환", () => {
    const codes = ["MECH", "PLUMB", "elec", "civil", null, "  "];
    expect(collectUnknownTeamCodes(codes, teamOptions)).toEqual(["CIVIL", "PLUMB"]);
  });
});
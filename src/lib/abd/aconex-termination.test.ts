import { describe, expect, it } from "vitest";
import {
  normalizeAconexBatch,
  resolveTerminationAction,
  type BatchRowLike,
  assertTerminationFieldAllowed,
} from "./aconex-termination";

const row = (o: Partial<BatchRowLike> & { document_no: string }): BatchRowLike => ({
  date_modified: null,
  semantic: "UNKNOWN",
  status_code: null,
  excel_row: null,
  ...o,
});

const existing = (o: Record<string, unknown> = {}) => ({
  is_terminated: true,
  is_active: true,
  aconex_date_modified: "2026-08-01",
  ...o,
});

describe("resolveTerminationAction", () => {
  it("1. Terminated 입력 → set(true)", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-05" }),
      existing: existing({ is_terminated: false }),
      sameDateUnambiguous: true,
    });
    expect(a).toEqual({ kind: "set" });
  });

  it("2. 더 최신 SUBMITTED → clear", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-10" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a).toEqual({ kind: "clear", sameDate: false });
  });

  it("3. 더 최신 A/B/C 회신 → clear", () => {
    for (const sem of ["DAR_APPROVED_A", "DAR_APPROVED_B", "DAR_REJECTED"] as const) {
      const a = resolveTerminationAction({
        row: row({ document_no: "A", semantic: sem, date_modified: "2026-08-10" }),
        existing: existing(),
        sameDateUnambiguous: true,
      });
      expect(a, sem).toEqual({ kind: "clear", sameDate: false });
    }
  });

  it("4. 과거 사건 → 해제 금지", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-07-20" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a.kind).toBe("none");
  });

  it("5. 같은 날짜 + 단일 정상 사건 → clear(sameDate)", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-01" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a).toEqual({ kind: "clear", sameDate: true });
  });

  it("6. 같은 날짜 + 상충 semantic → 해제 금지", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-01" }),
      existing: existing(),
      sameDateUnambiguous: false,
    });
    expect(a.kind).toBe("none");
  });

  it("8. D-code → 해제 금지", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "DAR_REJECTED", date_modified: "2026-08-10", status_code: "D" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a.kind).toBe("none");
  });

  it("9. UNKNOWN → 해제 금지", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "UNKNOWN", date_modified: "2026-08-10" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a.kind).toBe("none");
  });

  it("10. Cancelled/inactive → 자동 복구 금지", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-10" }),
        existing: existing({ is_active: false }),
        sameDateUnambiguous: true,
      }).kind,
    ).toBe("none");
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_CANCELLED", date_modified: "2026-08-10" }),
        existing: existing(),
        sameDateUnambiguous: true,
      }).kind,
    ).toBe("none");
  });

  it("12. 날짜 NULL/파싱 실패 → 해제 금지 + warning", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: null }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(a).toEqual({ kind: "none", warning: "missing_date" });
    const b = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "SUBMITTED", date_modified: "not-a-date" }),
      existing: existing(),
      sameDateUnambiguous: true,
    });
    expect(b).toEqual({ kind: "none", warning: "missing_date" });
  });
});

describe("normalizeAconexBatch", () => {
  it("날짜가 다르면 최신 행만 사용", () => {
    const res = normalizeAconexBatch([
      row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-01", excel_row: 2 }),
      row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 5 }),
    ]);
    expect(res.blockers).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].semantic).toBe("SUBMITTED");
    expect(res.unambiguous.get("A")).toBe(true);
  });

  it("6. 같은 날짜 + 상충 semantic → blocker, 처리 대상에서 제외", () => {
    const res = normalizeAconexBatch([
      row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-09", excel_row: 3 }),
      row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 4 }),
    ]);
    expect(res.rows).toHaveLength(0);
    expect(res.blockers).toEqual([
      { document_no: "A", date_modified: "2026-08-09", semantics: ["EXCLUDED_TERMINATED", "SUBMITTED"] },
    ]);
    expect(res.unambiguous.get("A")).toBe(false);
  });

  it("7. 같은 날짜 + 동일 semantic 중복 → 결정론적 축약(파일 순서 무관)", () => {
    const a = row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 11 });
    const b = row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 4 });
    const r1 = normalizeAconexBatch([a, b]);
    const r2 = normalizeAconexBatch([b, a]);
    expect(r1.rows).toHaveLength(1);
    expect(r1.rows[0].excel_row).toBe(4);
    expect(r2.rows[0].excel_row).toBe(4);
    expect(r1.collapsedDuplicates).toBe(1);
  });

  it("날짜 없는 행은 날짜 있는 행보다 후순위", () => {
    const res = normalizeAconexBatch([
      row({ document_no: "A", semantic: "SUBMITTED", date_modified: null, excel_row: 1 }),
      row({ document_no: "A", semantic: "DAR_APPROVED_A", date_modified: "2026-08-09", excel_row: 9 }),
    ]);
    expect(res.rows[0].semantic).toBe("DAR_APPROVED_A");
    expect(res.blockers).toHaveLength(0);
  });
});

describe("assertTerminationFieldAllowed", () => {
  it("11. allowed 에 is_terminated 없음 → 명시적 blocker", () => {
    expect(() => assertTerminationFieldAllowed(["A", "B"], new Set(["latest_status"]))).toThrowError(
      /TERMINATION_FIELD_NOT_ALLOWED/,
    );
    expect(() =>
      assertTerminationFieldAllowed(["A"], new Set(["latest_status", "is_terminated"])),
    ).not.toThrow();
    expect(() => assertTerminationFieldAllowed([], new Set())).not.toThrow();
  });
});

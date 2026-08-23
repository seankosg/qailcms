import { describe, expect, it } from "vitest";
import {
  normalizeAconexBatch,
  resolveTerminationAction,
  type BatchRowLike,
  assertTerminationFieldsAllowed,
  TERMINATION_REQUIRED_FIELDS,
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

describe("assertTerminationFieldsAllowed", () => {
  const full = new Set<string>(TERMINATION_REQUIRED_FIELDS);

  it("11. allowed 에 is_terminated 없음 → 명시적 blocker", () => {
    expect(() => assertTerminationFieldsAllowed(["A", "B"], new Set(["latest_status"]))).toThrowError(
      /TERMINATION_FIELDS_NOT_ALLOWED/,
    );
    expect(() => assertTerminationFieldsAllowed(["A"], full)).not.toThrow();
    expect(() => assertTerminationFieldsAllowed([], new Set())).not.toThrow();
  });

  it("6*. 필수 4개 중 하나라도 누락 → 누락 필드·표본 포함 blocker", () => {
    for (const f of TERMINATION_REQUIRED_FIELDS) {
      const partial = new Set<string>(TERMINATION_REQUIRED_FIELDS);
      partial.delete(f);
      try {
        assertTerminationFieldsAllowed(["A", "B", "C"], partial);
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e.message).toContain("TERMINATION_FIELDS_NOT_ALLOWED");
        expect(e.message).toContain(f);
        expect(e.message).toContain("A, B, C");
        expect(e.message).toContain("3행");
      }
    }
  });
});

describe("Termination 설정 방향 (§3.1/§3.2)", () => {
  it("2*. 과거 Terminated 사건 → set 금지", () => {
    const a = resolveTerminationAction({
      row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-07-01" }),
      existing: existing({ is_terminated: false }),
      sameDateUnambiguous: true,
    });
    expect(a.kind).toBe("none");
  });

  it("3*. 더 최신 Terminated 사건 → set", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-09-01" }),
        existing: existing({ is_terminated: false }),
        sameDateUnambiguous: true,
      }),
    ).toEqual({ kind: "set" });
  });

  it("동일 날짜 + 단일 Terminated → set / 상충이면 금지", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-01" }),
        existing: existing({ is_terminated: false }),
        sameDateUnambiguous: true,
      }),
    ).toEqual({ kind: "set" });
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-01" }),
        existing: existing({ is_terminated: false }),
        sameDateUnambiguous: false,
      }).kind,
    ).toBe("none");
  });

  it("5*. inactive → 설정 금지", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-09-01" }),
        existing: existing({ is_active: false, is_terminated: false }),
        sameDateUnambiguous: true,
      }).kind,
    ).toBe("none");
  });

  it("Terminated 입력 날짜 없음 → warning, 설정 금지", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: null }),
        existing: existing({ is_terminated: false }),
        sameDateUnambiguous: true,
      }),
    ).toEqual({ kind: "none", warning: "missing_date" });
  });

  it("멱등: 이미 true 인데 같은 날짜 Terminated 재수신 → set(no-op)", () => {
    expect(
      resolveTerminationAction({
        row: row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-01" }),
        existing: existing(),
        sameDateUnambiguous: true,
      }),
    ).toEqual({ kind: "set" });
  });
});

describe("4*. 같은 날짜 Terminated + SUBMITTED → blocker (처리 제외)", () => {
  it("blocker 로 분류되고 rows 에서 빠진다", () => {
    const res = normalizeAconexBatch([
      row({ document_no: "A", semantic: "EXCLUDED_TERMINATED", date_modified: "2026-08-09", excel_row: 2 }),
      row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 3 }),
      row({ document_no: "B", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 4 }),
    ]);
    expect(res.blockers.map((b) => b.document_no)).toEqual(["A"]);
    expect(res.rows.map((r) => r.document_no)).toEqual(["B"]);
  });

  it("7*. blocker 없는 일반 배치 → 축약/판정 결과 불변", () => {
    const res = normalizeAconexBatch([
      row({ document_no: "A", semantic: "SUBMITTED", date_modified: "2026-08-09", excel_row: 2 }),
      row({ document_no: "B", semantic: "DAR_APPROVED_A", date_modified: "2026-08-10", excel_row: 3 }),
    ]);
    expect(res.blockers).toHaveLength(0);
    expect(res.rows).toHaveLength(2);
    expect(res.collapsedDuplicates).toBe(0);
  });
});

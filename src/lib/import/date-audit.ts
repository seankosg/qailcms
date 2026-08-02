import * as XLSX from "xlsx";

/**
 * 임포트 파서에서 사용하는 날짜 감사(audit) 유틸.
 * - `strictParseDateValue`: TM/SM 파서의 toIsoDate와 동일 규칙으로 파싱.
 * - `suggestDateFix`: 파싱 실패 값에 대한 권장 수정값(YYYY-MM-DD) 추정.
 * - `makeDateAudit`: 파서가 셀별로 override/파싱을 처리하며 이슈를 수집하는 헬퍼.
 * TZ 독립 원칙을 지키기 위해 어떤 경로에서도 `new Date(string)` 을 호출하지 않는다.
 */

export interface DateIssue {
  cellRef: string; // e.g. "L123"
  row: number; // 1-based sheet row
  col: number; // 1-based sheet col
  field: string; // canonical field key (plan_start 등)
  header: string; // 시트 헤더 텍스트
  rawValue: string;
  reason: string;
  suggestion: string | null; // ISO YYYY-MM-DD
  ambiguous?: boolean;
}

const MONTHS: Record<string, number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
};

function iso(y: number, mo: number, da: number): string | null {
  if (mo < 1 || mo > 12) return null;
  if (da < 1 || da > 31) return null;
  if (y < 1900 || y > 2999) return null;
  return `${y}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`;
}

/** 파서의 정식 파싱 로직. 성공 시 ISO 문자열, 실패/빈 값은 null. */
export function strictParseDateValue(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    const p = XLSX.SSF?.parse_date_code?.(v);
    if (p && p.y && p.m && p.d) return iso(p.y, p.m, p.d);
    return null;
  }
  if (typeof v !== "string") v = String(v);
  const s = (v as string).trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (["TBD","TBA","PENDING","N/A","NA","#N/A","-","--","0"].includes(up)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(yy, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,4})[\s\-\/.]+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo) return iso(yy, mo, Number(m[1]));
  }
  m = s.match(/^([A-Za-z]{3,4})[\s\-\/.]+(\d{1,2})[\s,\-\/.]+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo) return iso(yy, mo, Number(m[2]));
  }
  return null;
}

/**
 * 파싱 실패한 원본 값을 살펴보고 사용자에게 제시할 권장 수정값을 도출.
 * dd/mm 우선 (Doha 표준). 세그먼트가 12를 초과해 명확한 경우는 자동 판별.
 */
export function suggestDateFix(v: unknown): {
  suggestion: string | null;
  reason: string;
  ambiguous?: boolean;
} {
  if (v == null || v === "") return { suggestion: null, reason: "빈 값" };
  const strict = strictParseDateValue(v);
  if (strict) return { suggestion: strict, reason: "OK" };

  if (typeof v === "number") {
    return { suggestion: null, reason: `엑셀 날짜 serial 로 해석할 수 없는 숫자 (${v})` };
  }

  const s = String(v).trim();
  if (!s) return { suggestion: null, reason: "빈 값" };

  // dd/mm/yyyy or mm/dd/yyyy 재해석
  const m1 = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m1) {
    const a = Number(m1[1]);
    const b = Number(m1[2]);
    const yy = m1[3].length === 2 ? 2000 + Number(m1[3]) : Number(m1[3]);
    if (a > 12 && b <= 12) {
      const cand = iso(yy, b, a);
      return cand
        ? { suggestion: cand, reason: `첫 세그먼트(${a})>12 — dd/mm으로 해석` }
        : { suggestion: null, reason: `범위 밖 값 (${s})` };
    }
    if (b > 12 && a <= 12) {
      const cand = iso(yy, a, b);
      return cand
        ? { suggestion: cand, reason: `두 번째 세그먼트(${b})>12 — mm/dd로 해석`, ambiguous: true }
        : { suggestion: null, reason: `범위 밖 값 (${s})` };
    }
    if (a > 12 && b > 12) {
      return { suggestion: null, reason: `월/일 모두 12 초과 — 유효한 날짜 아님 (${a}/${b})` };
    }
    // 둘 다 ≤12: 모호. dd/mm(Doha 표준) 우선 제안.
    const cand = iso(yy, b, a);
    return cand
      ? { suggestion: cand, reason: `dd/mm 과 mm/dd 모두 가능 — dd/mm로 추정`, ambiguous: true }
      : { suggestion: null, reason: `범위 밖 값 (${s})` };
  }

  // 8자리 숫자 문자열 YYYYMMDD 또는 DDMMYYYY
  const m2 = s.match(/^(\d{8})$/);
  if (m2) {
    const raw = m2[1];
    // YYYYMMDD 우선
    const y1 = Number(raw.slice(0, 4));
    const mo1 = Number(raw.slice(4, 6));
    const da1 = Number(raw.slice(6, 8));
    const c1 = iso(y1, mo1, da1);
    if (c1) return { suggestion: c1, reason: "YYYYMMDD 로 해석" };
    const da2 = Number(raw.slice(0, 2));
    const mo2 = Number(raw.slice(2, 4));
    const y2 = Number(raw.slice(4, 8));
    const c2 = iso(y2, mo2, da2);
    if (c2) return { suggestion: c2, reason: "DDMMYYYY 로 해석", ambiguous: true };
  }

  return { suggestion: null, reason: `지원하지 않는 날짜 형식: "${s}"` };
}

export interface DateAudit {
  issues: DateIssue[];
  overrideAppliedCount: number;
}

export interface DateAuditReadCtx {
  cellRef: string;
  row: number;
  col: number;
  field: string;
  header: string;
}

/**
 * 파서에서 date 컬럼을 읽을 때 사용하는 헬퍼.
 * override(사용자 수정값)가 있으면 그것으로 대체하고, 실패하면 issue 로 기록.
 */
export function makeDateAudit(overrides?: Record<string, string>): {
  audit: DateAudit;
  read: (v: unknown, ctx: DateAuditReadCtx) => string | null;
} {
  const audit: DateAudit = { issues: [], overrideAppliedCount: 0 };
  const ovr = overrides ?? {};
  return {
    audit,
    read: (v, ctx) => {
      const o = ovr[ctx.cellRef];
      if (o != null && String(o).trim() !== "") {
        const parsed = strictParseDateValue(o);
        if (parsed) {
          audit.overrideAppliedCount++;
          return parsed;
        }
        const sug = suggestDateFix(o);
        audit.issues.push({
          ...ctx,
          rawValue: String(o),
          reason: `수정값이 유효하지 않음 — ${sug.reason}`,
          suggestion: sug.suggestion,
          ambiguous: sug.ambiguous,
        });
        return null;
      }
      if (v == null || v === "") return null;
      const parsed = strictParseDateValue(v);
      if (parsed) return parsed;
      const sug = suggestDateFix(v);
      const rawText =
        v instanceof Date
          ? (dohaDateOnly(v) ?? String(v))
          : typeof v === "number"
            ? `${v} (엑셀 serial)`
            : String(v);
      audit.issues.push({
        ...ctx,
        rawValue: rawText,
        reason: sug.reason,
        suggestion: sug.suggestion,
        ambiguous: sug.ambiguous,
      });
      return null;
    },
  };
}

/** row/col(1-based) → 엑셀 셀 주소 문자열 */
export function toCellRef(row: number, col: number): string {
  return `${XLSX.utils.encode_col(col - 1)}${row}`;
}
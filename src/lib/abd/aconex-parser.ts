import * as XLSX from "xlsx";
import { dohaDateOnly } from "@/lib/time/doha";

/**
 * Aconex Export(Docs 시트) 파서.
 * - `Document No` 를 `abd_number` 매칭 키로 사용
 * - `Status` 문자열을 code / 정규화 상태로 분할
 * - `Revision`, `Date Modified` 를 함께 반영
 */

export type AconexApprovalCode = "A" | "B" | "C" | "D" | "UR" | "CX" | "TM";

/**
 * Status + Review Status 조합에서 파생되는 의미론 분류.
 * Date Modified 를 어떤 라운드/스테이지 필드에 라우팅할지 결정한다.
 *
 *  DAR_APPROVED_A  A/Approved                     → 현재 라운드 rN_dar_actual + approval_date
 *  DAR_APPROVED_B  B/Approved with Comments       → 현재 라운드 rN_dar_actual + approval_date
 *  DAR_REJECTED    C/Revise & Resubmit, D/Reject  → 현재 라운드 rN_dar_actual (반려일)
 *  SUBMITTED       For Review / Submitted /
 *                  Under Workflow Review          → 현재 라운드 rN_submission_actual (HDEC 우선)
 *  EXCLUDED_TERMINATED  For Review / Terminated   → 통계 제외 (is_terminated)
 *  EXCLUDED_CANCELLED   Cancelled                 → 통계 제외 (is_terminated)
 *  UNKNOWN         분류 실패                       → 아무 필드도 갱신하지 않음
 */
export type AconexSemantic =
  | "DAR_APPROVED_A"
  | "DAR_APPROVED_B"
  | "DAR_REJECTED"
  | "SUBMITTED"
  | "EXCLUDED_TERMINATED"
  | "EXCLUDED_CANCELLED"
  | "UNKNOWN";

export interface ParsedAconexRow {
  document_no: string;
  revision: string | null;
  status_raw: string | null;
  review_status_raw: string | null;
  status_code: AconexApprovalCode | null;
  status_norm: string | null; // APPROVED / APPROVED WITH COMMENTS / REVISE AND RESUBMIT / REJECTED / UNDER REVIEW / CANCELLED / TERMINATED
  date_modified: string | null; // ISO YYYY-MM-DD
  is_excluded: boolean;         // CX / TM 이면 통계에서 제외 대상
  semantic: AconexSemantic;
  excel_row: number;
  raw: Record<string, any>;
}

export interface ParsedAconexFile {
  file_name: string;
  sheet_name: string;
  rows: ParsedAconexRow[];
  unknown_statuses: Array<{ status: string; count: number }>;
  header_row: number; // 1-based
  total_scanned: number;
}

const STATUS_MAP: Record<string, { code: AconexApprovalCode; norm: string; excluded?: boolean }> = {
  "A - APPROVED": { code: "A", norm: "APPROVED" },
  "B - APPROVED WITH COMMENTS": { code: "B", norm: "APPROVED WITH COMMENTS" },
  "C - REVISE AND RESUBMIT": { code: "C", norm: "REVISE AND RESUBMIT" },
  "D - REJECTED": { code: "D", norm: "REJECTED" },
  "FOR REVIEW": { code: "UR", norm: "UNDER REVIEW" },
  "UNDER REVIEW": { code: "UR", norm: "UNDER REVIEW" },
  "CANCELLED": { code: "CX", norm: "CANCELLED", excluded: true },
  "CANCELED": { code: "CX", norm: "CANCELLED", excluded: true },
  "TERMINATED": { code: "TM", norm: "TERMINATED", excluded: true },
};

function normText(v: any): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function toIso(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const y = v.getUTCFullYear();
    const mo = v.getUTCMonth() + 1;
    const da = v.getUTCDate();
    if (!y || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const p = XLSX.SSF?.parse_date_code?.(v);
    if (!p) return null;
    const { y, m, d } = p;
    if (!y || !m || !d) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const da = Number(dmy[1]), mo = Number(dmy[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const yy = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  const MONTHS: Record<string, number> = {
    jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
  };
  const dMonY = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,4})[\s\-\/.]+(\d{2,4})$/);
  if (dMonY) {
    const da = Number(dMonY[1]);
    const mo = MONTHS[dMonY[2].toLowerCase()];
    const yy = dMonY[3].length === 2 ? 2000 + Number(dMonY[3]) : Number(dMonY[3]);
    if (mo && da >= 1 && da <= 31 && yy >= 1900 && yy <= 2999) {
      return `${yy}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`;
    }
  }
  const monDY = s.match(/^([A-Za-z]{3,4})[\s\-\/.]+(\d{1,2})[\s,\-\/.]+(\d{2,4})$/);
  if (monDY) {
    const mo = MONTHS[monDY[1].toLowerCase()];
    const da = Number(monDY[2]);
    const yy = monDY[3].length === 2 ? 2000 + Number(monDY[3]) : Number(monDY[3]);
    if (mo && da >= 1 && da <= 31 && yy >= 1900 && yy <= 2999) {
      return `${yy}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`;
    }
  }
  return null;
}

function mapStatus(raw: string | null): {
  code: AconexApprovalCode | null;
  norm: string | null;
  excluded: boolean;
} {
  if (!raw) return { code: null, norm: null, excluded: false };
  const key = normText(raw);
  // 대시 표기 정규화: "A – Approved" / "A—Approved" → "A - APPROVED"
  const dashNorm = key.replace(/[–—]/g, "-").replace(/\s*-\s*/g, " - ").trim();
  const hit = STATUS_MAP[dashNorm] ?? STATUS_MAP[key];
  if (hit) return { code: hit.code, norm: hit.norm, excluded: !!hit.excluded };
  // 앞머리 코드만이라도 있으면 부분 매칭
  const prefix = dashNorm.match(/^([A-D])\s*-\s*/);
  if (prefix) {
    const code = prefix[1] as AconexApprovalCode;
    const normMap: Record<string, string> = {
      A: "APPROVED",
      B: "APPROVED WITH COMMENTS",
      C: "REVISE AND RESUBMIT",
      D: "REJECTED",
    };
    return { code, norm: normMap[code], excluded: false };
  }
  return { code: null, norm: null, excluded: false };
}

/**
 * Status + Review Status 조합에서 semantic 을 산출.
 *   - status "For Review" / "" 는 review status 에 따라 갈림
 *   - Terminated / Cancelled 는 is_excluded + semantic 별도
 */
export function resolveAconexMeaning(
  statusRaw: string | null,
  reviewRaw: string | null,
): AconexSemantic {
  const s = normText(statusRaw).replace(/[–—]/g, "-");
  const r = normText(reviewRaw).replace(/[–—]/g, "-");
  // Cancelled → 즉시 EXCLUDED_CANCELLED
  if (s === "CANCELLED" || s === "CANCELED") return "EXCLUDED_CANCELLED";
  // Terminated review status → EXCLUDED_TERMINATED
  if (r === "TERMINATED") return "EXCLUDED_TERMINATED";
  // A / B / C / D 코드 접두
  if (/^A\b/.test(s) || s === "A - APPROVED") return "DAR_APPROVED_A";
  if (/^B\b/.test(s) || s === "B - APPROVED WITH COMMENTS") return "DAR_APPROVED_B";
  if (/^C\b/.test(s) || s === "C - REVISE AND RESUBMIT") return "DAR_REJECTED";
  if (/^D\b/.test(s) || s === "D - REJECTED") return "DAR_REJECTED";
  // 제출/워크플로우 검토 진행 중
  const submittedStatuses = new Set([
    "FOR REVIEW",
    "SUBMITTED",
    "SUBMITTED FOR REVIEW",
    "UNDER REVIEW",
  ]);
  const submittedReviews = new Set([
    "",
    "UNDER WORKFLOW REVIEW",
    "SUBMITTED FOR REVIEW",
    "PENDING",
  ]);
  if (submittedStatuses.has(s) && submittedReviews.has(r)) return "SUBMITTED";
  return "UNKNOWN";
}

/**
 * 상단 30행 안에서 `Document No` + `Status` 셀을 포함한 헤더 행을 찾는다.
 */
function findHeaderRow(ws: XLSX.WorkSheet): { row: number; cols: Record<string, number> } | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const targets: Record<string, string[]> = {
    document_no: ["DOCUMENT NO", "DOC NO", "DOCUMENT NUMBER"],
    revision: ["REVISION", "REV"],
    status: ["STATUS"],
    review_status: ["REVIEW STATUS"],
    date_modified: ["DATE MODIFIED", "MODIFIED DATE"],
    title: ["TITLE"],
  };
  const scanEnd = Math.min(range.s.r + 29, range.e.r);
  for (let r = range.s.r; r <= scanEnd; r++) {
    const found: Record<string, number> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const v = normText(cell?.v);
      if (!v) continue;
      for (const [key, aliases] of Object.entries(targets)) {
        if (found[key] != null) continue;
        if (aliases.includes(v)) found[key] = c;
      }
    }
    if (found.document_no != null && found.status != null) return { row: r, cols: found };
  }
  return null;
}

export async function parseAconexFile(file: File): Promise<ParsedAconexFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  // "Docs" 시트 우선, 없으면 첫 시트
  const sheetName =
    wb.SheetNames.find((n) => n.toUpperCase() === "DOCS") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const hdr = findHeaderRow(ws);
  if (!hdr) {
    throw new Error(
      "Aconex Export 헤더를 찾지 못했습니다 (Document No + Status 컬럼 필요).",
    );
  }
  const ref = ws["!ref"]!;
  const range = XLSX.utils.decode_range(ref);
  const rows: ParsedAconexRow[] = [];
  const unknown = new Map<string, number>();
  const get = (r: number, key: string): any => {
    const c = hdr.cols[key];
    if (c == null) return null;
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell?.v ?? null;
  };
  for (let r = hdr.row + 1; r <= range.e.r; r++) {
    const docNo = String(get(r, "document_no") ?? "").trim();
    if (!docNo) continue;
    const statusRaw = get(r, "status") == null ? null : String(get(r, "status")).trim();
    const reviewRaw =
      get(r, "review_status") == null ? null : String(get(r, "review_status")).trim();
    const mapped = mapStatus(statusRaw);
    const semantic = resolveAconexMeaning(statusRaw, reviewRaw);
    const excluded =
      mapped.excluded ||
      semantic === "EXCLUDED_TERMINATED" ||
      semantic === "EXCLUDED_CANCELLED";
    if (statusRaw && !mapped.code) {
      unknown.set(statusRaw, (unknown.get(statusRaw) ?? 0) + 1);
    }
    rows.push({
      document_no: docNo,
      revision: get(r, "revision") == null ? null : String(get(r, "revision")).trim(),
      status_raw: statusRaw,
      review_status_raw: reviewRaw,
      status_code:
        mapped.code ??
        (semantic === "EXCLUDED_TERMINATED"
          ? "TM"
          : semantic === "EXCLUDED_CANCELLED"
            ? "CX"
            : semantic === "SUBMITTED"
              ? "UR"
              : null),
      status_norm: mapped.norm,
      date_modified: toIso(get(r, "date_modified")),
      is_excluded: excluded,
      semantic,
      excel_row: r + 1,
      raw: {
        document_no: docNo,
        revision: get(r, "revision") ?? null,
        status: statusRaw,
        review_status: reviewRaw,
        date_modified: get(r, "date_modified") ?? null,
        title: get(r, "title") ?? null,
      },
    });
  }
  return {
    file_name: file.name,
    sheet_name: sheetName,
    rows,
    unknown_statuses: Array.from(unknown.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    header_row: hdr.row + 1,
    total_scanned: rows.length,
  };
}

/**
 * Fingerprint 헬퍼 — Aconex Export 파일 여부를 헤더 셋으로 판정.
 * ABD 표준 HDEC 파일(Sl.No + ABD NUMBER)과 구분하는 데 사용.
 */
export function isAconexHeaderSet(headers: string[]): boolean {
  const set = new Set(headers.map((h) => normText(h)));
  return (
    set.has("DOCUMENT NO") &&
    set.has("STATUS") &&
    (set.has("REVIEW STATUS") || set.has("DATE MODIFIED"))
  );
}
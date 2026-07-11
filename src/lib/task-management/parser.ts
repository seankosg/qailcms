import * as XLSX from "xlsx";
import type { Discipline } from "./columns";

export interface ParsedTaskRow {
  rawRowNo: number;
  task_no: string;
  parent_task_no: string | null;
  level: "parent" | "child";
  category: string | null;
  plot: string | null;
  task_name: string | null;
  risk: string | null;
  sub_task_desc: string | null;
  pic: string | null;
  row_type: string | null;
  status_manual: string | null;
  plan_start: string | null;
  plan_end: string | null;
  plan_days: number | null;
  actual_start: string | null;
  actual_progress: number | null;
  plan_progress: number | null;
  progress_variance: number | null;
  forecast_end: string | null;
  slip_days: number | null;
  auto_judgment: string | null;
  sort_order: number;
}

export interface ParseTaskManagementResult {
  dataDate: string | null;
  rows: ParsedTaskRow[];
  warnings: string[];
  parentCount: number;
  childCount: number;
  sheetName: string;
  disciplineHint: Discipline | null;
}

/** Header text → 컬럼 인덱스 (1-based). */
const CANONICAL_HEADERS: Record<string, number> = {
  no: 1,
  category: 2,
  plot: 3,
  "항목": 4,
  "리스크": 5,
  "단계별 세부 업무": 6,
  "담당": 7,
  "유형": 8,
  "상태": 9,
  "계획 시작": 10,
  "계획 완료": 11,
  "계획 일수": 12,
  "실제 시작": 13,
  "실적 진도율": 14,
  "계획 진도율": 15,
  "진도차 (%p)": 16,
  "진도차(%p)": 16,
  "예상 완료": 17,
  "차이 (일)": 18,
  "차이(일)": 18,
  "자동 판정": 19,
};

function normalizeHeader(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim().toLowerCase();
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number") {
    // Excel serial number
    const parsed = XLSX.SSF?.parse_date_code?.(v);
    if (parsed) {
      const y = String(parsed.y).padStart(4, "0");
      const m = String(parsed.m).padStart(2, "0");
      const d = String(parsed.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return toIsoDate(d);
    }
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** numeric(6,4) 안전 반올림 (4자리) */
function toPct4(v: unknown): number | null {
  const n = toNumber(v);
  if (n == null) return null;
  const clamped = Math.max(-9.9999, Math.min(9.9999, n));
  return Math.round(clamped * 10000) / 10000;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** task_no 접두어로 discipline 추정 */
export function inferDiscipline(taskNo: string | null | undefined): Discipline | null {
  if (!taskNo) return null;
  const c = taskNo.trim().charAt(0).toUpperCase();
  if (c === "A") return "건축";
  if (c === "E") return "전기";
  if (c === "M") return "설비";
  return null;
}

/** Row 5 헤더 텍스트를 실제 파일에서 확인하여 컬럼 오프셋을 보정 */
function buildHeaderMap(sheet: XLSX.WorkSheet): {
  map: Record<string, number>;
  warnings: string[];
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S5");
  const map: Record<string, number> = {};
  const warnings: string[] = [];
  const HEADER_ROW = 5; // 1-based
  for (let col = range.s.c; col <= Math.min(range.e.c, 25); col++) {
    const addr = XLSX.utils.encode_cell({ r: HEADER_ROW - 1, c: col });
    const cell = sheet[addr];
    const norm = normalizeHeader(cell?.v);
    if (!norm) continue;
    // 정규 헤더 dictionary와 매칭
    const idx = col + 1;
    map[norm] = idx;
  }
  return { map, warnings };
}

function resolveColumn(
  headerMap: Record<string, number>,
  headerNames: string[],
  canonicalIndex: number,
  warnings: string[],
): number {
  for (const name of headerNames) {
    const key = normalizeHeader(name);
    const idx = headerMap[key];
    if (idx) return idx;
  }
  warnings.push(`헤더 텍스트를 찾지 못함 (${headerNames[0]}) — 기본 위치 ${canonicalIndex}열 사용`);
  return canonicalIndex;
}

function getCell(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet[addr]?.v;
}

/** parent task 3-segment / child task 4-segment 판정 */
function segmentCount(taskNo: string): number {
  return taskNo.split("-").filter((s) => s.length > 0).length;
}

function parentIdOf(taskNo: string): string | null {
  const parts = taskNo.split("-");
  if (parts.length < 4) return null;
  return parts.slice(0, 3).join("-");
}

export async function parseTaskManagementExcel(
  file: File,
): Promise<ParseTaskManagementResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "gantt") ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`'Gantt' 시트를 찾을 수 없습니다`);

  const warnings: string[] = [];

  // Data date at C4
  const c4 = getCell(sheet, 4, 3);
  const dataDate = toIsoDate(c4);
  if (!dataDate) {
    warnings.push("C4 셀에서 Data Date를 읽지 못했습니다.");
  }

  // Header map (row 5)
  const { map: headerMap } = buildHeaderMap(sheet);

  const cols = {
    no: resolveColumn(headerMap, ["No", "no"], 1, warnings),
    category: resolveColumn(headerMap, ["Category"], 2, warnings),
    plot: resolveColumn(headerMap, ["Plot"], 3, warnings),
    task_name: resolveColumn(headerMap, ["항목"], 4, warnings),
    risk: resolveColumn(headerMap, ["리스크"], 5, warnings),
    sub_task_desc: resolveColumn(headerMap, ["단계별 세부 업무"], 6, warnings),
    pic: resolveColumn(headerMap, ["담당"], 7, warnings),
    row_type: resolveColumn(headerMap, ["유형"], 8, warnings),
    status_manual: resolveColumn(headerMap, ["상태"], 9, warnings),
    plan_start: resolveColumn(headerMap, ["계획 시작"], 10, warnings),
    plan_end: resolveColumn(headerMap, ["계획 완료"], 11, warnings),
    plan_days: resolveColumn(headerMap, ["계획 일수"], 12, warnings),
    actual_start: resolveColumn(headerMap, ["실제 시작"], 13, warnings),
    actual_progress: resolveColumn(headerMap, ["실적 진도율"], 14, warnings),
    plan_progress: resolveColumn(headerMap, ["계획 진도율"], 15, warnings),
    progress_variance: resolveColumn(headerMap, ["진도차 (%p)", "진도차(%p)"], 16, warnings),
    forecast_end: resolveColumn(headerMap, ["예상 완료"], 17, warnings),
    slip_days: resolveColumn(headerMap, ["차이 (일)", "차이(일)"], 18, warnings),
    auto_judgment: resolveColumn(headerMap, ["자동 판정"], 19, warnings),
  };

  // Iterate rows 7~
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S1000");
  const rows: ParsedTaskRow[] = [];
  let sort = 0;

  // Cached parent attributes for propagation
  let curParent: {
    task_no: string;
    category: string | null;
    plot: string | null;
    task_name: string | null;
    risk: string | null;
  } | null = null;

  for (let r = 7; r <= Math.min(range.e.r + 1, 5000); r++) {
    const a = toStr(getCell(sheet, r, cols.no));
    const f = toStr(getCell(sheet, r, cols.sub_task_desc));
    if (!a && !f) break;
    if (!a) continue; // task_no is required

    const segs = segmentCount(a);
    const isParent = segs <= 3;
    const level: "parent" | "child" = isParent ? "parent" : "child";

    const cat = toStr(getCell(sheet, r, cols.category));
    const plot = toStr(getCell(sheet, r, cols.plot));
    const taskName = toStr(getCell(sheet, r, cols.task_name));
    const risk = toStr(getCell(sheet, r, cols.risk));

    if (isParent) {
      curParent = {
        task_no: a,
        category: cat,
        plot,
        task_name: taskName,
        risk,
      };
    }

    const propagate = !isParent ? curParent : null;
    const parentNo = isParent ? null : parentIdOf(a) ?? curParent?.task_no ?? null;

    rows.push({
      rawRowNo: r,
      task_no: a,
      parent_task_no: parentNo,
      level,
      category: cat ?? propagate?.category ?? null,
      plot: plot ?? propagate?.plot ?? null,
      task_name: taskName ?? propagate?.task_name ?? null,
      risk: risk ?? propagate?.risk ?? null,
      sub_task_desc: toStr(getCell(sheet, r, cols.sub_task_desc)),
      pic: toStr(getCell(sheet, r, cols.pic)),
      row_type: toStr(getCell(sheet, r, cols.row_type)),
      status_manual: toStr(getCell(sheet, r, cols.status_manual)),
      plan_start: toIsoDate(getCell(sheet, r, cols.plan_start)),
      plan_end: toIsoDate(getCell(sheet, r, cols.plan_end)),
      plan_days: toNumber(getCell(sheet, r, cols.plan_days)),
      actual_start: toIsoDate(getCell(sheet, r, cols.actual_start)),
      actual_progress: toPct4(getCell(sheet, r, cols.actual_progress)),
      plan_progress: toPct4(getCell(sheet, r, cols.plan_progress)),
      progress_variance: toPct4(getCell(sheet, r, cols.progress_variance)),
      forecast_end: toIsoDate(getCell(sheet, r, cols.forecast_end)),
      slip_days: (() => {
        const n = toNumber(getCell(sheet, r, cols.slip_days));
        return n == null ? null : Math.round(n);
      })(),
      auto_judgment: toStr(getCell(sheet, r, cols.auto_judgment)),
      sort_order: sort++,
    });
  }

  const parentCount = rows.filter((r) => r.level === "parent").length;
  const childCount = rows.length - parentCount;
  const disciplineHint = rows.length > 0 ? inferDiscipline(rows[0].task_no) : null;

  return {
    dataDate,
    rows,
    warnings,
    parentCount,
    childCount,
    sheetName,
    disciplineHint,
  };
}
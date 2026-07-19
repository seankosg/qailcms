import * as XLSX from "xlsx";
import type { Discipline } from "./columns";

export interface ParsedTaskRow {
  rawRowNo: number;
  task_no: string;
  main_task_no: string | null;
  level: "main" | "sub";
  category: string | null;
  plot: string | null;
  task_name: string | null;
  risk: string | null;
  sub_task_desc: string | null;
  pic: string | null;
  row_type: string | null;
  /** 원본 파일의 Team/TEAM 컬럼 값 (없으면 null; import 시 discipline 폴백) */
  team: string | null;
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
  dataDateCell: string | null;
  rows: ParsedTaskRow[];
  warnings: string[];
  parentCount: number;
  childCount: number;
  sheetName: string;
  disciplineHint: Discipline | null;
  /** 실제 매핑에 사용된 각 target field의 컬럼 인덱스 (1-based) */
  columnMap: Record<string, number>;
  /** 시트 행 5 헤더 텍스트 요약 (컬럼 매핑 다이얼로그 표시용) */
  sheetHeaders: SheetHeaderEntry[];
}

export interface SheetHeaderEntry {
  col: number; // 1-based
  letter: string; // A, B, ...
  header: string; // row 5 텍스트 (\n → space, trim)
  sample: string | null; // row 7 첫 데이터 셀 값
}

export const TASK_TARGET_FIELDS = [
  "task_no",
  "category",
  "plot",
  "task_name",
  "risk",
  "sub_task_desc",
  "pic",
  "row_type",
  "status_manual",
  "plan_start",
  "plan_end",
  "plan_days",
  "actual_start",
  "actual_progress",
  "plan_progress",
  "progress_variance",
  "forecast_end",
  "slip_days",
  "auto_judgment",
] as const;
export type TaskTargetField = (typeof TASK_TARGET_FIELDS)[number];

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
    // xlsx `cellDates:true` returns local midnight for the sheet's day.
    // Reading UTC components on a positive-offset timezone (e.g. KST)
    // shifts the date back one day, so use local components.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
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
  if (c === "A") return "ARCH";
  if (c === "E") return "ELEC";
  if (c === "M") return "MECH";
  return null;
}

/** Row 5 헤더 텍스트를 실제 파일에서 확인하여 컬럼 오프셋을 보정 */
function buildHeaderMap(sheet: XLSX.WorkSheet): {
  map: Record<string, number>;
  warnings: string[];
  headerRow: number; // 1-based
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S5");
  const warnings: string[] = [];
  const maxCol = Math.min(range.e.c, 25);
  const DEFAULT_HEADER_ROW = 5; // 1-based fallback
  const MIN_HEADER_CELLS = 3;
  const MAX_SCAN_ROWS = 30; // 상단 30행 스캔

  // 가장 많은 정규화 헤더 셀을 가진 행을 헤더로 채택
  let bestRow0 = DEFAULT_HEADER_ROW - 1;
  let bestScore = -1;
  const scanEnd = Math.min(range.s.r + MAX_SCAN_ROWS - 1, range.e.r);
  for (let r = range.s.r; r <= scanEnd; r++) {
    let score = 0;
    for (let c = range.s.c; c <= maxCol; c++) {
      const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      if (normalizeHeader(v)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow0 = r;
    }
  }
  if (bestScore < MIN_HEADER_CELLS) {
    bestRow0 = DEFAULT_HEADER_ROW - 1;
    warnings.push(`헤더 행을 찾지 못해 기본 ${DEFAULT_HEADER_ROW}행을 사용합니다.`);
  } else if (bestRow0 !== DEFAULT_HEADER_ROW - 1) {
    warnings.push(`헤더 행 자동 감지: ${bestRow0 + 1}행부터 읽습니다.`);
  }

  const map: Record<string, number> = {};
  for (let col = range.s.c; col <= maxCol; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: bestRow0, c: col })];
    const norm = normalizeHeader(cell?.v);
    if (!norm) continue;
    map[norm] = col + 1;
  }
  return { map, warnings, headerRow: bestRow0 + 1 };
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

/**
 * 마지막 세그먼트를 제거한 후보 parent id를 반환.
 * 세그먼트 개수 하드코딩을 피하고, 실제 file 내 parent 집합과 대조해
 * 유효 여부를 판단하는 것은 호출부의 역할.
 */
function parentCandidateOf(taskNo: string): string | null {
  const parts = taskNo.split("-").filter((s) => s.length > 0);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("-");
}

export interface ParseTaskManagementOptions {
  extraAliases?: Record<string, string[]>;
  columnOverrides?: Partial<Record<TaskTargetField, number>>;
  /** 사용자가 직접 지정한 Data Date (override). ISO YYYY-MM-DD */
  dataDateOverride?: string | null;
}

export async function parseTaskManagementExcel(
  file: File,
  optsOrAliases?: ParseTaskManagementOptions | Record<string, string[]>,
): Promise<ParseTaskManagementResult> {
  // Backward compat: 두 번째 인자를 aliases 맵으로 넘기던 호출 지원
  const opts: ParseTaskManagementOptions =
    optsOrAliases && "extraAliases" in optsOrAliases
      ? (optsOrAliases as ParseTaskManagementOptions)
      : optsOrAliases && !("columnOverrides" in (optsOrAliases as any))
        ? { extraAliases: optsOrAliases as Record<string, string[]> }
        : {};
  const extraAliases = opts.extraAliases;
  const columnOverrides = opts.columnOverrides ?? {};
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "gantt") ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`'Gantt' 시트를 찾을 수 없습니다`);

  const warnings: string[] = [];

  // Data date: 유연 탐색
  //  1) 사용자 override 우선
  //  2) 행 4에서 라벨 "Data Date" 셀 오른쪽으로 스캔
  //  3) 행 3~5 어디든 라벨 발견 시 같은 행 오른쪽 스캔
  //  4) 여전히 없으면 행 4 A~F를 앞에서부터 스캔
  let dataDate: string | null = null;
  let dataDateCell: string | null = null;
  if (opts.dataDateOverride) {
    dataDate = opts.dataDateOverride;
    dataDateCell = "override";
  }
  const scanForDate = (row: number, startCol: number, endCol: number) => {
    for (let c = startCol; c <= endCol; c++) {
      const v = getCell(sheet, row, c);
      const iso = toIsoDate(v);
      if (iso) {
        return { iso, ref: `${XLSX.utils.encode_col(c - 1)}${row}` };
      }
    }
    return null;
  };
  const looksLikeDataDateLabel = (v: unknown): boolean => {
    if (v == null) return false;
    const s = String(v).replace(/\s+/g, " ").trim().toLowerCase();
    return s.includes("data date") || s.includes("기준일");
  };
  if (!dataDate) {
    // 행 3~5 라벨 탐색
    outer: for (const row of [4, 3, 5]) {
      for (let c = 1; c <= 8; c++) {
        const v = getCell(sheet, row, c);
        if (looksLikeDataDateLabel(v)) {
          const hit = scanForDate(row, c + 1, Math.max(c + 6, 10));
          if (hit) {
            dataDate = hit.iso;
            dataDateCell = hit.ref;
            break outer;
          }
        }
      }
    }
  }
  if (!dataDate) {
    // 행 4 전체 스캔 (A~F)
    const hit = scanForDate(4, 1, 6);
    if (hit) {
      dataDate = hit.iso;
      dataDateCell = hit.ref;
    }
  }
  if (!dataDate) {
    warnings.push("Data Date를 자동으로 읽지 못했습니다. 파일 카드에서 직접 입력하세요.");
  }

  // Header map — 상단 30행 이내 자동 감지
  const { map: headerMap, warnings: headerWarnings, headerRow } = buildHeaderMap(sheet);
  warnings.push(...headerWarnings);
  const headerRow0 = headerRow - 1;
  const dataStart = headerRow + 2; // 1-based 데이터 시작 (헤더 아래 한 줄 건너뜀)

  // 헤더 행 목록 수집 (컬럼 매핑 다이얼로그용)
  const sheetHeaders: SheetHeaderEntry[] = [];
  {
    const rangeAll = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S7");
    const maxCol = Math.min(rangeAll.e.c, 25);
    for (let c = 0; c <= maxCol; c++) {
      const headerCell = sheet[XLSX.utils.encode_cell({ r: headerRow0, c })];
      const raw = headerCell?.v;
      const header = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
      // 데이터 샘플: 데이터 시작 행
      const sampleCell = sheet[XLSX.utils.encode_cell({ r: dataStart - 1, c })];
      const sampleV = sampleCell?.v;
      const sample = sampleV == null || sampleV === "" ? null : String(sampleV).trim();
      sheetHeaders.push({
        col: c + 1,
        letter: XLSX.utils.encode_col(c),
        header,
        sample,
      });
    }
  }

  const withAlias = (target: string, names: string[]): string[] => {
    const extra = extraAliases?.[target] ?? [];
    return [...extra, ...names];
  };
  const pick = (target: TaskTargetField, names: string[], canonical: number): number => {
    const ov = columnOverrides[target];
    if (typeof ov === "number" && ov > 0) return ov;
    return resolveColumn(headerMap, withAlias(target, names), canonical, warnings);
  };

  const cols = {
    no: pick("task_no", ["No", "no", "Task No", "Task No.", "Task Number", "Task_No", "TaskNo", "번호", "작업번호", "업무번호"], 1),
    category: pick("category", ["Category"], 2),
    plot: pick("plot", ["Plot"], 3),
    task_name: pick("task_name", ["항목"], 4),
    risk: pick("risk", ["리스크"], 5),
    sub_task_desc: pick("sub_task_desc", ["단계별 세부 업무"], 6),
    pic: pick("pic", ["담당"], 7),
    row_type: pick("row_type", ["유형"], 8),
    status_manual: pick("status_manual", ["상태"], 9),
    plan_start: pick("plan_start", ["계획 시작"], 10),
    plan_end: pick("plan_end", ["계획 완료"], 11),
    plan_days: pick("plan_days", ["계획 일수"], 12),
    actual_start: pick("actual_start", ["실제 시작"], 13),
    actual_progress: pick("actual_progress", ["실적 진도율"], 14),
    plan_progress: pick("plan_progress", ["계획 진도율"], 15),
    progress_variance: pick("progress_variance", ["진도차 (%p)", "진도차(%p)"], 16),
    forecast_end: pick("forecast_end", ["예상 완료"], 17),
    slip_days: pick("slip_days", ["차이 (일)", "차이(일)"], 18),
    auto_judgment: pick("auto_judgment", ["자동 판정"], 19),
  };

  const columnMap: Record<string, number> = {
    task_no: cols.no,
    category: cols.category,
    plot: cols.plot,
    task_name: cols.task_name,
    risk: cols.risk,
    sub_task_desc: cols.sub_task_desc,
    pic: cols.pic,
    row_type: cols.row_type,
    status_manual: cols.status_manual,
    plan_start: cols.plan_start,
    plan_end: cols.plan_end,
    plan_days: cols.plan_days,
    actual_start: cols.actual_start,
    actual_progress: cols.actual_progress,
    plan_progress: cols.plan_progress,
    progress_variance: cols.progress_variance,
    forecast_end: cols.forecast_end,
    slip_days: cols.slip_days,
    auto_judgment: cols.auto_judgment,
  };

  // Iterate data rows (dataStart~)
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S1000");
  const rows: ParsedTaskRow[] = [];
  let sort = 0;

  // 1-pass: task_no 집합 수집 (prefix 기반 parent 판정 및 parent 검증용)
  const rowEnd = Math.min(range.e.r + 1, 5000);
  const allTaskNos = new Set<string>();
  for (let r = dataStart; r <= rowEnd; r++) {
    const a = toStr(getCell(sheet, r, cols.no));
    const f = toStr(getCell(sheet, r, cols.sub_task_desc));
    if (!a && !f) break;
    if (!a) continue;
    allTaskNos.add(a);
  }
  const parentSet = new Set<string>();
  for (const t of allTaskNos) {
    for (const other of allTaskNos) {
      if (other !== t && other.startsWith(`${t}-`)) {
        parentSet.add(t);
        break;
      }
    }
  }

  // Cached parent attributes for propagation
  let curParent: {
    task_no: string;
    category: string | null;
    plot: string | null;
    task_name: string | null;
    risk: string | null;
  } | null = null;

  // 중복 재번호용: 이미 방출된 task_no 집합. `allTaskNos`와 합쳐 미사용 시퀀스를 찾음.
  const seenTaskNos = new Set<string>();
  const isUsed = (t: string) => seenTaskNos.has(t) || allTaskNos.has(t);
  const findNextTail = (parentPrefix: string): string | null => {
    // 2자리 시퀀스 우선 (01..99), 없으면 3자리(001..999) 폴백
    for (let i = 1; i <= 99; i++) {
      const seq = String(i).padStart(2, "0");
      const cand = `${parentPrefix}-${seq}`;
      if (!isUsed(cand)) return seq;
    }
    for (let i = 1; i <= 999; i++) {
      const seq = String(i).padStart(3, "0");
      const cand = `${parentPrefix}-${seq}`;
      if (!isUsed(cand)) return seq;
    }
    return null;
  };

  for (let r = dataStart; r <= rowEnd; r++) {
    const a = toStr(getCell(sheet, r, cols.no));
    const f = toStr(getCell(sheet, r, cols.sub_task_desc));
    if (!a && !f) break;
    if (!a) continue; // task_no is required

    const isParent = parentSet.has(a);
    const level: "main" | "sub" = isParent ? "main" : "sub";

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
    // 자식이면 우선 curParent(구조적 부모)를 신뢰. 엑셀에 접두어가 잘못 입력된 경우
    // (예: AD-T-07 부모 아래에 AC-T-07-01 로 오타) task_no를 부모 기준으로 교정한다.
    let taskNo = a;
    let parentNo: string | null = null;
    if (!isParent) {
      const cand = parentCandidateOf(a);
      const derivedParent = cand && parentSet.has(cand) ? cand : null;
      const structParent = curParent?.task_no ?? null;
      if (structParent && derivedParent && structParent !== derivedParent) {
        // 접두어 mismatch → 구조적 부모 + 마지막 세그먼트로 재조합
        const lastSeg = a.split("-").slice(3).join("-") || "01";
        const corrected = `${structParent}-${lastSeg}`;
        warnings.push(
          `행 ${r}: task_no '${a}' 접두어가 부모 '${structParent}'와 불일치 → '${corrected}'로 교정`,
        );
        taskNo = corrected;
        parentNo = structParent;
      } else {
        parentNo = derivedParent ?? structParent;
      }
    }

    // 중복 감지 시 자동 재번호. parent/child 모두 동일 접두어 하위에서 미사용 시퀀스 부여.
    if (seenTaskNos.has(taskNo)) {
      const parts = taskNo.split("-");
      const prefix = parts.slice(0, Math.max(1, parts.length - 1)).join("-");
      const next = findNextTail(prefix);
      if (next) {
        const renumbered = `${prefix}-${next}`;
        warnings.push(
          `행 ${r}: task_no '${taskNo}' 중복 → '${renumbered}'로 자동 재번호`,
        );
        taskNo = renumbered;
      } else {
        warnings.push(
          `행 ${r}: task_no '${taskNo}' 중복이나 대체 시퀀스를 찾지 못함 (원본 유지)`,
        );
      }
    }
    seenTaskNos.add(taskNo);

    rows.push({
      rawRowNo: r,
      task_no: taskNo,
      main_task_no: parentNo,
      level,
      category: cat ?? propagate?.category ?? null,
      plot: plot ?? propagate?.plot ?? null,
      task_name: taskName ?? propagate?.task_name ?? null,
      risk: risk ?? propagate?.risk ?? null,
      sub_task_desc: toStr(getCell(sheet, r, cols.sub_task_desc)),
      pic: toStr(getCell(sheet, r, cols.pic)),
      row_type: toStr(getCell(sheet, r, cols.row_type)),
      team: (() => {
        const idx = headerMap["team"] ?? headerMap["팀"];
        return idx ? toStr(getCell(sheet, r, idx)) : null;
      })(),
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

  const parentCount = rows.filter((r) => r.level === "main").length;
  const childCount = rows.length - parentCount;
  const disciplineHint = rows.length > 0 ? inferDiscipline(rows[0].task_no) : null;

  return {
    dataDate,
    dataDateCell,
    rows,
    warnings,
    parentCount,
    childCount,
    sheetName,
    disciplineHint,
    columnMap,
    sheetHeaders,
  };
}
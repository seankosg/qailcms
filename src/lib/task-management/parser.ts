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
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
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
  /** actual_progress===1 이면 forecast_end(=Revise Finish) → dataDate 폴백으로 자동 채움. 그 외 null. */
  actual_finish: string | null;
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
  /** SM 임포트 스타일: 실제 헤더 텍스트 리스트 (letter fallback 포함) */
  availableHeaders: string[];
  /** header 텍스트 → 첫 데이터 행 샘플 값 */
  headerSamples: Record<string, unknown>;
  /** header 텍스트 → canonical field key ("" if unmapped) */
  headerToFieldMap: Record<string, string>;
  /** 사용자가 제외한 header 리스트 (echo) */
  excludedHeaders: string[];
  /** 제외된 canonical field 집합 */
  excludedFields: Set<string>;
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
  "hdec_pic_name",
  "hdec_eng_name",
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

/**
 * canonical alias table. `pick()`가 이 표를 사용하며,
 * `toTaskFieldName()`는 반대 방향(header text → field)에서 사용한다.
 */
const TASK_FIELD_ALIASES: Record<TaskTargetField, string[]> = {
  task_no: ["No", "no", "Task No", "Task No.", "Task Number", "Task_No", "TaskNo", "번호", "작업번호", "업무번호"],
  category: ["Category", "카테고리"],
  plot: ["Plot"],
  task_name: ["항목", "Item", "Task Name"],
  risk: ["리스크", "Risk"],
  sub_task_desc: ["단계별 세부 업무", "세부 업무", "Sub Task", "Subtask", "Sub-task"],
  hdec_pic_name: ["HDEC PIC", "HDEC_PIC", "담당(한글)", "담당(국문)", "담당 (한글)", "담당"],
  hdec_eng_name: ["HDEC ENG", "HDEC_ENG", "담당(영문)", "담당 (영문)", "PIC(ENG)", "PIC (ENG)"],
  row_type: ["유형", "Type"],
  status_manual: ["상태", "Status"],
  plan_start: ["계획 시작", "Plan Start"],
  plan_end: ["계획 완료", "Plan End"],
  plan_days: ["계획 일수", "Plan Days"],
  actual_start: ["실제 시작", "Actual Start"],
  actual_progress: ["실적 진도율", "Actual %"],
  plan_progress: ["계획 진도율", "Plan %"],
  progress_variance: ["진도차 (%p)", "진도차(%p)"],
  forecast_end: ["예상 완료", "Forecast End"],
  slip_days: ["차이 (일)", "차이(일)", "Slip"],
  auto_judgment: ["자동 판정", "Auto Judgment"],
};

export function isKnownTaskField(field: string): boolean {
  return (TASK_TARGET_FIELDS as readonly string[]).includes(field);
}

/** header 텍스트를 canonical target field 로 매핑. 매치 없으면 "". */
export function toTaskFieldName(
  header: string,
  extraAliases: Record<string, string[]> = {},
): string {
  const norm = normalizeHeader(header);
  if (!norm) return "";
  for (const field of TASK_TARGET_FIELDS) {
    const aliases = [...(extraAliases[field] ?? []), ...TASK_FIELD_ALIASES[field]];
    for (const a of aliases) {
      if (normalizeHeader(a) === norm) return field;
    }
  }
  return "";
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
  "hdec pic": 7,
  "hdec eng": 8,
  "유형": 9,
  "상태": 10,
  "계획 시작": 11,
  "계획 완료": 12,
  "계획 일수": 13,
  "실제 시작": 14,
  "실적 진도율": 15,
  "계획 진도율": 16,
  "진도차 (%p)": 17,
  "진도차(%p)": 17,
  "예상 완료": 18,
  "차이 (일)": 19,
  "차이(일)": 19,
  "자동 판정": 20,
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
  if (!col || col < 1) return undefined;
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
  /** 사용자가 체크 해제한 header 텍스트 리스트 */
  excludedHeaders?: string[];
  /** 다중 시트 파일에서 사용자가 선택한 시트명 */
  sheetName?: string;
  /** 사용자가 직접 지정한 Data Date (override). ISO YYYY-MM-DD */
  dataDateOverride?: string | null;
}

/** 워크북의 시트 이름 리스트. */
export async function getTaskExcelSheetNames(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, bookSheets: true });
  return wb.SheetNames ?? [];
}

/** 지정된 시트(미지정 시 'Gantt' 또는 첫 시트)의 헤더/샘플 반환. */
export async function getTaskExcelHeaders(
  file: File,
  sheetName?: string,
): Promise<{
  sheetName: string;
  headers: string[];
  entries: SheetHeaderEntry[];
  sample: Record<string, unknown>;
} | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const name =
    sheetName ??
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "gantt") ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return null;
  const { headerRow } = buildHeaderMap(sheet);
  const headerRow0 = headerRow - 1;
  const dataStart = headerRow + 2;
  const rangeAll = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S7");
  const maxCol = Math.min(rangeAll.e.c, 25);
  const entries: SheetHeaderEntry[] = [];
  const sample: Record<string, unknown> = {};
  for (let c = 0; c <= maxCol; c++) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: headerRow0, c })];
    const raw = headerCell?.v;
    const header = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
    const sampleCell = sheet[XLSX.utils.encode_cell({ r: dataStart - 1, c })];
    const sampleV = sampleCell?.v;
    const s = sampleV == null || sampleV === "" ? null : String(sampleV).trim();
    entries.push({
      col: c + 1,
      letter: XLSX.utils.encode_col(c),
      header,
      sample: s,
    });
    if (s != null) sample[header || XLSX.utils.encode_col(c)] = s;
  }
  const headers = entries.map((e) => e.header || e.letter);
  return { sheetName: name, headers, entries, sample };
}

export async function parseTaskManagementExcel(
  file: File,
  optsOrAliases?: ParseTaskManagementOptions | Record<string, string[]>,
): Promise<ParseTaskManagementResult> {
  // 두 번째 인자를 옵션 객체 또는 aliases 맵으로 받는다.
  const isOptions = (v: unknown): v is ParseTaskManagementOptions =>
    !!v &&
    typeof v === "object" &&
    ("extraAliases" in (v as any) ||
      "excludedHeaders" in (v as any) ||
      "sheetName" in (v as any) ||
      "dataDateOverride" in (v as any));
  const opts: ParseTaskManagementOptions = isOptions(optsOrAliases)
    ? (optsOrAliases as ParseTaskManagementOptions)
    : optsOrAliases
      ? { extraAliases: optsOrAliases as Record<string, string[]> }
      : {};
  const extraAliases = opts.extraAliases;
  const excludedHeadersInput = opts.excludedHeaders ?? [];
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const sheetName =
    opts.sheetName ??
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "gantt") ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);

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
    return resolveColumn(headerMap, withAlias(target, names), canonical, warnings);
  };

  const cols = {
    no: pick("task_no", ["No", "no", "Task No", "Task No.", "Task Number", "Task_No", "TaskNo", "번호", "작업번호", "업무번호"], 1),
    category: pick("category", ["Category"], 2),
    plot: pick("plot", ["Plot"], 3),
    task_name: pick("task_name", ["항목"], 4),
    risk: pick("risk", ["리스크"], 5),
    sub_task_desc: pick("sub_task_desc", ["단계별 세부 업무"], 6),
    hdec_pic_name: pick("hdec_pic_name", ["HDEC PIC", "HDEC_PIC", "담당(한글)", "담당(국문)", "담당 (한글)", "담당"], 7),
    hdec_eng_name: pick("hdec_eng_name", ["HDEC ENG", "HDEC_ENG", "담당(영문)", "담당 (영문)", "PIC(ENG)", "PIC (ENG)"], 8),
    row_type: pick("row_type", ["유형"], 9),
    status_manual: pick("status_manual", ["상태"], 10),
    plan_start: pick("plan_start", ["계획 시작"], 11),
    plan_end: pick("plan_end", ["계획 완료"], 12),
    plan_days: pick("plan_days", ["계획 일수"], 13),
    actual_start: pick("actual_start", ["실제 시작"], 14),
    actual_progress: pick("actual_progress", ["실적 진도율"], 15),
    plan_progress: pick("plan_progress", ["계획 진도율"], 16),
    progress_variance: pick("progress_variance", ["진도차 (%p)", "진도차(%p)"], 17),
    forecast_end: pick("forecast_end", ["예상 완료"], 18),
    slip_days: pick("slip_days", ["차이 (일)", "차이(일)"], 19),
    auto_judgment: pick("auto_judgment", ["자동 판정"], 20),
  };

  // ---- 사용자가 체크 해제한 헤더 처리 ----
  // headerToFieldMap: sheetHeaders의 실제 header 텍스트 → canonical field
  const headerToFieldMap: Record<string, string> = {};
  for (const e of sheetHeaders) {
    const key = e.header || e.letter;
    headerToFieldMap[key] = toTaskFieldName(e.header, extraAliases ?? {});
  }
  const availableHeaders = sheetHeaders.map((e) => e.header || e.letter);
  const headerSamples: Record<string, unknown> = {};
  for (const e of sheetHeaders) {
    if (e.sample != null) headerSamples[e.header || e.letter] = e.sample;
  }
  const excludedFields = new Set<string>();
  for (const h of excludedHeadersInput) {
    const f = headerToFieldMap[h];
    // task_no는 시스템 필수 — 절대 제외 불가
    if (f && f !== "task_no") excludedFields.add(f);
  }
  // excludedFields에 해당하는 cols 를 0으로 클램프
  const clampField = (field: TaskTargetField, key: keyof typeof cols) => {
    if (excludedFields.has(field)) (cols as any)[key] = 0;
  };
  clampField("category", "category");
  clampField("plot", "plot");
  clampField("task_name", "task_name");
  clampField("risk", "risk");
  clampField("sub_task_desc", "sub_task_desc");
  clampField("hdec_pic_name", "hdec_pic_name");
  clampField("hdec_eng_name", "hdec_eng_name");
  clampField("row_type", "row_type");
  clampField("status_manual", "status_manual");
  clampField("plan_start", "plan_start");
  clampField("plan_end", "plan_end");
  clampField("plan_days", "plan_days");
  clampField("actual_start", "actual_start");
  clampField("actual_progress", "actual_progress");
  clampField("plan_progress", "plan_progress");
  clampField("progress_variance", "progress_variance");
  clampField("forecast_end", "forecast_end");
  clampField("slip_days", "slip_days");
  clampField("auto_judgment", "auto_judgment");

  // 단일 "담당" 컬럼만 있고 HDEC ENG가 별도로 매핑되지 않은 경우 자동 분배
  const singlePicColumn =
    cols.hdec_pic_name > 0 && cols.hdec_pic_name === cols.hdec_eng_name;
  const hasHangul = (s: string) => /[\uAC00-\uD7A3]/.test(s);

  const columnMap: Record<string, number> = {
    task_no: cols.no,
    category: cols.category,
    plot: cols.plot,
    task_name: cols.task_name,
    risk: cols.risk,
    sub_task_desc: cols.sub_task_desc,
    hdec_pic_name: cols.hdec_pic_name,
    hdec_eng_name: cols.hdec_eng_name,
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
      ...(() => {
        const picRaw = toStr(getCell(sheet, r, cols.hdec_pic_name));
        const engRaw = singlePicColumn ? null : toStr(getCell(sheet, r, cols.hdec_eng_name));
        if (singlePicColumn) {
          const v = picRaw;
          if (v && hasHangul(v)) return { hdec_pic_name: v, hdec_eng_name: null };
          return { hdec_pic_name: null, hdec_eng_name: v };
        }
        return { hdec_pic_name: picRaw, hdec_eng_name: engRaw };
      })(),
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
    availableHeaders,
    headerSamples,
    headerToFieldMap,
    excludedHeaders: excludedHeadersInput,
    excludedFields,
  };
}
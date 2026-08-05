import * as XLSX from "xlsx";
import { dohaWallToUtcIso, toDohaDateKey, dohaDateOnly } from "@/lib/time/doha";
import type { Discipline } from "./columns";
import { makeDateAudit, toCellRef, strictParseDateValue, type DateIssue } from "@/lib/import/date-audit";

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
  /** 엑셀 '실제 완료' 열에서 읽은 값. 열이 없거나 셀이 비면 null. (자동 보정 없음 — P4-2) */
  actual_finish: string | null;
  /** 엑셀에 '실제 완료' 열이 존재하고 해당 셀이 명시적으로 비어 있는가 (열 자체가 없으면 false) */
  actual_finish_cleared: boolean;
  /** 엑셀 '실적 진도율' 칸에 값이 있었는가 (P4-3 progress_observed_at 주입 조건) */
  progress_cell_present: boolean;
  slip_days: number | null;
  auto_judgment: string | null;
  /** Milestone: HO | COC | DLP (H/O → HO 정규화). 미지정/비인식은 null. */
  milestone: string | null;
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
  /** 날짜 파싱에 실패한 셀 목록. 임포트 UI에서 사용자가 수정. */
  dateIssues: DateIssue[];
  /** A. 헤더를 찾지 못해 임포트에서 제외된 필드 */
  unmappedFields: string[];
  /** B. 값 형태 불일치로 강등된 필드 */
  demotedFields: DemotedField[];
}

export interface SheetHeaderEntry {
  col: number; // 1-based
  letter: string; // A, B, ...
  header: string; // row 5 텍스트 (\n → space, trim)
  sample: string | null; // row 7 첫 데이터 셀 값
}

/** B. 값 형태 검증으로 강등된 필드 */
export interface DemotedField {
  field: string;
  reason: string;
  ratio: number;
  population: number;
  samples: string[];
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
  "team",
  "status_manual",
  "plan_start",
  "plan_end",
  "plan_days",
  "actual_start",
  "actual_progress",
  "plan_progress",
  "progress_variance",
  "forecast_end",
  "actual_finish",
  "slip_days",
  "auto_judgment",
  "milestone",
] as const;
export type TaskTargetField = (typeof TASK_TARGET_FIELDS)[number];

/**
 * canonical alias table. `pick()`가 이 표를 사용하며,
 * `toTaskFieldName()`는 반대 방향(header text → field)에서 사용한다.
 */
const TASK_FIELD_ALIASES: Record<TaskTargetField, string[]> = {
  task_no: ["No", "no", "Task No", "Task No.", "Task Number", "Task_No", "TaskNo", "번호", "작업번호", "업무번호"],
  category: ["Category", "카테고리", "카테고리 1", "구분"],
  plot: ["Plot", "플롯", "동"],
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
  actual_progress: [
    "실적 진도율", "Actual %",
    "Cum. Actual", "Cum Actual", "Cumulative Actual %", "Cumulative Actual",
    "누계 실적", "누계 실적%", "누계실적",
  ],
  plan_progress: [
    "계획 진도율", "Plan %",
    "Cum. Plan", "Cum Plan", "Cumulative Plan %", "Cumulative Plan",
    "누계 계획", "누계 계획%", "누계계획",
  ],
  progress_variance: [
    "진도차 (%p)", "진도차(%p)",
    "Cum. Diff", "Cum Diff", "Cumulative Diff", "Cumulative Difference",
    "Variance (%p)", "Variance(%p)", "Variance",
    "누계 차이", "누계차이", "누계 진도차", "누계진도차",
  ],
  forecast_end: ["예상 완료", "Forecast End"],
  actual_finish: [
    "실제 완료", "실제완료", "실제 완료일", "실제완료일",
    "Actual Finish", "Actual End", "A.Finish", "A. Finish", "완료일",
  ],
  slip_days: ["차이 (일)", "차이(일)", "Slip"],
  auto_judgment: ["자동 판정", "Auto Judgment"],
  milestone: ["Milestone", "milestone", "마일스톤", "M/S", "MS"],
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

function normalizeHeader(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim().toLowerCase();
}

// Tier1 #8: delegate to the shared strictParseDateValue (identical logic —
// verified by diff against ABD/SM copies).
function toIsoDate(v: unknown): string | null {
  try {
    return strictParseDateValue(v);
  } catch {
    return null;
  }
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
  // 엑셀에서 "%" 서식 없이 "30"만 입력된 셀은 30 으로 들어옴.
  // 진도율은 [0,1] 스케일이므로 1 초과 값은 % 로 간주하여 100 으로 나눔.
  const normalized = n > 1 ? n / 100 : n;
  const clamped = Math.max(0, Math.min(1, normalized));
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
  const maxCol = range.e.c; // A-4: 26열 상한 제거(2026-08-05)
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
      // 헤더 후보 점수는 "텍스트 셀"만 센다. Gantt 날짜 열(숫자/Date)이
      // 열 상한 제거(A-4) 이후 헤더 행 감지를 흔드는 것을 막는다.
      if (typeof v === "string" && normalizeHeader(v)) score++;
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

/** §4-3: 과업코드(task_no) 열 탐색에 사용하는 헤더 별칭 정본. 오류 문구에도 그대로 노출한다. */
export const TASK_NO_ALIASES = [
  "No", "no", "Task No", "Task No.", "Task Number", "Task_No", "TaskNo",
  "번호", "작업번호", "업무번호",
];

/**
 * 헤더 텍스트 매칭만으로 컬럼을 찾는다. ★위치·순서·인덱스 폴백 금지(2026-08-05).
 * 못 찾으면 0(미매핑)을 반환하고, getCell(col=0) → undefined → null 로 흘러
 * stripNull 이 걷어낸다.
 */
function resolveColumn(
  headerMap: Record<string, number>,
  headerNames: string[],
  warnings: string[],
  unmapped: string[],
  target: string,
): number {
  for (const name of headerNames) {
    const idx = headerMap[normalizeHeader(name)];
    if (idx) return idx;
  }
  warnings.push(
    `미매핑: ${headerNames[0]} — 헤더를 찾지 못해 이 컬럼은 임포트하지 않습니다`,
  );
  unmapped.push(target);
  return 0;
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
  /** 날짜 오류 셀에 대한 사용자 수정값. { cellRef → 'YYYY-MM-DD' } */
  dateOverrides?: Record<string, string>;
  /**
   * 허용된 Milestone 코드 목록 (tm_milestone_kinds에서 주입).
   * 미지정/빈 배열이면 fallback으로 ['HO','COC','DLP'] 사용.
   * 목록에 없는 값은 null로 저장되며 warnings에 요약 경보가 남는다.
   */
  allowedMilestoneCodes?: string[];
}

/** 워크북의 시트 이름 리스트. */
export async function getTaskExcelSheetNames(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false, bookSheets: true });
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
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
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
  const maxCol = rangeAll.e.c;
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
  const dateOverrides = opts.dateOverrides ?? {};
  const allowedMilestoneSet = new Set<string>(
    (opts.allowedMilestoneCodes && opts.allowedMilestoneCodes.length > 0
      ? opts.allowedMilestoneCodes
      : ["HO", "COC", "DLP"]
    )
      .map((c) => String(c).trim().toUpperCase())
      .filter(Boolean),
  );
  const unknownMilestoneCounts = new Map<string, number>();
  const { audit, read: readDateCell } = makeDateAudit(dateOverrides);
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });

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
    const maxCol = rangeAll.e.c;
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
  const unmappedFields: string[] = [];
  const pick = (target: TaskTargetField, names: string[]): number =>
    resolveColumn(
      headerMap,
      [...withAlias(target, names), ...TASK_FIELD_ALIASES[target]],
      warnings,
      unmappedFields,
      target,
    );

  const cols = {
    // §4-3(2026-08-04): 과업코드는 upsert 키(discipline,task_no) — ★위치 폴백 금지(0).
    // 미매핑이면 아래에서 파싱 자체를 중단한다. 키가 틀리면 되돌릴 수 없다.
    no: pick("task_no", TASK_NO_ALIASES),
    category: pick("category", ["Category"]),
    plot: pick("plot", ["Plot"]),
    task_name: pick("task_name", ["항목"]),
    risk: pick("risk", ["리스크"]),
    sub_task_desc: pick("sub_task_desc", ["단계별 세부 업무"]),
    hdec_pic_name: pick("hdec_pic_name", ["HDEC PIC", "HDEC_PIC", "담당(한글)", "담당(국문)", "담당 (한글)", "담당"]),
    hdec_eng_name: pick("hdec_eng_name", ["HDEC ENG", "HDEC_ENG", "담당(영문)", "담당 (영문)", "PIC(ENG)", "PIC (ENG)"]),
    row_type: pick("row_type", ["유형"]),
    status_manual: pick("status_manual", ["상태"]),
    plan_start: pick("plan_start", ["계획 시작"]),
    plan_end: pick("plan_end", ["계획 완료"]),
    plan_days: pick("plan_days", ["계획 일수"]),
    actual_start: pick("actual_start", ["실제 시작"]),
    actual_progress: pick("actual_progress", ["실적 진도율"]),
    plan_progress: pick("plan_progress", ["계획 진도율"]),
    progress_variance: pick("progress_variance", ["진도차 (%p)", "진도차(%p)"]),
    forecast_end: pick("forecast_end", ["예상 완료"]),
    slip_days: pick("slip_days", ["차이 (일)", "차이(일)"]),
    auto_judgment: pick("auto_judgment", ["자동 판정"]),
    // actual_finish 는 선택 컬럼: ★위치 폴백 금지 (milestone 방식). 헤더가 없으면 0.
    actual_finish: (() => {
      for (const name of withAlias("actual_finish", TASK_FIELD_ALIASES.actual_finish)) {
        const idx = headerMap[normalizeHeader(name)];
        if (idx) return idx;
      }
      return 0;
    })(),
    // Milestone은 선택 컬럼: 헤더가 없으면 21열 폴백을 쓰지 않고 스킵(0).
    milestone: (() => {
      for (const name of withAlias("milestone", ["Milestone", "마일스톤"])) {
        const idx = headerMap[normalizeHeader(name)];
        if (idx) return idx;
      }
      return 0;
    })(),
  };

  // §4-3(2026-08-04): 과업코드 열을 못 찾으면 ★진행 금지. upsert 키(discipline,task_no)가
  // 틀리면 엉뚱한 행이 덮이거나 중복이 대량 생긴다 — 되돌릴 수 없다.
  if (!cols.no) {
    const searched = [...(extraAliases?.["task_no"] ?? []), ...TASK_NO_ALIASES];
    throw new Error(
      `과업코드 열을 찾지 못했습니다. 찾은 이름: ${searched.join(" / ")} — ` +
        `파일의 헤더를 고치거나 [Admin → 매핑 관리(/admin/mapping) → TM 헤더 매핑]에서 별칭을 추가하세요.`,
    );
  }

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
  clampField("actual_finish", "actual_finish");
  clampField("slip_days", "slip_days");
  clampField("auto_judgment", "auto_judgment");
  clampField("milestone", "milestone");

  // ───────────────────────────────────────────────────────────────
  // B. 값 형태 검증 (2026-08-05). 헤더 이름이 맞아도 값의 모양이 필드 정의와
  //    다르면 그 컬럼을 미매핑으로 강등한다. task_no 는 강등 금지 — 예외로 중단.
  // ───────────────────────────────────────────────────────────────
  const demotedFields: DemotedField[] = [];
  {
    const rangeV = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:S1000");
    const scanEndRow = Math.min(rangeV.e.r + 1, 5000);
    const sampleValues = (col: number): string[] => {
      const out: string[] = [];
      for (let r = dataStart; r <= scanEndRow; r++) {
        const v = getCell(sheet, r, col);
        if (v == null || String(v).trim() === "") continue;
        out.push(String(v).trim());
      }
      return out;
    };
    const isDate = (s: string) => {
      // 엑셀 날짜 시리얼(숫자)도 정상 날짜로 본다.
      const n = Number(s);
      if (Number.isFinite(n) && n >= 20000 && n <= 80000) return true;
      try {
        return strictParseDateValue(s) != null;
      } catch {
        return false;
      }
    };
    const isPct = (s: string) => {
      const n = Number(s.replace(/%$/, ""));
      return Number.isFinite(n) && n >= 0 && n <= 100;
    };
    const isInt = (s: string) => {
      const n = Number(s);
      return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
    };
    const isPlot = (s: string) => {
      const u = s.trim().toUpperCase();
      return u === "C" || u === "D";
    };
    // 과업코드 = 영숫자·하이픈·점·슬래시 조합의 짧은 코드. 부분 접두어("ME-D-")도 허용.
    // 한글·공백이 섞인 문장(카테고리·업무명 오매핑)만 걸러낸다.
    const isTaskNo = (s: string) =>
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s) && s.length <= 40;

    const checks: Array<{
      field: TaskTargetField;
      key: keyof typeof cols;
      label: string;
      test: (s: string) => boolean;
      threshold: number;
    }> = [
      { field: "plot", key: "plot", label: "C/D", test: isPlot, threshold: 0.8 },
      { field: "plan_start", key: "plan_start", label: "날짜", test: isDate, threshold: 0.8 },
      { field: "plan_end", key: "plan_end", label: "날짜", test: isDate, threshold: 0.8 },
      { field: "actual_start", key: "actual_start", label: "날짜", test: isDate, threshold: 0.8 },
      { field: "forecast_end", key: "forecast_end", label: "날짜", test: isDate, threshold: 0.8 },
      { field: "actual_finish", key: "actual_finish", label: "날짜", test: isDate, threshold: 0.8 },
      { field: "actual_progress", key: "actual_progress", label: "진도율(0~1 또는 0~100)", test: isPct, threshold: 0.8 },
      { field: "plan_progress", key: "plan_progress", label: "진도율(0~1 또는 0~100)", test: isPct, threshold: 0.8 },
      { field: "plan_days", key: "plan_days", label: "정수", test: isInt, threshold: 0.8 },
      { field: "slip_days", key: "slip_days", label: "정수", test: isInt, threshold: 0.8 },
    ];

    // task_no — 강등 금지. 90% 미만이면 파싱 중단.
    {
      const vals = sampleValues(cols.no);
      if (vals.length > 0) {
        const ok = vals.filter(isTaskNo).length;
        const ratio = ok / vals.length;
        if (ratio < 0.9) {
          const bad = vals.filter((v) => !isTaskNo(v)).slice(0, 3);
          throw new Error(
            `과업코드 열(${cols.no}열)의 값 형태가 과업코드가 아닙니다 ` +
              `(정상 ${Math.round(ratio * 100)}%, 모집단 ${vals.length}행). ` +
              `표본: ${bad.join(", ")} — 헤더 매핑을 확인하세요.`,
          );
        }
      }
    }

    for (const c of checks) {
      const col = (cols as Record<string, number>)[c.key as string];
      if (!col) continue;
      const vals = sampleValues(col);
      if (vals.length === 0) continue; // 값이 없으면 판단하지 않는다
      const ok = vals.filter(c.test).length;
      const ratio = ok / vals.length;
      if (ratio >= c.threshold) continue;
      const samples = vals.filter((v) => !c.test(v)).slice(0, 3);
      (cols as Record<string, number>)[c.key as string] = 0;
      demotedFields.push({
        field: c.field,
        reason: `값 형태 불일치(${c.label} ${Math.round(ratio * 100)}%)`,
        ratio: Math.round(ratio * 1000) / 1000,
        population: vals.length,
        samples,
      });
      warnings.push(
        `${c.field}: 값 형태 불일치(${c.label} ${Math.round(ratio * 100)}%) — 임포트에서 제외. ` +
          `표본: ${samples.join(", ")}`,
      );
    }
  }

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
    actual_finish: cols.actual_finish,
    slip_days: cols.slip_days,
    auto_judgment: cols.auto_judgment,
    milestone: cols.milestone,
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
      // 파일 내 부모 행이 없어도 task_no 가 `<prefix>-<digits>` 형태이면
      // prefix 를 main_task_no 후보로 채택한다. 실제 부모 존재 검증은 DB 트리거가 수행.
      const tailIsNumeric = cand && /^\d+$/.test(a.slice(cand.length + 1));
      const derivedParent = cand && (parentSet.has(cand) || tailIsNumeric) ? cand : null;
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
      plot: (() => {
        const resolved = plot ?? propagate?.plot ?? null;
        if (resolved) return resolved;
        // plot 컬럼이 미매핑·강등되었으면 유도하지 않는다 (제외가 곧 제외여야 한다).
        if (!cols.plot) return null;
        // 방어: plot 공란인데 task_no 두 번째 세그먼트가 C/D 이면 자동 유도
        const seg = taskNo.split("-")[1];
        if (seg === "C" || seg === "D") {
          warnings.push(
            `행 ${r}: plot 공란 → task_no '${taskNo}'의 세그먼트 '${seg}'에서 자동 유도`,
          );
          return seg;
        }
        return null;
      })(),
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
      plan_start: cols.plan_start
        ? readDateCell(getCell(sheet, r, cols.plan_start), {
            cellRef: toCellRef(r, cols.plan_start),
            row: r,
            col: cols.plan_start,
            field: "plan_start",
            header: sheetHeaders.find((h) => h.col === cols.plan_start)?.header || "계획 시작",
          })
        : null,
      plan_end: cols.plan_end
        ? readDateCell(getCell(sheet, r, cols.plan_end), {
            cellRef: toCellRef(r, cols.plan_end),
            row: r,
            col: cols.plan_end,
            field: "plan_end",
            header: sheetHeaders.find((h) => h.col === cols.plan_end)?.header || "계획 완료",
          })
        : null,
      plan_days: toNumber(getCell(sheet, r, cols.plan_days)),
      actual_start: cols.actual_start
        ? readDateCell(getCell(sheet, r, cols.actual_start), {
            cellRef: toCellRef(r, cols.actual_start),
            row: r,
            col: cols.actual_start,
            field: "actual_start",
            header: sheetHeaders.find((h) => h.col === cols.actual_start)?.header || "실제 시작",
          })
        : null,
      actual_progress: toPct4(getCell(sheet, r, cols.actual_progress)),
      plan_progress: toPct4(getCell(sheet, r, cols.plan_progress)),
      progress_variance: toPct4(getCell(sheet, r, cols.progress_variance)),
      forecast_end: cols.forecast_end
        ? readDateCell(getCell(sheet, r, cols.forecast_end), {
            cellRef: toCellRef(r, cols.forecast_end),
            row: r,
            col: cols.forecast_end,
            field: "forecast_end",
            header: sheetHeaders.find((h) => h.col === cols.forecast_end)?.header || "예상 완료",
          })
        : null,
      // P4-1/P4-2: 엑셀 '실제 완료' 열에서만 읽는다. 자동 보정(forecast_end/dataDate 폴백) 없음.
      actual_finish: cols.actual_finish
        ? readDateCell(getCell(sheet, r, cols.actual_finish), {
            cellRef: toCellRef(r, cols.actual_finish),
            row: r,
            col: cols.actual_finish,
            field: "actual_finish",
            header:
              sheetHeaders.find((h) => h.col === cols.actual_finish)?.header || "실제 완료",
          })
        : null,
      actual_finish_cleared: (() => {
        if (!cols.actual_finish) return false;
        const v = getCell(sheet, r, cols.actual_finish);
        return v == null || String(v).trim() === "";
      })(),
      progress_cell_present: (() => {
        if (!cols.actual_progress) return false;
        const v = getCell(sheet, r, cols.actual_progress);
        return v != null && String(v).trim() !== "";
      })(),
      slip_days: (() => {
        const n = toNumber(getCell(sheet, r, cols.slip_days));
        return n == null ? null : Math.round(n);
      })(),
      auto_judgment: toStr(getCell(sheet, r, cols.auto_judgment)),
      milestone: (() => {
        // Milestone 컬럼이 없는 파일도 임포트 가능해야 하므로,
        // 헤더 미탐지(cols.milestone === 0) 및 미등록 값은 안전하게 null 처리.
        // DB FK(task_management_raw_milestone_fk → tm_milestone_kinds.kind_code)만 허용.
        if (!cols.milestone) return null;
        const raw = toStr(getCell(sheet, r, cols.milestone));
        if (!raw) return null;
        const up = raw.trim().toUpperCase().replace(/\s+/g, "");
        const norm = up === "H/O" || up === "H_O" || up === "H-O" ? "HO" : up;
        // Admin에 등록된 kind만 허용. 미등록 값은 null 치환 + 경보 집계.
        if (allowedMilestoneSet.has(norm)) return norm;
        unknownMilestoneCounts.set(norm, (unknownMilestoneCounts.get(norm) ?? 0) + 1);
        return null;
      })(),
      sort_order: sort++,
    });
  }

  const parentCount = rows.filter((r) => r.level === "main").length;
  const childCount = rows.length - parentCount;
  const disciplineHint = rows.length > 0 ? inferDiscipline(rows[0].task_no) : null;

  if (unknownMilestoneCounts.size > 0) {
    const total = Array.from(unknownMilestoneCounts.values()).reduce((a, b) => a + b, 0);
    const detail = Array.from(unknownMilestoneCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([v, c]) => `${v}:${c}`)
      .join(", ");
    warnings.push(
      `미등록 마일스톤 값 ${total}건 (${detail}) — Admin에서 등록 후 재임포트해야 값이 저장됩니다.`,
    );
  }

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
    dateIssues: audit.issues,
    unmappedFields,
    demotedFields,
  } as ParseTaskManagementResult;
}
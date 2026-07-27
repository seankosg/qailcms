import * as XLSX from "xlsx";
import type { DefectTeam } from "./columns";
import { dohaWallToUtcIso, toDohaDateKey, dohaDateOnly } from "@/lib/time/doha";
import { makeDateAudit, toCellRef, strictParseDateValue, type DateIssue } from "@/lib/import/date-audit";

/** Re-import 마커 헤더 — Raw Data에서 재수출한 파일에만 존재. */
export const REIMPORT_MARKER_HEADER = "QAIL_DEFECT_REIMPORT_V1";

/** LetsBuild 원본 25 헤더 → 시스템 필드. */
export const DEFECT_TARGET_FIELDS = [
  "source_issue_no",
  "location_raw",
  "defect_location",
  "plan_title",
  "plan_group",
  "status_raw",
  "assigned_to",
  "category",
  "defect_type",
  "item",
  "description",
  "priority",
  "due_by",
  "created_by_name",
  "created_by_team_name",
  "created_date",
  "ir",
  "forms",
  "last_updated_at",
  "updated_description",
  "updated_by_name",
  "updated_status",
  "updated_date_raw",
  "location_reference",
  "classification",
  "podium_area",
  "building",
  "room",
  "room_group",
  "level_name",
  "review_flag",
] as const;
export type DefectTargetField = (typeof DEFECT_TARGET_FIELDS)[number];

/** 원본 헤더 텍스트 → target field (canonical, case-insensitive). */
const CANONICAL_HEADERS: Record<string, DefectTargetField> = {
  location: "location_raw",
  plantitle: "plan_title",
  plangroup: "plan_group",
  status: "status_raw",
  assignedto: "assigned_to",
  category: "category",
  type: "defect_type",
  item: "item",
  description: "description",
  priority: "priority",
  dueby: "due_by",
  createdby: "created_by_name",
  createdbyteamname: "created_by_team_name",
  createddate: "created_date",
  ir: "ir",
  forms: "forms",
  lastupdated: "last_updated_at",
  updateddescription: "updated_description",
  updatedby: "updated_by_name",
  updatedstatus: "updated_status",
  updateddate: "updated_date_raw",
  locationreference: "location_reference",
  classification: "classification",
  defectlocation: "defect_location",
  "podiumarea": "podium_area",
  building: "building",
  room: "room",
  roomgroup: "room_group",
  level: "level_name",
  reviewflag: "review_flag",
};

const SOURCE_ISSUE_NO_DISPLAY_HEADER_KEYS = new Set([
  "idno",
  "idnumber",
  "issueno",
  "issuenumber",
  "sourceissueno",
  "sourceissuenumber",
  "snagno",
  "snagnumber",
]);

/** Re-import 파일에서 등장 가능한 확장 필드(원본 헤더가 그대로 필드명이라 매핑 필요). */
const EXTRA_REIMPORT_FIELDS = new Set<string>([
  "team",
  "area_type",
  "area_level",
  "area_location",
  "main_trade",
  "sub_trade",
  "work_type",
  "subcontractor_name",
  "subsub_name",
  "hdec_pic_name",
  "hdec_eng_name",
  "hdec_verification",
  "hdec_reason",
  "hdec_comments",
  "planned_start_date",
  "planned_rectified_date",
  "planned_closure_date",
  "actual_start_date",
  "actual_rectified_date",
  "actual_closure_date",
  "planned_progress_pct",
  "actual_progress_pct",
  "rectified_status",
  "closure_status",
  "remarks",
  "data_date",
]);

export interface DefectSheetHeader {
  col: number; // 1-based
  letter: string;
  header: string;
  sample: string | null;
}

export interface ParsedDefectRow {
  rawRowNo: number;
  source_issue_no: string;
  location_raw: string | null;
  defect_location: string | null;
  plan_title: string | null;
  plan_group: string | null;
  status_raw: string | null;
  assigned_to: string | null;
  category: string | null;
  defect_type: string | null;
  item: string | null;
  description: string | null;
  priority: string | null;
  due_by: string | null;
  created_by_name: string | null;
  created_by_team_name: string | null;
  created_date: string | null;
  ir: string | null;
  forms: string | null;
  last_updated_at: string | null;
  updated_description: string | null;
  updated_by_name: string | null;
  updated_status: string | null;
  updated_date_raw: string | null;
  location_reference: string | null;
  classification: string | null;
  podium_area: string | null;
  building: string | null;
  room: string | null;
  room_group: string | null;
  level_name: string | null;
  review_flag: string | null;
  raw_payload: Record<string, unknown>;
  /** Re-import 파일에서만 채워지는 확장 필드. */
  extra?: Record<string, unknown>;
}

export interface ParseDefectResult {
  rows: ParsedDefectRow[];
  sheetName: string;
  sheetHeaders: DefectSheetHeader[];
  columnMap: Record<string, number>;
  warnings: string[];
  categorySummary: string[];
  /** raw header string 순서 리스트 (컬럼 선택 다이얼로그용) */
  availableHeaders: string[];
  /** raw header → 첫 데이터 행 샘플 값 */
  headerSamples: Record<string, unknown>;
  /** raw header → canonical field key (unmapped 이면 빈 문자열) */
  headerToFieldMap: Record<string, string>;
  /** 사용자가 제외한 raw 헤더 (입력 그대로 되돌려줌) */
  excludedHeaders: string[];
  /** 위 raw 헤더에 대응하는 canonical field key 집합. upsert에서 skip 용. */
  excludedFields: Set<string>;
  /** REIMPORT 마커 감지 여부 */
  isReimport: boolean;
  /**
   * source_issue_no(유니크 키)가 어떤 원본 컬럼에서 유래했는지.
   * - "source_issue_no": 재수출 파일의 source_issue_no 헤더 사용
   * - "letsbuild_id": LetsBuild 원본의 ID 헤더를 승격하여 사용
   * - "override": columnOverrides 로 명시 지정
   * - "alias": defect_header_mappings 별칭으로 매칭
   * - null: 미매칭
   */
  sourceKeyOrigin: "source_issue_no" | "letsbuild_id" | "override" | "alias" | null;
  /** UUID 값이 source_issue_no로 감지되어 파싱에서 제외된 행 수 */
  uuidKeyRejectedRows: number;
  /** 날짜 파싱에 실패한 셀 목록. 임포트 UI에서 사용자가 수정. */
  dateIssues: DateIssue[];
}

export interface ParseDefectOptions {
  extraAliases?: Record<string, string[]>;
  columnOverrides?: Partial<Record<DefectTargetField, number>>;
  /** 워크북에서 파싱할 시트 이름. 미지정 시 첫 시트. */
  sheetName?: string;
  /** 사용자가 제외한 raw 헤더. 해당 컬럼은 결과에 포함되지 않음. */
  excludedHeaders?: string[];
  /** 날짜 오류 셀에 대한 사용자 수정값. { cellRef → 'YYYY-MM-DD' } */
  dateOverrides?: Record<string, string>;
}

function normalizeHeader(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, "").trim().toLowerCase();
}

/** RFC 4122 UUID v1~v5 형식 검사. 시스템 재수출 파일의 id 컬럼 방어용. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuidLike(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  return UUID_RE.test(s);
}

/**
 * LetsBuild 원본 형태(재수출이 아닌 최초 export)인지 판정.
 *  - QAIL_DEFECT_REIMPORT_V1 마커 없음
 *  - source_issue_no 헤더 없음
 *  - 원본 시그니처 헤더 3개 이상 동시 존재
 * 조건을 모두 만족하면 ID 컬럼을 source_issue_no 로 승격 가능.
 */
const LETSBUILD_SIGNATURE_HEADERS = [
  "location",
  "plantitle",
  "plangroup",
  "assignedto",
  "category",
  "createddate",
  "lastupdated",
  "locationreference",
] as const;
function looksLikeLetsBuildOriginal(
  headerMap: Record<string, number>,
  isReimport: boolean,
): boolean {
  if (isReimport) return false;
  if (headerMap["source_issue_no"]) return false;
  let matches = 0;
  for (const key of LETSBUILD_SIGNATURE_HEADERS) {
    if (headerMap[key]) matches++;
    if (matches >= 3) return true;
  }
  return false;
}

/**
 * 지정 컬럼의 첫 데이터 행 샘플이 UUID 형식이면 true.
 * scanHeaders 에서 이미 e.sample 로 첫 행 값을 채워둠.
 */
function columnSampleIsUuid(
  entries: DefectSheetHeader[],
  col1based: number,
): boolean {
  const entry = entries.find((e) => e.col === col1based);
  return isUuidLike(entry?.sample);
}

// Tier1 #8: delegate to the shared strictParseDateValue (identical logic —
// verified by diff against ABD/TM copies).
function toIsoDate(v: unknown): string | null {
  try {
    return strictParseDateValue(v);
  } catch {
    return null;
  }
}

function toIsoDateTime(v: unknown): string | null {
  try {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // TZ-independent: read UTC components (SheetJS with cellDates:false
    // never lands here). Interpret as Doha wall-clock.
    return dohaWallToUtcIso(
      v.getUTCFullYear(),
      v.getUTCMonth() + 1,
      v.getUTCDate(),
      v.getUTCHours(),
      v.getUTCMinutes(),
      v.getUTCSeconds(),
    ) || null;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    const parsed = XLSX.SSF?.parse_date_code?.(v);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return dohaWallToUtcIso(
        parsed.y,
        parsed.m,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        Math.floor(parsed.S || 0),
      ) || null;
    }
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const upper = s.toUpperCase();
    if (
      upper === "TBD" || upper === "TBA" || upper === "PENDING" ||
      upper === "N/A" || upper === "NA" || upper === "#N/A" ||
      upper === "-" || upper === "--" || upper === "0"
    ) return null;
    // If the string carries an explicit timezone (Z or ±HH:MM), respect it.
    if (/(Z|[+\-]\d{2}:?\d{2})$/.test(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    // Naive wall-clock: `YYYY-MM-DD[ T]HH:mm(:ss)?` — treat as Doha local.
    const m = s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
    );
    if (m) {
      return dohaWallToUtcIso(
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        Number(m[4] ?? 0),
        Number(m[5] ?? 0),
        Number(m[6] ?? 0),
      ) || null;
    }
    // dd/mm/yyyy [HH:mm[:ss]] (TZ-independent).
    const dmyt = s.match(
      /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
    );
    if (dmyt) {
      const da = Number(dmyt[1]), mo = Number(dmyt[2]);
      const yy = dmyt[3].length === 2 ? 2000 + Number(dmyt[3]) : Number(dmyt[3]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yy >= 1900 && yy <= 2999) {
        return dohaWallToUtcIso(yy, mo, da,
          Number(dmyt[4] ?? 0), Number(dmyt[5] ?? 0), Number(dmyt[6] ?? 0)) || null;
      }
    }
    // No further fallback: never call new Date(string) here (TZ shift).
    return null;
  }
  return null;
  } catch { return null; }
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function getCell(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet[addr]?.v;
}

/** 헤더 행 자동 탐지 후 { canonical map, sheetHeaders, headerRow(0-based) }. 상단 30행 이내 스캔. */
function scanHeaders(sheet: XLSX.WorkSheet): {
  map: Record<string, number>;
  entries: DefectSheetHeader[];
  headerRow: number;
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:Z2");
  const MAX_SCAN = Math.min(range.s.r + 29, range.e.r);
  const MIN_HEADER_CELLS = 3;

  // 가장 많은 정규화 헤더 셀을 가진 행을 헤더로 채택 (동수면 상단 우선)
  let bestRow = 0;
  let bestScore = -1;
  for (let r = range.s.r; r <= MAX_SCAN; r++) {
    let score = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      if (normalizeHeader(v)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  const headerRow = bestScore >= MIN_HEADER_CELLS ? bestRow : 0;

  const map: Record<string, number> = {};
  const entries: DefectSheetHeader[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    const raw = headerCell?.v;
    const header = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
    const norm = normalizeHeader(raw);
    const sampleCell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1, c })];
    const sampleV = sampleCell?.v;
    const sample = sampleV == null || sampleV === "" ? null : String(sampleV).trim();
    entries.push({ col: c + 1, letter: XLSX.utils.encode_col(c), header, sample });
    if (norm) map[norm] = c + 1;
  }
  return { map, entries, headerRow };
}

function resolveColumn(
  headerMap: Record<string, number>,
  target: DefectTargetField,
  extraAliases: string[],
): number | null {
  // 주의: source_issue_no 대상은 이 함수를 사용하지 않는다.
  //  → resolveSourceIssueNoColumn 참고 (UUID 오염 방어 로직 포함).
  const targetNorm = normalizeHeader(target);
  if (headerMap[targetNorm]) return headerMap[targetNorm];
  // canonical
  for (const [h, t] of Object.entries(CANONICAL_HEADERS)) {
    if (t === target && headerMap[h]) return headerMap[h];
  }
  // DB 별칭.
  for (const a of extraAliases) {
    const key = normalizeHeader(a);
    if (!key) continue;
    if (headerMap[key]) return headerMap[key];
  }
  return null;
}

/**
 * source_issue_no 유니크 키 전용 resolver.
 *
 * 파일 형태와 값 형식을 함께 검사하여 시스템 UUID(id) 컬럼이 절대
 * source_issue_no 로 승격되지 않도록 방어한다.
 *
 * 우선순위:
 *  1) columnOverrides.source_issue_no (샘플 UUID이면 거부)
 *  2) 헤더 "source_issue_no" 정확 매칭
 *  3) LetsBuild 원본 파일이고 헤더 "ID"/"id" 존재 (샘플 UUID이면 거부)
 *  4) View-friendly export 표시 헤더(ID No/Issue No 등, 샘플 UUID이면 거부)
 *  5) extraAliases (샘플 UUID이면 거부)
 */
function resolveSourceIssueNoColumn(
  headerMap: Record<string, number>,
  entries: DefectSheetHeader[],
  extraAliases: string[],
  isReimport: boolean,
  overrideCol: number | undefined,
  warnings: string[],
): { col: number | null; origin: ParseDefectResult["sourceKeyOrigin"] } {
  // (1) override
  if (typeof overrideCol === "number" && overrideCol > 0) {
    if (columnSampleIsUuid(entries, overrideCol)) {
      warnings.push(
        "columnOverrides.source_issue_no 로 지정된 컬럼이 UUID 형식이라 무시했습니다. LetsBuild ID 또는 source_issue_no 컬럼을 지정하세요.",
      );
    } else {
      return { col: overrideCol, origin: "override" };
    }
  }

  // (2) source_issue_no 헤더 직접 매칭
  const directCol = headerMap["source_issue_no"];
  if (directCol) {
    if (columnSampleIsUuid(entries, directCol)) {
      warnings.push(
        "source_issue_no 컬럼의 첫 값이 UUID 형식입니다. 파일이 손상되었거나 잘못된 export일 수 있습니다.",
      );
    }
    return { col: directCol, origin: "source_issue_no" };
  }

  // (3) LetsBuild 원본 파일: ID 헤더를 승격
  const looksOriginal = looksLikeLetsBuildOriginal(headerMap, isReimport);
  const idCol = headerMap["id"];
  if (looksOriginal && idCol) {
    if (columnSampleIsUuid(entries, idCol)) {
      warnings.push(
        "ID 컬럼 첫 값이 UUID 형식이라 유니크 키 승격에서 제외했습니다.",
      );
    } else {
      return { col: idCol, origin: "letsbuild_id" };
    }
  }

  // (4) SM Raw Data View-friendly export: 화면 표시용 "ID No" 등을 source_issue_no로 허용
  for (const key of SOURCE_ISSUE_NO_DISPLAY_HEADER_KEYS) {
    const col = headerMap[key];
    if (!col) continue;
    if (columnSampleIsUuid(entries, col)) {
      warnings.push(
        `표시 헤더 "${entries.find((e) => e.col === col)?.header ?? key}" 컬럼의 첫 값이 UUID 형식이라 source_issue_no 매핑에서 제외했습니다.`,
      );
      continue;
    }
    return { col, origin: "alias" };
  }

  // (5) 별칭 매칭. 단, "id" 별칭은 재수출 파일에서 UUID 위험이 있으므로 형식 검사 필수.
  for (const a of extraAliases) {
    const key = normalizeHeader(a);
    if (!key) continue;
    const col = headerMap[key];
    if (!col) continue;
    if (columnSampleIsUuid(entries, col)) {
      warnings.push(
        `별칭 "${a}" 컬럼의 첫 값이 UUID 형식이라 source_issue_no 매핑에서 제외했습니다.`,
      );
      continue;
    }
    // id 별칭은 LetsBuild 원본에서만 허용
    if (key === "id" && !looksOriginal) continue;
    return { col, origin: "alias" };
  }

  return { col: null, origin: null };
}

/** 프로젝트 전역에서 canonical 필드셋. Column Select Dialog의 unmapped 판정 근거. */
export function isKnownDefectField(field: string): boolean {
  if (!field) return false;
  if ((DEFECT_TARGET_FIELDS as readonly string[]).includes(field)) return true;
  return EXTRA_REIMPORT_FIELDS.has(field);
}

/** raw 헤더 → canonical field key. aliases는 defect_header_mappings에서 로드한 목록. */
export function toDefectFieldName(
  rawHeader: string,
  extraAliases: Record<string, string[]> = {},
): string {
  const norm = normalizeHeader(rawHeader);
  if (!norm) return "";
  // Re-import 파일은 raw 헤더가 곧 target field 이름 (예: "source_issue_no", "plan_group",
  // "status_raw", "planned_start_date" …). id 는 시스템 컬럼이라 매핑 제외.
  if (norm === "id") return "";
  if (SOURCE_ISSUE_NO_DISPLAY_HEADER_KEYS.has(norm)) return "source_issue_no";
  for (const t of DEFECT_TARGET_FIELDS) {
    if (normalizeHeader(t) === norm) return t;
  }
  // 원본 헤더가 그대로 확장 필드명인 경우 (re-import 파일)
  const asIs = norm; // note: normalizeHeader lowercases & strips ws
  for (const f of EXTRA_REIMPORT_FIELDS) {
    if (normalizeHeader(f) === asIs) return f;
  }
  // canonical
  const canonical = CANONICAL_HEADERS[norm];
  if (canonical) return canonical;
  // extra aliases (source_header 등록)
  for (const [field, aliases] of Object.entries(extraAliases)) {
    for (const a of aliases) {
      if (normalizeHeader(a) === norm) return field;
    }
  }
  return "";
}

/** 워크북의 시트 이름 리스트. */
export async function getDefectExcelSheetNames(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", bookSheets: true });
  return wb.SheetNames ?? [];
}

/** 지정된 시트(미지정 시 첫 시트)의 헤더/첫 행 샘플/reimport 여부 반환. */
export async function getDefectExcelHeaders(
  file: File,
  sheetName?: string,
): Promise<{
  sheetName: string;
  headers: string[];
  entries: DefectSheetHeader[];
  sample: Record<string, unknown>;
  isReimport: boolean;
} | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const name = sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return null;
  const { entries } = scanHeaders(sheet);
  const headers = entries.map((e) => (e.header ? e.header : e.letter));
  const sample: Record<string, unknown> = {};
  for (const e of entries) {
    if (e.sample != null) sample[e.header || e.letter] = e.sample;
  }
  const isReimport = entries.some(
    (e) => (e.header ?? "").trim().toUpperCase() === REIMPORT_MARKER_HEADER,
  );
  return { sheetName: name, headers, entries, sample, isReimport };
}

export async function parseDefectExcel(
  file: File,
  opts: ParseDefectOptions = {},
): Promise<ParseDefectResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = opts.sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("시트를 찾을 수 없습니다");

  const warnings: string[] = [];
  const { audit: dateAudit, read: readDateCell } = makeDateAudit(opts.dateOverrides ?? {});
  const { map: headerMap, entries, headerRow } = scanHeaders(sheet);
  if (headerRow > 0) {
    warnings.push(`헤더 행 자동 감지: ${headerRow + 1}행부터 읽습니다.`);
  }

  const excludedHeadersInput = opts.excludedHeaders ?? [];
  const excludedHeadersSet = new Set(excludedHeadersInput);
  const availableHeaders = entries.map((e) => e.header || e.letter);
  const headerSamples: Record<string, unknown> = {};
  for (const e of entries) {
    if (e.sample != null) headerSamples[e.header || e.letter] = e.sample;
  }
  const isReimport = entries.some(
    (e) => (e.header ?? "").trim().toUpperCase() === REIMPORT_MARKER_HEADER,
  );

  // raw header → canonical field
  const headerToFieldMap: Record<string, string> = {};
  for (const h of availableHeaders) {
    headerToFieldMap[h] = toDefectFieldName(h, opts.extraAliases ?? {});
  }

  // canonical field 기준 excluded set
  const excludedFields = new Set<string>();
  for (const h of excludedHeadersInput) {
    const f = headerToFieldMap[h];
    if (f) excludedFields.add(f);
  }

  const cols: Partial<Record<DefectTargetField, number>> = {};
  // source_issue_no 는 UUID 오염 방어를 위해 전용 resolver 사용.
  let sourceKeyOrigin: ParseDefectResult["sourceKeyOrigin"] = null;
  if (!excludedFields.has("source_issue_no")) {
    const sk = resolveSourceIssueNoColumn(
      headerMap,
      entries,
      opts.extraAliases?.["source_issue_no"] ?? [],
      isReimport,
      opts.columnOverrides?.source_issue_no,
      warnings,
    );
    if (sk.col) {
      cols.source_issue_no = sk.col;
      sourceKeyOrigin = sk.origin;
      // resolver가 채택한 실제 헤더를 headerToFieldMap에 반영해 다이얼로그가 매핑됨으로 표시.
      const chosen = entries.find((e) => e.col === sk.col);
      const chosenHeader = chosen ? (chosen.header || chosen.letter) : null;
      if (chosenHeader) headerToFieldMap[chosenHeader] = "source_issue_no";
    }
  }
  for (const target of DEFECT_TARGET_FIELDS) {
    if (target === "source_issue_no") continue;
    if (excludedFields.has(target)) continue;
    const ov = opts.columnOverrides?.[target];
    if (typeof ov === "number" && ov > 0) {
      cols[target] = ov;
      continue;
    }
    const aliases = opts.extraAliases?.[target] ?? [];
    const resolved = resolveColumn(headerMap, target, aliases);
    if (resolved) cols[target] = resolved;
  }

  const columnMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(cols)) if (v) columnMap[k] = v;

  const missingCritical: string[] = [];
  if (!cols.source_issue_no) missingCritical.push("ID");
  if (missingCritical.length > 0) {
    warnings.push(`필수 헤더 누락: ${missingCritical.join(", ")}`);
  }
  if (isReimport) {
    warnings.push("Re-import 파일이 감지되었습니다. 신규 행은 생성되지 않고 기존 행만 업데이트됩니다.");
  }

  // 확장 필드 컬럼 (re-import 파일 지원)
  const extraFieldCols = new Map<string, number>();
  for (const e of entries) {
    const raw = e.header || e.letter;
    if (excludedHeadersSet.has(raw)) continue;
    const field = headerToFieldMap[raw];
    if (!field) continue;
    if (EXTRA_REIMPORT_FIELDS.has(field)) {
      extraFieldCols.set(field, e.col);
    }
  }

  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:Z2");
  const rowEnd = range.e.r + 1;
  const dataStart = headerRow + 2; // 1-based 데이터 시작 행
  const rows: ParsedDefectRow[] = [];
  const categoryCounts = new Map<string, number>();
  let uuidKeyRejectedRows = 0;

  for (let r = dataStart; r <= rowEnd; r++) {
    const idRaw = cols.source_issue_no ? getCell(sheet, r, cols.source_issue_no) : null;
    const id = toStr(idRaw);
    if (!id) continue;
    // 방어: 어떤 이유로든 유니크 키에 UUID가 들어오면 해당 행은 폐기한다.
    if (isUuidLike(id)) {
      uuidKeyRejectedRows++;
      continue;
    }

    const raw_payload: Record<string, unknown> = {};
    for (const e of entries) {
      const v = getCell(sheet, r, e.col);
      const rawHeader = e.header || e.letter;
      if (excludedHeadersSet.has(rawHeader)) continue;
      if (v != null && v !== "") raw_payload[rawHeader] = v;
    }

    const category = cols.category ? toStr(getCell(sheet, r, cols.category)) : null;
    if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    // Re-import 확장 필드
    let extra: Record<string, unknown> | undefined;
    if (extraFieldCols.size > 0) {
      extra = {};
      for (const [field, col] of extraFieldCols) {
        const val = getCell(sheet, r, col);
        if (val == null || val === "") continue;
        // 날짜 처리
        if (field.endsWith("_date")) {
          extra[field] = toIsoDate(val);
        } else if (field === "planned_progress_pct" || field === "actual_progress_pct") {
          const n = typeof val === "number" ? val : Number(String(val).replace("%", "").trim());
          extra[field] = Number.isFinite(n) ? n : null;
        } else {
          extra[field] = toStr(val);
        }
      }
    }

    rows.push({
      rawRowNo: r,
      source_issue_no: id,
      location_raw: cols.location_raw ? toStr(getCell(sheet, r, cols.location_raw)) : null,
      defect_location: cols.defect_location ? toStr(getCell(sheet, r, cols.defect_location)) : null,
      plan_title: cols.plan_title ? toStr(getCell(sheet, r, cols.plan_title)) : null,
      plan_group: cols.plan_group ? toStr(getCell(sheet, r, cols.plan_group)) : null,
      status_raw: cols.status_raw ? toStr(getCell(sheet, r, cols.status_raw)) : null,
      assigned_to: cols.assigned_to ? toStr(getCell(sheet, r, cols.assigned_to)) : null,
      category,
      defect_type: cols.defect_type ? toStr(getCell(sheet, r, cols.defect_type)) : null,
      item: cols.item ? toStr(getCell(sheet, r, cols.item)) : null,
      description: cols.description ? toStr(getCell(sheet, r, cols.description)) : null,
      priority: cols.priority ? toStr(getCell(sheet, r, cols.priority)) : null,
      due_by: cols.due_by
        ? readDateCell(getCell(sheet, r, cols.due_by), {
            cellRef: toCellRef(r, cols.due_by),
            row: r,
            col: cols.due_by,
            field: "due_by",
            header: entries.find((e) => e.col === cols.due_by)?.header || "Due by",
          })
        : null,
      created_by_name: cols.created_by_name ? toStr(getCell(sheet, r, cols.created_by_name)) : null,
      created_by_team_name: cols.created_by_team_name ? toStr(getCell(sheet, r, cols.created_by_team_name)) : null,
      created_date: cols.created_date ? toIsoDateTime(getCell(sheet, r, cols.created_date)) : null,
      ir: cols.ir ? toStr(getCell(sheet, r, cols.ir)) : null,
      forms: cols.forms ? toStr(getCell(sheet, r, cols.forms)) : null,
      last_updated_at: cols.last_updated_at ? toIsoDateTime(getCell(sheet, r, cols.last_updated_at)) : null,
      updated_description: cols.updated_description ? toStr(getCell(sheet, r, cols.updated_description)) : null,
      updated_by_name: cols.updated_by_name ? toStr(getCell(sheet, r, cols.updated_by_name)) : null,
      updated_status: cols.updated_status ? toStr(getCell(sheet, r, cols.updated_status)) : null,
      updated_date_raw: cols.updated_date_raw ? toIsoDateTime(getCell(sheet, r, cols.updated_date_raw)) : null,
      location_reference: cols.location_reference ? toStr(getCell(sheet, r, cols.location_reference)) : null,
      classification: cols.classification ? toStr(getCell(sheet, r, cols.classification)) : null,
      podium_area: cols.podium_area ? toStr(getCell(sheet, r, cols.podium_area)) : null,
      building: cols.building ? toStr(getCell(sheet, r, cols.building)) : null,
      room: cols.room ? toStr(getCell(sheet, r, cols.room)) : null,
      room_group: cols.room_group ? toStr(getCell(sheet, r, cols.room_group)) : null,
      level_name: cols.level_name ? toStr(getCell(sheet, r, cols.level_name)) : null,
      review_flag: cols.review_flag ? toStr(getCell(sheet, r, cols.review_flag)) : null,
      raw_payload,
      extra,
    });
  }

  if (uuidKeyRejectedRows > 0) {
    warnings.push(
      `UUID 형식 유니크 키가 감지된 ${uuidKeyRejectedRows}개 행을 폐기했습니다. 시스템 재수출 파일의 id 컬럼이 잘못 매핑된 것으로 추정됩니다.`,
    );
  }

  const categorySummary = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, n]) => `${c} × ${n}`);

  return {
    rows,
    sheetName,
    sheetHeaders: entries,
    columnMap,
    warnings,
    categorySummary,
    availableHeaders,
    headerSamples,
    headerToFieldMap,
    excludedHeaders: excludedHeadersInput,
    excludedFields,
    isReimport,
    sourceKeyOrigin,
    uuidKeyRejectedRows,
    dateIssues: dateAudit.issues,
  };
}

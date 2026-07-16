import * as XLSX from "xlsx";
import type { DefectTeam } from "./columns";

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
  "planned_completion_date",
  "planned_closure_date",
  "actual_start_date",
  "actual_completion_date",
  "actual_closure_date",
  "planned_progress_pct",
  "actual_progress_pct",
  "completion_status",
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
}

export interface ParseDefectOptions {
  extraAliases?: Record<string, string[]>;
  columnOverrides?: Partial<Record<DefectTargetField, number>>;
  /** 워크북에서 파싱할 시트 이름. 미지정 시 첫 시트. */
  sheetName?: string;
  /** 사용자가 제외한 raw 헤더. 해당 컬럼은 결과에 포함되지 않음. */
  excludedHeaders?: string[];
}

function normalizeHeader(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, "").trim().toLowerCase();
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number") {
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
    if (!Number.isNaN(d.getTime())) return toIsoDate(d);
  }
  return null;
}

function toIsoDateTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  if (typeof v === "number") {
    // Excel serial → UTC datetime
    const parsed = XLSX.SSF?.parse_date_code?.(v);
    if (parsed) {
      const d = new Date(
        Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0)),
      );
      return d.toISOString();
    }
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
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

/** Row 1 헤더 스캔 → { canonical map, sheetHeaders }. */
function scanHeaders(sheet: XLSX.WorkSheet): { map: Record<string, number>; entries: DefectSheetHeader[] } {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:Z2");
  const map: Record<string, number> = {};
  const entries: DefectSheetHeader[] = [];
  for (let c = range.s.c; c <= Math.min(range.e.c, 60); c++) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    const raw = headerCell?.v;
    const header = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
    const norm = normalizeHeader(raw);
    const sampleCell = sheet[XLSX.utils.encode_cell({ r: 1, c })];
    const sampleV = sampleCell?.v;
    const sample = sampleV == null || sampleV === "" ? null : String(sampleV).trim();
    entries.push({ col: c + 1, letter: XLSX.utils.encode_col(c), header, sample });
    if (norm) map[norm] = c + 1;
  }
  return { map, entries };
}

function resolveColumn(
  headerMap: Record<string, number>,
  target: DefectTargetField,
  extraAliases: string[],
): number | null {
  // canonical
  for (const [h, t] of Object.entries(CANONICAL_HEADERS)) {
    if (t === target && headerMap[h]) return headerMap[h];
  }
  for (const a of extraAliases) {
    const key = normalizeHeader(a);
    if (headerMap[key]) return headerMap[key];
  }
  return null;
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
  const wb = XLSX.read(buf, { type: "array", cellDates: true, bookSheets: true });
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
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
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
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = opts.sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("시트를 찾을 수 없습니다");

  const warnings: string[] = [];
  const { map: headerMap, entries } = scanHeaders(sheet);

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
  for (const target of DEFECT_TARGET_FIELDS) {
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
  const rows: ParsedDefectRow[] = [];
  const categoryCounts = new Map<string, number>();

  for (let r = 2; r <= rowEnd; r++) {
    const idRaw = cols.source_issue_no ? getCell(sheet, r, cols.source_issue_no) : null;
    const id = toStr(idRaw);
    if (!id) continue;

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
      due_by: cols.due_by ? toIsoDate(getCell(sheet, r, cols.due_by)) : null,
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
  };
}

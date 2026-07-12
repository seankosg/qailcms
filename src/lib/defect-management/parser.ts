import * as XLSX from "xlsx";
import type { DefectTeam } from "./columns";
import { suggestTeamFromCategory } from "./columns";

/** LetsBuild 원본 25 헤더 → 시스템 필드. */
export const DEFECT_TARGET_FIELDS = [
  "source_issue_no",
  "location_raw",
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
] as const;
export type DefectTargetField = (typeof DEFECT_TARGET_FIELDS)[number];

/** 원본 헤더 텍스트 → target field (canonical, case-insensitive). */
const CANONICAL_HEADERS: Record<string, DefectTargetField> = {
  id: "source_issue_no",
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
  "podiumarea": "podium_area",
};

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
  raw_payload: Record<string, unknown>;
}

export interface ParseDefectResult {
  rows: ParsedDefectRow[];
  sheetName: string;
  sheetHeaders: DefectSheetHeader[];
  columnMap: Record<string, number>;
  warnings: string[];
  teamHint: DefectTeam | null;
  categorySummary: string[];
}

export interface ParseDefectOptions {
  extraAliases?: Record<string, string[]>;
  columnOverrides?: Partial<Record<DefectTargetField, number>>;
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

export async function parseDefectExcel(
  file: File,
  opts: ParseDefectOptions = {},
): Promise<ParseDefectResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("시트를 찾을 수 없습니다");

  const warnings: string[] = [];
  const { map: headerMap, entries } = scanHeaders(sheet);

  const cols: Partial<Record<DefectTargetField, number>> = {};
  for (const target of DEFECT_TARGET_FIELDS) {
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
      if (v != null && v !== "") raw_payload[e.header || e.letter] = v;
    }

    const category = cols.category ? toStr(getCell(sheet, r, cols.category)) : null;
    if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    rows.push({
      rawRowNo: r,
      source_issue_no: id,
      location_raw: cols.location_raw ? toStr(getCell(sheet, r, cols.location_raw)) : null,
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
      raw_payload,
    });
  }

  // team hint: most common category → team
  let teamHint: DefectTeam | null = null;
  let bestCount = 0;
  for (const [cat, cnt] of categoryCounts.entries()) {
    const t = suggestTeamFromCategory(cat);
    if (t && cnt > bestCount) {
      teamHint = t;
      bestCount = cnt;
    }
  }

  const categorySummary = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, n]) => `${c} × ${n}`);

  return { rows, sheetName, sheetHeaders: entries, columnMap, warnings, teamHint, categorySummary };
}

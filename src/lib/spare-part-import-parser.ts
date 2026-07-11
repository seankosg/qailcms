import * as XLSX from "xlsx";

/**
 * QAIL Spare Part Excel parser — SHAW-parity architecture.
 * Detects header row within top-25 rows, maps composite headers to canonical
 * fields via FALLBACK_ALIASES + optional user-supplied header_mappings, and
 * emits ParsedSparePartRow objects. Excluded headers are dropped from struct
 * but retained in raw_payload for round-trip safety.
 */

export interface ParsedSparePartRow {
  rawRowNo: number;
  sheetName: string;
  doc_ref: string;
  plot: string;
  raw_payload: Record<string, unknown>;
  custom_payload: Record<string, unknown>;
  struct: Record<string, unknown>;
  issues: {
    technical: string | null;
    supplier: string | null;
    internal: string | null;
  };
}

export interface ParseSparePartResult {
  rows: ParsedSparePartRow[];
  unknownHeaders: string[];
  excludedFields: Set<string>;
  emptyKeyCount: number;
  duplicateKeyCount: number;
}

export interface HeaderInfo {
  headers: string[];
  samples: Record<string, unknown>;
  fieldByHeader: Record<string, string | null>;
}

const DATE_FIELDS = new Set([
  "delivery_date",
  "po_date",
  "spl_approval_date",
  "stage1_date",
  "stage2_date",
  "stage3_date",
  "stage4_date",
  "spl_list_target",
  "quotation_target",
  "po_target",
  "delivery_target",
]);

const NUMERIC_FIELDS = new Set([
  "req_qty",
  "qty_total",
  "qty_delivered",
  "cost_usd",
  "cost_qar",
  "stage2_progress",
  "stage3_progress",
  "stage4_progress",
  "cost_impact_usd",
  "cost_impact_qar",
  "rfq_progress",
  "quotation_progress",
  "po_progress",
  "delivery_progress",
]);

const BOOLEAN_FIELDS = new Set([
  "cert_available",
  "drawing_available",
  "manual_available",
  "spec_available",
  "warranty_available",
  "spl_list_approved",
  "stage1_done",
  "stage2_done",
  "stage3_done",
  "stage4_done",
  "phy",
  "physical_supply",
  "is_duplicate",
  "physical_list_agreed",
  "quotation_done",
  "po_done",
  "delivery_done",
]);

const SYSTEM_SKIP_HEADERS = new Set([
  "id",
  "row_version",
  "raw_payload",
  "custom_payload",
  "updated_by",
  "updated_at",
  "imported_at",
  "is_active",
]);

const FALLBACK_ALIASES: Record<string, string | "skip"> = {
  // Identity
  "doc ref": "doc_ref",
  "doc_ref": "doc_ref",
  "document ref": "doc_ref",
  "document reference": "doc_ref",
  "reference": "doc_ref",
  "ref": "doc_ref",
  "no": "skip",
  "no.": "skip",
  "s/n": "skip",
  "sn": "skip",
  // Plot / category
  "plot": "plot",
  "plot no": "plot",
  "category": "category",
  "system type": "system_type",
  "system": "system_type",
  "subject": "subject",
  // Approval
  "approval code": "approval_code",
  "code": "approval_code",
  "approval status": "approval_status",
  "status": "approval_status",
  "revision": "revision",
  "rev": "revision",
  // Vendor
  "supplier": "supplier",
  "vendor": "supplier",
  "manufacturer": "manufacturer",
  "maker": "manufacturer",
  // Quantities
  "req qty": "req_qty",
  "required qty": "req_qty",
  "req unit": "req_unit",
  "unit": "req_unit",
  "uom": "req_unit",
  "req notes": "req_notes",
  "qty total": "qty_total",
  "total qty": "qty_total",
  "qty delivered": "qty_delivered",
  "delivered": "qty_delivered",
  // Costs
  "cost usd": "cost_usd",
  "usd": "cost_usd",
  "cost qar": "cost_qar",
  "qar": "cost_qar",
  "cost note": "cost_note",
  "cost impact": "cost_impact",
  // Delivery & PO
  "delivery date": "delivery_date",
  "delivery status": "delivery_status",
  "po date": "po_date",
  "po number": "po_number",
  "po no": "po_number",
  // Availability booleans
  "cert available": "cert_available",
  "certificate available": "cert_available",
  "drawing available": "drawing_available",
  "manual available": "manual_available",
  "spec available": "spec_available",
  "warranty available": "warranty_available",
  // Physical & duplicate
  "phy": "phy",
  "physical supply": "physical_supply",
  "is duplicate": "is_duplicate",
  "duplicate": "is_duplicate",
  // SPL
  "spl list approved": "spl_list_approved",
  "spl approval date": "spl_approval_date",
  // Stages
  "stage1 date": "stage1_date",
  "stage1 done": "stage1_done",
  "stage2 date": "stage2_date",
  "stage2 done": "stage2_done",
  "stage2 progress": "stage2_progress",
  "stage3 date": "stage3_date",
  "stage3 done": "stage3_done",
  "stage3 progress": "stage3_progress",
  "stage4 date": "stage4_date",
  "stage4 done": "stage4_done",
  "stage4 progress": "stage4_progress",
  // Issue tracking
  "issue flag": "issue_flag",
  "issue action": "issue_action",
  "issue owner": "issue_owner",
  // Actions & remarks
  "action": "action",
  "remarks": "remarks",
  "remark": "remarks",
  "note": "remarks",
  "proc remarks": "proc_remarks",
  "procurement remarks": "proc_remarks",
};

// snake_case DB 컬럼을 그대로 헤더로 사용하는 파일용 identity 매핑.
// spare_parts_raw 실제 컬럼과 1:1 대응.
const SNAKE_IDENTITY_FIELDS = [
  "doc_ref", "plot", "category", "subject", "system_type",
  "discipline",
  "approval_code", "approval_status", "revision",
  "supplier", "manufacturer",
  "req_qty", "req_unit", "req_notes",
  "qty_total", "qty_delivered",
  "cost_usd", "cost_qar", "cost_note", "cost_impact",
  "cost_impact_usd", "cost_impact_qar",
  "delivery_date", "delivery_status", "po_date", "po_number",
  "cert_available", "drawing_available", "manual_available",
  "spec_available", "warranty_available",
  "phy", "physical_supply", "is_duplicate",
  "physical_list_agreed", "physical_remarks",
  "rec_letter_2y", "rec_letter_5y", "availability_10y", "doc_others",
  "spl_req_contract", "spl_req_mmjv", "spl_req_hdec",
  "spl_list_approved", "spl_approval_date",
  "spl_list_code", "spl_list_target",
  "proc_category", "proc_remarks",
  "issue_flag", "issue_action", "issue_owner",
  "stage1_date", "stage1_done",
  "stage2_date", "stage2_done", "stage2_progress",
  "stage3_date", "stage3_done", "stage3_progress",
  "stage4_date", "stage4_done", "stage4_progress",
  "rfq_progress",
  "quotation_progress", "quotation_target", "quotation_done",
  "po_progress", "po_target", "po_done",
  "delivery_progress", "delivery_target", "delivery_done",
  "action", "remarks",
];
for (const f of SNAKE_IDENTITY_FIELDS) {
  if (!(f in FALLBACK_ALIASES)) FALLBACK_ALIASES[f] = f;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.:_]+$/g, "")
    .trim();
}

function toText(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/[, ]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["y", "yes", "true", "1", "o", "ok", "available", "done"].includes(s)) return true;
  if (["n", "no", "false", "0", "x", "na", "n/a", "-"].includes(s)) return false;
  return null;
}

function excelSerialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + n * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToDate(value);
  const s = String(value).trim();
  if (!s) return null;
  // dd-mmm / dd-MMM-yyyy / yyyy-mm-dd / dd/mm/yyyy
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const yy = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${yy}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function mapHeader(
  header: string,
  userMap: Record<string, string> | undefined,
): string | "skip" | null {
  const raw = String(header ?? "").trim();
  if (!raw || raw.startsWith("__")) return "skip";
  const norm = normalizeHeader(raw);
  if (!norm) return "skip";
  if (SYSTEM_SKIP_HEADERS.has(norm)) return "skip";
  if (userMap && userMap[norm]) return userMap[norm];
  return FALLBACK_ALIASES[norm] ?? null;
}

function detectHeaderRow(
  matrix: unknown[][],
  userMap?: Record<string, string>,
): { idx: number; cols: Array<{ raw: string; field: string | "skip" | null }> } | null {
  const limit = Math.min(matrix.length, 25);
  let best: {
    idx: number;
    score: number;
    cols: Array<{ raw: string; field: string | "skip" | null }>;
  } | null = null;
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? [];
    let score = 0;
    const cols: Array<{ raw: string; field: string | "skip" | null }> = [];
    for (const cell of row) {
      const raw = String(cell ?? "").trim();
      const m = raw ? mapHeader(raw, userMap) : null;
      if (m && m !== "skip") score++;
      cols.push({ raw, field: m });
    }
    if (!best || score > best.score) best = { idx: r, score, cols };
  }
  if (!best || best.score < 2) return null;
  return { idx: best.idx, cols: best.cols };
}

export async function getSparePartExcelSheetNames(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames;
}

export async function getSparePartHeaderInfo(
  file: File,
  selectedSheets: string[] | undefined,
  userMap?: Record<string, string>,
): Promise<HeaderInfo> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheets =
    selectedSheets && selectedSheets.length > 0 ? selectedSheets : wb.SheetNames;
  const seen = new Set<string>();
  const headers: string[] = [];
  const samples: Record<string, unknown> = {};
  const fieldByHeader: Record<string, string | null> = {};
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as unknown[][];
    const det = detectHeaderRow(matrix, userMap);
    if (!det) continue;
    for (const c of det.cols) {
      if (!c.raw || seen.has(c.raw)) continue;
      seen.add(c.raw);
      headers.push(c.raw);
      fieldByHeader[c.raw] = c.field && c.field !== "skip" ? c.field : null;
    }
    const startRow = det.idx + 1;
    const lastRow = Math.min(matrix.length, startRow + 30);
    for (let r = startRow; r < lastRow; r++) {
      const dr = matrix[r] ?? [];
      for (let c = 0; c < det.cols.length; c++) {
        const label = det.cols[c].raw;
        if (!label || samples[label] != null) continue;
        const v = dr[c];
        if (v != null && String(v).trim() !== "") samples[label] = v;
      }
    }
  }
  return { headers, samples, fieldByHeader };
}

export async function parseSparePartExcel(
  file: File,
  selectedSheets: string[] | undefined,
  options: {
    excludedHeaders?: string[];
    userMap?: Record<string, string>;
    customFieldNames?: Set<string>;
  },
): Promise<ParseSparePartResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheets =
    selectedSheets && selectedSheets.length > 0 ? selectedSheets : wb.SheetNames;
  const excludedSet = new Set(
    (options.excludedHeaders ?? []).map((h) => h.trim()).filter(Boolean),
  );
  const excludedFields = new Set<string>();
  const unknown = new Set<string>();
  const customFieldNames = options.customFieldNames ?? new Set<string>();
  const rows: ParsedSparePartRow[] = [];
  const seen = new Set<string>();
  let emptyKeyCount = 0;
  let duplicateKeyCount = 0;

  for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as unknown[][];
    const det = detectHeaderRow(matrix, options.userMap);
    if (!det) continue;

    for (const c of det.cols) {
      if (c.raw && (!c.field || c.field === null)) unknown.add(c.raw);
    }

    for (let r = det.idx + 1; r < matrix.length; r++) {
      const dataRow = matrix[r] ?? [];
      const rawPayload: Record<string, unknown> = {};
      const customPayload: Record<string, unknown> = {};
      const struct: Record<string, unknown> = {};
      const issues: { technical: string | null; supplier: string | null; internal: string | null } = {
        technical: null,
        supplier: null,
        internal: null,
      };

      for (let c = 0; c < det.cols.length; c++) {
        const col = det.cols[c];
        if (!col.raw) continue;
        const cell = dataRow[c];
        rawPayload[col.raw] = cell;
        if (!col.field || col.field === "skip") continue;
        if (excludedSet.has(col.raw)) {
          excludedFields.add(col.field);
          continue;
        }
        // Legacy issue fields → route to side-channel; not written to spare_parts_raw.
        if (col.field === "issue_technical" || col.field === "issue_supplier" || col.field === "issue_internal") {
          const key = col.field === "issue_technical" ? "technical" : col.field === "issue_supplier" ? "supplier" : "internal";
          issues[key] = toText(cell);
          continue;
        }
        // Custom field routing.
        if (customFieldNames.has(col.field)) {
          customPayload[col.field] = toText(cell);
          continue;
        }
        if (DATE_FIELDS.has(col.field)) {
          struct[col.field] = normalizeDate(cell);
        } else if (NUMERIC_FIELDS.has(col.field)) {
          struct[col.field] = toNumber(cell);
        } else if (BOOLEAN_FIELDS.has(col.field)) {
          struct[col.field] = toBoolean(cell);
        } else {
          struct[col.field] = toText(cell);
        }
      }

      const docRef = struct.doc_ref ? String(struct.doc_ref).trim() : "";
      const plot = struct.plot ? String(struct.plot).trim() : "";
      // Skip fully-empty rows.
      const hasAny = Object.values(struct).some(
        (v) => v != null && v !== "" && v !== false,
      );
      if (!hasAny) continue;

      if (!docRef) {
        emptyKeyCount++;
        continue;
      }
      if (seen.has(docRef)) {
        duplicateKeyCount++;
        continue;
      }
      seen.add(docRef);

      rows.push({
        rawRowNo: r + 1,
        sheetName,
        doc_ref: docRef,
        plot: plot || "UNSPECIFIED",
        raw_payload: rawPayload,
        custom_payload: customPayload,
        struct,
        issues,
      });
    }
  }

  return {
    rows,
    unknownHeaders: Array.from(unknown),
    excludedFields,
    emptyKeyCount,
    duplicateKeyCount,
  };
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// Column filter functions for Defect Raw Data table.
// Ported from SHAW PROJECT CMS DefectRawDataPage — 1:1 semantics.

export const EMPTY_TOKEN = "__EMPTY__";

export const TEXT_FILTER_FIELDS = new Set<string>([
  "source_issue_no",
  "issue_no",
  "subcontractor_issue_no",
  "subcontractor_issue_source",
  "location_raw",
  "area_location",
  "area_raw",
  "description",
  "remarks",
  "hdec_comments",
  "aconex_comments",
  "trade_detail",
  "captured_by_name",
  "hdec_reason",
  "item",
  "plan_title",
  "assigned_to",
]);

export const DATE_FILTER_FIELDS = new Set<string>([
  "planned_start_date",
  "planned_rectified_date",
  "planned_closure_date",
  "actual_start_date",
  "actual_rectified_date",
  "actual_closure_date",
  "planned_pre_inspection_date",
  "actual_pre_inspection_date",
  "planned_dar_inspection_date",
  "actual_dar_inspection_date",
  "planned_ho_date",
  "actual_ho_date",
  "classified_at",
  "created_date",
  "due_by",
  "data_date",
  "updated_at",
  "created_at",
  "last_updated_at",
]);

export const PROGRESS_FIELDS = new Set<string>([
  "actual_progress_pct",
  "planned_progress_pct",
]);

export function tokenizeAnd(text: string): string[] {
  return String(text ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = tokenizeAnd(query);
  if (tokens.length === 0) return true;
  const lower = String(haystack ?? "").toLowerCase();
  return tokens.every((tok) => lower.includes(tok));
}

export const multiSelectFilterFn = (row: any, columnId: string, filterValue: string[]) => {
  if (!filterValue || filterValue.length === 0) return true;
  const val = row.getValue(columnId);
  const isEmpty = val == null || val === "";
  if (filterValue.includes(EMPTY_TOKEN) && isEmpty) return true;
  if (isEmpty) return false;
  return filterValue.includes(String(val));
};

export const textFilterFn = (row: any, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const text = typeof filterValue === "string" ? filterValue : filterValue?.text;
  const emptyOnly = typeof filterValue === "object" ? filterValue?.emptyOnly : false;
  const val = row.getValue(columnId);
  if (emptyOnly) return val == null || String(val).trim() === "";
  if (!text) return true;
  if (val == null) return false;
  return matchesAllTokens(String(val), String(text));
};

export const dateRangeFilterFn = (row: any, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const { from, to, emptyOnly } = filterValue;
  const val = row.getValue(columnId) as string | null;
  if (emptyOnly) return val == null || val === "";
  if (!from && !to) return true;
  if (!val) return false;
  const iso = String(val).slice(0, 10);
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
};

function formatPctForFilter(v: any): string {
  if (v == null) return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(1)}%`;
}

export const progressFilterFn = (row: any, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const { text, emptyOnly } = filterValue ?? {};
  const val = row.getValue(columnId);
  if (emptyOnly) return val == null || val === "";
  if (!text) return true;
  return matchesAllTokens(formatPctForFilter(val), String(text));
};

export const RAW_SEARCH_FIELDS = [
  "source_issue_no",
  "issue_no",
  "subcontractor_issue_no",
  "team",
  "area_type",
  "area_level",
  "area_location",
  "location_raw",
  "main_trade",
  "sub_trade",
  "work_type",
  "classification_source",
  "trade_detail",
  "description",
  "defect_type",
  "status_raw",
  "status",
  "rectified_status",
  "priority",
  "subcontractor_name",
  "subsub_name",
  "hdec_pic_name",
  "hdec_eng_name",
  "captured_by_name",
  "closure_status",
  "remarks",
  "hdec_comments",
  "aconex_comments",
  "item",
  "assigned_to",
  "created_by_name",
  "plan_title",
] as const;

export const globalDefectFilterFn = (row: any, _columnId: string, filterValue: string) => {
  if (tokenizeAnd(filterValue).length === 0) return true;
  const original = row.original as any;
  return RAW_SEARCH_FIELDS.some((field) => matchesAllTokens(String(original?.[field] ?? ""), filterValue));
};
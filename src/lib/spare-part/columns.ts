// Spare Part Raw Data 컬럼 정의 (46 표준 필드)
// SHAW parity: type 별 렌더러/필터 그룹 지정

export type SparePartFieldType = "text" | "number" | "date" | "boolean" | "badge" | "progress" | "cost";
export type SparePartFilterType = "multi-select" | "text" | "date-range" | "number-range" | "boolean";

export interface SparePartColumnDef {
  key: string; // DB 컬럼명
  label: string; // 표시 라벨
  type: SparePartFieldType;
  width: number;
  group: "id" | "approval" | "vendor" | "qty" | "cost" | "delivery" | "avail" | "spl" | "stage" | "issue" | "remark" | "system";
  numeric?: boolean;
}

export function inferFilterType(t: SparePartFieldType): SparePartFilterType {
  if (t === "badge") return "multi-select";
  if (t === "date") return "date-range";
  if (t === "boolean") return "boolean";
  if (t === "number" || t === "cost" || t === "progress") return "number-range";
  return "text";
}

export const GROUP_HEADER_BG: Record<SparePartColumnDef["group"], string> = {
  id: "bg-slate-100/80 dark:bg-slate-800/40",
  approval: "bg-emerald-100/60 dark:bg-emerald-900/20",
  vendor: "bg-amber-100/60 dark:bg-amber-900/20",
  qty: "bg-sky-100/60 dark:bg-sky-900/20",
  cost: "bg-yellow-100/60 dark:bg-yellow-900/20",
  delivery: "bg-violet-100/60 dark:bg-violet-900/20",
  avail: "bg-teal-100/60 dark:bg-teal-900/20",
  spl: "bg-pink-100/60 dark:bg-pink-900/20",
  stage: "bg-indigo-100/60 dark:bg-indigo-900/20",
  issue: "bg-rose-100/60 dark:bg-rose-900/20",
  remark: "bg-neutral-100/60 dark:bg-neutral-900/20",
  system: "bg-zinc-100/60 dark:bg-zinc-900/20",
};

// 전역 검색 대상 필드
export const RAW_SEARCH_FIELDS = [
  "doc_ref",
  "subject",
  "supplier",
  "manufacturer",
  "category",
  "system_type",
  "po_number",
  "approval_code",
  "approval_status",
  "revision",
  "remarks",
  "action",
  "proc_remarks",
];

// Bulk 편집 대상 필드
export const BULK_EDITABLE_FIELDS = [
  "remarks",
  "action",
  "proc_remarks",
  "is_active",
  "is_duplicate",
  "approval_code",
  "approval_status",
  "revision",
] as const;
export type BulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number];

export const APPROVAL_CODES = ["A", "B", "C", "D", "UR", "DP"];

export const SPARE_PART_COLUMNS: SparePartColumnDef[] = [
  // Identity
  { key: "doc_ref", label: "Doc Ref", type: "text", width: 200, group: "id" },
  { key: "plot", label: "Plot", type: "badge", width: 80, group: "id" },
  { key: "category", label: "Category", type: "text", width: 140, group: "id" },
  { key: "system_type", label: "System", type: "text", width: 160, group: "id" },
  { key: "subject", label: "Subject", type: "text", width: 260, group: "id" },
  // Approval
  { key: "approval_code", label: "Approval", type: "badge", width: 110, group: "approval" },
  { key: "approval_status", label: "Approval Status", type: "text", width: 180, group: "approval" },
  { key: "revision", label: "Rev", type: "text", width: 80, group: "approval" },
  // Vendor
  { key: "supplier", label: "Supplier", type: "text", width: 180, group: "vendor" },
  { key: "manufacturer", label: "Manufacturer", type: "text", width: 180, group: "vendor" },
  // Qty
  { key: "req_qty", label: "Req Qty", type: "number", width: 100, group: "qty" },
  { key: "req_unit", label: "Unit", type: "text", width: 80, group: "qty" },
  { key: "req_notes", label: "Req Notes", type: "text", width: 180, group: "qty" },
  { key: "qty_total", label: "Qty Total", type: "number", width: 100, group: "qty" },
  { key: "qty_delivered", label: "Delivered", type: "number", width: 100, group: "qty" },
  // Cost
  { key: "cost_usd", label: "Cost (USD)", type: "cost", width: 130, group: "cost" },
  { key: "cost_qar", label: "Cost (QAR)", type: "cost", width: 130, group: "cost" },
  { key: "cost_note", label: "Cost Note", type: "text", width: 160, group: "cost" },
  { key: "cost_impact", label: "Cost Impact", type: "text", width: 130, group: "cost" },
  // Delivery & PO
  { key: "delivery_date", label: "Delivery Date", type: "date", width: 120, group: "delivery" },
  { key: "delivery_status", label: "Delivery Status", type: "text", width: 140, group: "delivery" },
  { key: "po_date", label: "PO Date", type: "date", width: 120, group: "delivery" },
  { key: "po_number", label: "PO No", type: "text", width: 140, group: "delivery" },
  // Availability
  { key: "cert_available", label: "Cert", type: "boolean", width: 70, group: "avail" },
  { key: "drawing_available", label: "Drawing", type: "boolean", width: 80, group: "avail" },
  { key: "manual_available", label: "Manual", type: "boolean", width: 80, group: "avail" },
  { key: "spec_available", label: "Spec", type: "boolean", width: 70, group: "avail" },
  { key: "warranty_available", label: "Warranty", type: "boolean", width: 80, group: "avail" },
  { key: "phy", label: "Phy", type: "boolean", width: 70, group: "avail" },
  { key: "physical_supply", label: "Phy Supply", type: "boolean", width: 90, group: "avail" },
  { key: "is_duplicate", label: "DP", type: "boolean", width: 70, group: "avail" },
  // SPL
  { key: "spl_list_approved", label: "SPL Approved", type: "boolean", width: 110, group: "spl" },
  { key: "spl_approval_date", label: "SPL Date", type: "date", width: 120, group: "spl" },
  // Stages
  { key: "stage1_date", label: "Stage1 Date", type: "date", width: 120, group: "stage" },
  { key: "stage1_done", label: "Stage1", type: "boolean", width: 80, group: "stage" },
  { key: "stage2_date", label: "Stage2 Date", type: "date", width: 120, group: "stage" },
  { key: "stage2_done", label: "Stage2", type: "boolean", width: 80, group: "stage" },
  { key: "stage2_progress", label: "Stage2 %", type: "progress", width: 110, group: "stage" },
  { key: "stage3_date", label: "Stage3 Date", type: "date", width: 120, group: "stage" },
  { key: "stage3_done", label: "Stage3", type: "boolean", width: 80, group: "stage" },
  { key: "stage3_progress", label: "Stage3 %", type: "progress", width: 110, group: "stage" },
  { key: "stage4_date", label: "Stage4 Date", type: "date", width: 120, group: "stage" },
  { key: "stage4_done", label: "Stage4", type: "boolean", width: 80, group: "stage" },
  { key: "stage4_progress", label: "Stage4 %", type: "progress", width: 110, group: "stage" },
  // Issue
  { key: "issue_flag", label: "Issue", type: "text", width: 110, group: "issue" },
  { key: "issue_action", label: "Issue Action", type: "text", width: 180, group: "issue" },
  { key: "issue_owner", label: "Issue Owner", type: "text", width: 140, group: "issue" },
  // Remarks
  { key: "action", label: "Action", type: "text", width: 180, group: "remark" },
  { key: "remarks", label: "Remarks", type: "text", width: 220, group: "remark" },
  { key: "proc_remarks", label: "Proc Remarks", type: "text", width: 200, group: "remark" },
];

export const APPROVAL_CODE_COLORS: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  B: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  C: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  D: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  UR: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  DP: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export const PLOT_COLORS: Record<string, string> = {
  C: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  D: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

export function formatDdMmm(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day}-${mon}`;
}

export function formatNumber(v: number | null | undefined, digits = 0): string {
  if (v == null) return "";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
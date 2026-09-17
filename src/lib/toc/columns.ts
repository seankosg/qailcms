import type { TocBand, TocRow } from "./rows.functions";

/**
 * TOC Raw Data 컬럼 정의.
 * SM(`src/lib/defect-management/columns.ts`)의 컬럼 정의 구조를 그대로 따르며,
 * TOC 는 필드 설정 표가 없으므로 라벨·너비·타입을 코드에서 확정한다.
 * 파생(derived) 컬럼은 정본 조회(`toc_rows_as_of`) 결과 값만 표시하고 화면에서 재계산하지 않는다.
 */
export type TocColumnType = "text" | "date" | "number" | "percent" | "boolean" | "band" | "badge";

export interface TocColumnDef {
  key: string;
  label: string;
  width: number;
  type: TocColumnType;
  group: string;
  /** 밴드 파생 컬럼일 때의 밴드 코드 */
  band?: TocBand;
  /** 정본 파생 값 — 서버 저장 컬럼이 아님 */
  derived?: boolean;
}

export const TOC_BANDS: Array<{ band: TocBand; label: string; short: string }> = [
  { band: "TAC", label: "T&C", short: "T&C" },
  { band: "OMM", label: "O&M Manual", short: "OMM" },
  { band: "TRAINING", label: "Training", short: "TRN" },
  { band: "ASSET_TAG", label: "Asset Tag", short: "TAG" },
  { band: "ABD", label: "As-Built Dwg", short: "ABD" },
  { band: "SERVICE_REPORT", label: "Service Report", short: "SR" },
  { band: "TOC", label: "TOC / Handover", short: "TOC" },
];

export const TOC_BAND_STATE_LABEL: Record<string, string> = {
  complete: "Complete",
  active: "In Progress",
  planned: "Planned",
  blocked: "Blocked",
  na: "N/A",
  empty: "—",
};

export const TOC_BAND_STATE_COLOR: Record<string, string> = {
  complete: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  active: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  planned: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  blocked: "bg-destructive/20 text-destructive",
  na: "bg-muted text-muted-foreground",
  empty: "bg-transparent text-muted-foreground/60",
};

export const TOC_JUDGMENT_COLOR: Record<string, string> = {
  "Handed Over": "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "TOC Under Review": "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  "TOC Ready": "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  Delayed: "bg-destructive/20 text-destructive",
  Blocked: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "In Progress": "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "Not Started": "bg-muted text-muted-foreground",
  Excluded: "bg-muted text-muted-foreground",
};

export const TOC_STATUS_COLOR: Record<string, string> = {
  "Code A": "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "UR IFM": "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  "Code C": "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "Not Submitted": "bg-muted text-muted-foreground",
};

/** 밴드 파생 컬럼 id (밴드 상태 열) */
export const bandColumnId = (band: TocBand) => `band_${band}`;

export const TOC_COLUMNS: TocColumnDef[] = [
  { key: "item_no", label: "Item No", width: 96, type: "text", group: "Identity" },
  { key: "sub_system", label: "Sub System (Equipment)", width: 260, type: "text", group: "Identity" },
  { key: "main_system", label: "Main System", width: 160, type: "text", group: "Identity" },
  { key: "location", label: "Location", width: 150, type: "text", group: "Location" },
  { key: "team_raw", label: "Trade", width: 90, type: "text", group: "Classification" },
  { key: "team", label: "Team", width: 80, type: "badge", group: "Classification" },
  { key: "plot", label: "Plot", width: 66, type: "text", group: "Location" },
  { key: "supplier", label: "Supplier", width: 170, type: "text", group: "Identity" },
  ...TOC_BANDS.map(
    (b): TocColumnDef => ({
      key: bandColumnId(b.band),
      label: b.label,
      width: 116,
      type: "band",
      group: "Readiness",
      band: b.band,
      derived: true,
    }),
  ),
  { key: "readiness_pct", label: "Readiness", width: 104, type: "percent", group: "Readiness", derived: true },
  { key: "judgment", label: "Judgment", width: 132, type: "badge", group: "Judgment", derived: true },
  { key: "primary_delay_label", label: "Top Delay Stage", width: 170, type: "text", group: "Judgment", derived: true },
  { key: "delayed", label: "Delayed Stages", width: 108, type: "number", group: "Judgment", derived: true },
  { key: "toc_ref", label: "TOC Ref (CER No)", width: 140, type: "text", group: "Handover" },
  { key: "toc_status", label: "TOC Status", width: 120, type: "badge", group: "Handover" },
  { key: "expected_ho_date", label: "Expected H/O", width: 112, type: "date", group: "Handover" },
  { key: "ho_status_raw", label: "H/O Status (source)", width: 150, type: "text", group: "Handover" },
  { key: "training_sessions", label: "Training Sessions", width: 118, type: "number", group: "Readiness", derived: true },
  { key: "tac_qty_total", label: "T&C Qty", width: 90, type: "number", group: "Quantity" },
  { key: "tac_qty_issued", label: "T&C Issued", width: 100, type: "number", group: "Quantity" },
  { key: "abd_qty_total", label: "ABD Qty", width: 90, type: "number", group: "Quantity" },
  { key: "abd_qty_code_a", label: "ABD Code A", width: 100, type: "number", group: "Quantity" },
  { key: "pic", label: "PIC", width: 100, type: "text", group: "Assignment" },
  { key: "eng", label: "ENG", width: 100, type: "text", group: "Assignment" },
  { key: "service_report_required", label: "SR Required", width: 100, type: "boolean", group: "Flags" },
  { key: "is_excluded", label: "Excluded", width: 90, type: "boolean", group: "Flags" },
  { key: "exclusion_reason", label: "Exclusion Reason", width: 180, type: "text", group: "Flags" },
  { key: "item_key", label: "Item Key", width: 220, type: "text", group: "Identity" },
  { key: "data_date", label: "Data Date", width: 104, type: "date", group: "Audit" },
];

export const TOC_DATE_FIELDS = new Set(
  TOC_COLUMNS.filter((c) => c.type === "date").map((c) => c.key),
);
export const TOC_TEXT_FILTER_FIELDS = new Set<string>([
  "item_no",
  "sub_system",
  "location",
  "supplier",
  "toc_ref",
  "ho_status_raw",
  "exclusion_reason",
  "item_key",
]);
export const TOC_NUMBER_FIELDS = new Set(
  TOC_COLUMNS.filter((c) => c.type === "number" || c.type === "percent").map((c) => c.key),
);

/** 행 → 컬럼 표시/필터/정렬용 스칼라 값 (밴드·파생 포함) */
export function tocCellValue(row: TocRow, key: string): unknown {
  if (key.startsWith("band_")) {
    const band = key.slice(5) as TocBand;
    return row.band_states?.[band] ?? "empty";
  }
  if (key === "primary_delay_label") return row.primary_delay ? row.primary_delay.label : null;
  return (row as unknown as Record<string, unknown>)[key] ?? null;
}

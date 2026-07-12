// Defect Management Raw Data 컬럼 정의 (LetsBuild 원본 + SHAW 파생)

export type DefectFieldType =
  | "text"
  | "longtext"
  | "number"
  | "percent"
  | "date"
  | "datetime"
  | "badge"
  | "boolean";

export type DefectFilterType =
  | "multi-select"
  | "text"
  | "date-range"
  | "number-range";

export type DefectGroupKey =
  | "identity"
  | "status"
  | "classification"
  | "content"
  | "location"
  | "plan"
  | "trade"
  | "people"
  | "audit"
  | "dates"
  | "progress"
  | "refs"
  | "flags";

export interface DefectColumnDef {
  key: string;
  label: string;
  type: DefectFieldType;
  width: number;
  group: DefectGroupKey;
  editable?: boolean;
  editorType?: "text" | "select" | "date" | "number" | "textarea";
  options?: string[];
}

export const DEFECT_TEAMS = ["건축", "전기", "설비"] as const;
export type DefectTeam = (typeof DEFECT_TEAMS)[number];

export const CATEGORY_TO_TEAM: Record<string, DefectTeam> = {
  Electrical: "전기",
  Mechanical: "설비",
  Architectural: "건축",
  Architecture: "건축",
  Civil: "건축",
  Structural: "건축",
};

export function suggestTeamFromCategory(category: string | null | undefined): DefectTeam | null {
  if (!category) return null;
  const key = String(category).trim();
  return CATEGORY_TO_TEAM[key] ?? null;
}

export const PRIORITIES = ["Cat A - Major Defect (Before SC)", "Cat B - Minor Defect", "High", "Med", "Low"] as const;
export const HDEC_VERIFICATIONS = [
  "Cat A - Major Defect (Before SC)",
  "Cat B - Minor Defect",
  "Review Needed",
] as const;
export const COMPLETION_STATUSES = ["Not Started", "In Progress", "Complete"] as const;
export const CLOSURE_STATUSES = ["Not Closed", "Closed", "InD"] as const;

export const TEAM_COLORS: Record<string, string> = {
  "건축": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "전기": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "설비": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
export const TEAM_FALLBACK_COLOR = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

export const STATUS_COLORS: Record<string, string> = {
  Open: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "In Progress": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Not Closed": "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  InD: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "Not Started": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  Complete: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const PRIORITY_COLORS: Record<string, string> = {
  "Cat A - Major Defect (Before SC)": "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "Cat B - Minor Defect": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  High: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Med: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Low: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export const GROUP_HEADER_BG: Record<DefectGroupKey, string> = {
  identity: "bg-slate-100/80 dark:bg-slate-800/40",
  status: "bg-emerald-100/60 dark:bg-emerald-900/20",
  classification: "bg-rose-100/60 dark:bg-rose-900/20",
  content: "bg-indigo-100/60 dark:bg-indigo-900/20",
  location: "bg-sky-100/60 dark:bg-sky-900/20",
  plan: "bg-cyan-100/60 dark:bg-cyan-900/20",
  trade: "bg-violet-100/60 dark:bg-violet-900/20",
  people: "bg-fuchsia-100/60 dark:bg-fuchsia-900/20",
  audit: "bg-zinc-100/60 dark:bg-zinc-900/20",
  dates: "bg-amber-100/60 dark:bg-amber-900/20",
  progress: "bg-teal-100/60 dark:bg-teal-900/20",
  refs: "bg-neutral-100/60 dark:bg-neutral-900/20",
  flags: "bg-orange-100/60 dark:bg-orange-900/20",
};

export const DEFECT_COLUMNS: DefectColumnDef[] = [
  { key: "source_issue_no", label: "ID", type: "text", width: 90, group: "identity" },
  { key: "team", label: "Team", type: "badge", width: 80, group: "identity" },
  { key: "status_raw", label: "Status", type: "badge", width: 110, group: "status" },
  { key: "completion_status", label: "Completion", type: "badge", width: 110, group: "status" },
  { key: "closure_status", label: "Closure", type: "badge", width: 110, group: "status" },
  { key: "priority", label: "Priority", type: "badge", width: 200, group: "classification", editable: true, editorType: "select", options: [...PRIORITIES] },
  { key: "hdec_verification", label: "HDEC Verification", type: "badge", width: 200, group: "classification", editable: true, editorType: "select", options: [...HDEC_VERIFICATIONS] },
  { key: "hdec_reason", label: "HDEC Reason", type: "longtext", width: 220, group: "classification", editable: true, editorType: "textarea" },
  { key: "classification", label: "Classification", type: "text", width: 130, group: "classification" },
  { key: "category", label: "Category", type: "text", width: 110, group: "classification" },
  { key: "defect_type", label: "Type", type: "text", width: 140, group: "classification" },
  { key: "item", label: "Item", type: "text", width: 140, group: "classification" },
  { key: "description", label: "Description", type: "longtext", width: 320, group: "content" },
  { key: "location_raw", label: "Location", type: "text", width: 220, group: "location" },
  { key: "area_type", label: "Area Type", type: "text", width: 130, group: "location" },
  { key: "area_level", label: "Area Level", type: "text", width: 110, group: "location" },
  { key: "area_location", label: "Area Location", type: "text", width: 180, group: "location" },
  { key: "location_reference", label: "Loc. Reference", type: "text", width: 110, group: "location" },
  { key: "plan_title", label: "Plan Title", type: "text", width: 180, group: "plan" },
  { key: "plan_group", label: "Plan Group", type: "text", width: 130, group: "plan" },
  { key: "main_trade", label: "Main Trade", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "sub_trade", label: "Sub Trade", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "work_type", label: "Work Type", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "assigned_to", label: "Assigned To", type: "text", width: 200, group: "people" },
  { key: "subcontractor_name", label: "Subcontractor", type: "text", width: 150, group: "people", editable: true, editorType: "text" },
  { key: "subsub_name", label: "Sub-Sub", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "hdec_pic_name", label: "HDEC PIC", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "hdec_eng_name", label: "HDEC ENG", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "created_by_name", label: "Created By", type: "text", width: 130, group: "audit" },
  { key: "created_by_team_name", label: "Created Team", type: "text", width: 130, group: "audit" },
  { key: "created_date", label: "Created", type: "date", width: 110, group: "audit" },
  { key: "due_by", label: "Due By", type: "date", width: 110, group: "dates" },
  { key: "planned_start_date", label: "P.Start", type: "date", width: 110, group: "dates", editable: true, editorType: "date" },
  { key: "planned_completion_date", label: "P.Completion", type: "date", width: 120, group: "dates", editable: true, editorType: "date" },
  { key: "planned_closure_date", label: "P.Closure", type: "date", width: 110, group: "dates", editable: true, editorType: "date" },
  { key: "actual_start_date", label: "A.Start", type: "date", width: 110, group: "dates", editable: true, editorType: "date" },
  { key: "actual_completion_date", label: "A.Completion", type: "date", width: 120, group: "dates", editable: true, editorType: "date" },
  { key: "actual_closure_date", label: "A.Closure", type: "date", width: 110, group: "dates", editable: true, editorType: "date" },
  { key: "planned_progress_pct", label: "Plan %", type: "percent", width: 90, group: "progress" },
  { key: "actual_progress_pct", label: "Actual %", type: "percent", width: 100, group: "progress", editable: true, editorType: "number" },
  { key: "last_updated_at", label: "Last Updated", type: "datetime", width: 140, group: "audit" },
  { key: "remarks", label: "Remarks", type: "longtext", width: 220, group: "content", editable: true, editorType: "textarea" },
  { key: "hdec_comments", label: "HDEC Comments", type: "longtext", width: 220, group: "content", editable: true, editorType: "textarea" },
  { key: "is_critical", label: "Critical", type: "boolean", width: 80, group: "flags" },
  { key: "data_date", label: "Data Date", type: "date", width: 110, group: "audit" },
];

export const DEFECT_SEARCH_FIELDS = [
  "source_issue_no",
  "description",
  "location_raw",
  "area_location",
  "plan_title",
  "assigned_to",
  "subcontractor_name",
  "subsub_name",
  "hdec_pic_name",
  "created_by_name",
  "remarks",
  "hdec_comments",
  "item",
  "defect_type",
];

export function inferDefectFilterType(t: DefectFieldType): DefectFilterType {
  if (t === "badge" || t === "boolean") return "multi-select";
  if (t === "date" || t === "datetime") return "date-range";
  if (t === "number" || t === "percent") return "number-range";
  return "text";
}

export function getDefectBulkEditableFields() {
  return DEFECT_COLUMNS.filter((c) => c.editable && c.editorType).map((c) => ({
    field: c.key,
    label: c.label,
    inputType: c.editorType!,
    options: c.options?.map((v) => ({ value: v, label: v })),
    group: c.group,
  }));
}
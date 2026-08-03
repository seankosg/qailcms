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
  /** true면 DB 컬럼이 아닌 파생 값. 서버 정렬/필터 비활성. */
  derived?: boolean;
}

export const DEFECT_TEAMS = ["ARCH", "MECH", "ELEC", "DESN", "PRJC"] as const;
export type DefectTeam = (typeof DEFECT_TEAMS)[number];

/**
 * 레거시 DB 데이터의 팀 라벨(한글 · PascalCase)을 현재 UI 표시용
 * 대문자 코드(ARCH/MECH/ELEC/DESN/PRJC)로 정규화합니다.
 */
const LEGACY_TEAM_NORMALIZE: Record<string, DefectTeam> = {
  "건축": "ARCH", "설비": "MECH", "전기": "ELEC", "설계": "DESN", "공무": "PRJC",
  Arch: "ARCH", Mech: "MECH", Elec: "ELEC", Desn: "DESN", Prjc: "PRJC",
  arch: "ARCH", mech: "MECH", elec: "ELEC", desn: "DESN", prjc: "PRJC",
  ARCH: "ARCH", MECH: "MECH", ELEC: "ELEC", DESN: "DESN", PRJC: "PRJC",
};

/** 코드 → 한글 표시 라벨 (툴팁/부가 설명용). */
export const DEFECT_TEAM_LABEL_KO: Record<DefectTeam, string> = {
  ARCH: "건축", MECH: "설비", ELEC: "전기", DESN: "설계", PRJC: "공무",
};

export function normalizeTeam(v: string | null | undefined): DefectTeam | null {
  if (!v) return null;
  return LEGACY_TEAM_NORMALIZE[String(v).trim()] ?? null;
}

export const PRIORITIES = ["Cat A - Major Defect (Before SC)", "Cat B - Minor Defect", "High", "Med", "Low"] as const;
export const HDEC_VERIFICATIONS = [
  "Cat A - Major Defect (Before SC)",
  "Cat B - Minor Defect",
  "Review Needed",
] as const;
export const RECTIFIED_STATUSES = ["Not start yet", "Not finish yet", "In Progress", "Rectified"] as const;
export const CLOSURE_STATUSES = ["Not Closed", "Closed", "InD"] as const;

export const TEAM_COLORS: Record<string, string> = {
  // 신규 대문자 코드
  ARCH: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ELEC: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  MECH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DESN: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  PRJC: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  // 레거시 라벨 호환
  Arch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Elec: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Mech: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "건축": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "전기": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "설비": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
export const TEAM_FALLBACK_COLOR = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

export const STATUS_COLORS: Record<string, string> = {
  Open: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "In Progress": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Not Closed": "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  InD: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "Not Started": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  "Not start yet": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  "Not finish yet": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Rectified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Complete: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  // Stage-derived status labels
  Done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  WIP: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Planned: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Delay: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
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
  { key: "source_issue_no", label: "ID", type: "text", width: 90, group: "identity", editable: true, editorType: "text" },
  { key: "team", label: "Team", type: "badge", width: 80, group: "identity", editable: true, editorType: "select", options: [...DEFECT_TEAMS] },
  { key: "status_raw", label: "Status", type: "badge", width: 110, group: "status", editable: true, editorType: "text" },
  { key: "priority", label: "Priority", type: "badge", width: 200, group: "classification", editable: true, editorType: "select", options: [...PRIORITIES] },
  { key: "hdec_verification", label: "HDEC Verification", type: "badge", width: 200, group: "classification", editable: true, editorType: "select", options: [...HDEC_VERIFICATIONS] },
  { key: "hdec_reason", label: "HDEC Reason", type: "longtext", width: 220, group: "classification", editable: true, editorType: "textarea" },
  { key: "classification", label: "Classification", type: "text", width: 130, group: "classification", editable: true, editorType: "text" },
  { key: "category", label: "Category", type: "text", width: 110, group: "classification", editable: true, editorType: "text" },
  { key: "defect_type", label: "Type", type: "text", width: 140, group: "classification", editable: true, editorType: "text" },
  { key: "item", label: "Item", type: "text", width: 140, group: "classification", editable: true, editorType: "text" },
  { key: "description", label: "Description", type: "longtext", width: 320, group: "content", editable: true, editorType: "textarea" },
  { key: "location_raw", label: "Location", type: "text", width: 220, group: "location", editable: true, editorType: "text" },
  { key: "defect_location", label: "Defect Location", type: "text", width: 180, group: "location", editable: true, editorType: "text" },
  { key: "area_type", label: "Area Type", type: "text", width: 130, group: "location", editable: true, editorType: "text" },
  { key: "area_level", label: "Area Level", type: "text", width: 110, group: "location", editable: true, editorType: "text" },
  { key: "area_location", label: "Area Location", type: "text", width: 180, group: "location", editable: true, editorType: "text" },
  { key: "location_reference", label: "Loc. Reference", type: "text", width: 110, group: "location", editable: true, editorType: "text" },
  { key: "podium_area", label: "Podium Area", type: "text", width: 120, group: "location", editable: true, editorType: "text" },
  { key: "building", label: "Building", type: "text", width: 110, group: "location", editable: true, editorType: "text" },
  { key: "room", label: "Room", type: "text", width: 110, group: "location", editable: true, editorType: "text" },
  { key: "room_group", label: "Room Group", type: "text", width: 120, group: "location", editable: true, editorType: "text" },
  { key: "level_name", label: "Level", type: "text", width: 90, group: "location", editable: true, editorType: "text" },
  { key: "plan_title", label: "Plan Title", type: "text", width: 180, group: "plan", editable: true, editorType: "text" },
  { key: "plan_group", label: "Plan Group", type: "text", width: 130, group: "plan", editable: true, editorType: "text" },
  { key: "main_trade", label: "Main Trade", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "sub_trade", label: "Sub Trade", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "trade_detail", label: "Trade Detail", type: "text", width: 140, group: "trade", editable: true, editorType: "text" },
  { key: "work_type", label: "Work Type", type: "text", width: 130, group: "trade", editable: true, editorType: "text" },
  { key: "assigned_to", label: "Assigned To", type: "text", width: 200, group: "people" },
  { key: "subcontractor_name", label: "Subcontractor", type: "text", width: 150, group: "people", editable: true, editorType: "text" },
  { key: "subsub_name", label: "Sub-Sub", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "hdec_pic_name", label: "HDEC PIC", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "hdec_eng_name", label: "HDEC ENG", type: "text", width: 130, group: "people", editable: true, editorType: "text" },
  { key: "captured_by_name", label: "Captured By", type: "text", width: 130, group: "people" },
  { key: "created_by_name", label: "Created By", type: "text", width: 130, group: "audit" },
  { key: "created_by_team_name", label: "Created Team", type: "text", width: 130, group: "audit" },
  { key: "created_date", label: "Created", type: "date", width: 110, group: "audit" },
  { key: "due_by", label: "Due By", type: "date", width: 110, group: "dates", editable: true, editorType: "date" },
  // Stage sets: [P.Date | A.Date | Status] × Start → Rectified → Closure
  { key: "planned_start_date", label: "P.Start", type: "date", width: 110, group: "progress", editable: true, editorType: "date" },
  { key: "actual_start_date", label: "A.Start", type: "date", width: 110, group: "progress", editable: true, editorType: "date" },
  { key: "start_status", label: "Start Status", type: "badge", width: 130, group: "progress", derived: true },
  { key: "planned_rectified_date", label: "P.Rectified", type: "date", width: 120, group: "progress", editable: true, editorType: "date" },
  { key: "actual_rectified_date", label: "A.Rectified", type: "date", width: 120, group: "progress", editable: true, editorType: "date" },
  { key: "rectified_status", label: "Rectified Status", type: "badge", width: 130, group: "progress", editable: true, editorType: "select", options: [...RECTIFIED_STATUSES] },
  { key: "planned_closure_date", label: "P.Closure", type: "date", width: 110, group: "progress", editable: true, editorType: "date" },
  { key: "actual_closure_date", label: "A.Closure", type: "date", width: 110, group: "progress", editable: true, editorType: "date" },
  { key: "closure_status", label: "Closure Status", type: "badge", width: 120, group: "progress", editable: true, editorType: "select", options: [...CLOSURE_STATUSES] },
  { key: "planned_progress_pct", label: "Plan %", type: "percent", width: 90, group: "progress", editable: true, editorType: "number" },
  { key: "actual_progress_pct", label: "Actual %", type: "percent", width: 100, group: "progress", editable: true, editorType: "number" },
  { key: "last_updated_at", label: "Last Updated", type: "datetime", width: 140, group: "audit" },
  { key: "updated_status", label: "Updated Status", type: "badge", width: 120, group: "status", editable: true, editorType: "text" },
  { key: "updated_description", label: "Updated Description", type: "longtext", width: 260, group: "content" },
  { key: "updated_by_name", label: "Updated By", type: "text", width: 130, group: "audit" },
  { key: "updated_date_raw", label: "Updated Date", type: "datetime", width: 140, group: "audit" },
  { key: "remarks", label: "Remarks", type: "longtext", width: 220, group: "content", editable: true, editorType: "textarea" },
  { key: "hdec_comments", label: "HDEC Comments", type: "longtext", width: 220, group: "content", editable: true, editorType: "textarea" },
  { key: "classification_source", label: "Classification Source", type: "text", width: 150, group: "classification", editable: true, editorType: "text" },
  { key: "ir", label: "IR", type: "text", width: 110, group: "refs" },
  { key: "forms", label: "Forms", type: "text", width: 110, group: "refs" },
  { key: "subcontractor_issue_no", label: "Subcon Issue No", type: "text", width: 130, group: "refs" },
  { key: "review_flag", label: "Review Flag", type: "text", width: 110, group: "flags" },
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
  return DEFECT_COLUMNS.filter((c) => !c.derived).map((c) => ({
    field: c.key,
    label: c.label,
    inputType: resolveBulkEditorType(c),
    options: bulkOptionsFor(c),
    group: c.group,
    coerce: c.type === "boolean" ? ("boolean" as const) : undefined,
  }));
}

/**
 * 일괄 수정(Mass edit)용 에디터 타입.
 * 인라인 편집(`editable`)과 무관하게, 파생 컬럼을 제외한 모든 헤더가 대상이다.
 */
export function resolveBulkEditorType(c: DefectColumnDef): NonNullable<DefectColumnDef["editorType"]> {
  if (c.editorType) return c.editorType;
  switch (c.type) {
    case "longtext":
      return "textarea";
    case "date":
    case "datetime":
      return "date";
    case "number":
    case "percent":
      return "number";
    case "boolean":
      return "select";
    case "badge":
      return c.options?.length ? "select" : "text";
    default:
      return "text";
  }
}

export function bulkOptionsFor(c: DefectColumnDef): { value: string; label: string }[] | undefined {
  if (c.type === "boolean") {
    return [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ];
  }
  return c.options?.map((v) => ({ value: v, label: v }));
}
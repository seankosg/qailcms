// Task Management Raw Data 컬럼 정의 (Gantt A~S + 시스템)

export type TmFieldType =
  | "text"
  | "number"
  | "percent"
  | "date"
  | "badge"
  | "boolean";

export type TmFilterType =
  | "multi-select"
  | "text"
  | "date-range"
  | "number-range";

export interface TmColumnDef {
  key: string;
  label: string;
  type: TmFieldType;
  width: number;
  group:
    | "id"
    | "task"
    | "status"
    | "plan"
    | "actual"
    | "forecast"
    | "system";
  editable?: boolean;
  editorType?: "text" | "select" | "date" | "number";
  options?: string[];
}

export const DISCIPLINES = ["건축", "전기", "설비"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const ROW_TYPES = ["항목", "실행", "승인", "대기"] as const;
export const STATUS_MANUAL = ["예정", "진행", "완료"] as const;
export const RISK_LEVELS = ["Critical", "High", "Med", "Low"] as const;
export const AUTO_JUDGMENTS = ["완료", "정상", "주의", "지연", "위험"] as const;
export const PLOTS = ["C", "D"] as const;
export const LEVELS = ["parent", "child"] as const;

export const RISK_COLORS: Record<string, string> = {
  Critical: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  High: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Med: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const ROW_TYPE_COLORS: Record<string, string> = {
  "항목": "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "실행": "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "승인": "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "대기": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export const STATUS_COLORS: Record<string, string> = {
  "예정": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  "진행": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "완료": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const AUTO_JUDGMENT_COLORS: Record<string, string> = {
  "완료": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "정상": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "주의": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "지연": "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "위험": "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export const PLOT_COLORS: Record<string, string> = {
  C: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  D: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

export const DISCIPLINE_COLORS: Record<string, string> = {
  "건축": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "전기": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "설비": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

// Team 배지 색상 — discipline 값을 그대로 사용하므로 동일 색상 재사용.
// 신규 team이 추가되어 매칭이 없으면 회색 fallback.
export const TEAM_COLORS: Record<string, string> = { ...DISCIPLINE_COLORS };
export const TEAM_FALLBACK_COLOR = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

export const GROUP_HEADER_BG: Record<TmColumnDef["group"], string> = {
  id: "bg-slate-100/80 dark:bg-slate-800/40",
  task: "bg-indigo-100/60 dark:bg-indigo-900/20",
  status: "bg-emerald-100/60 dark:bg-emerald-900/20",
  plan: "bg-sky-100/60 dark:bg-sky-900/20",
  actual: "bg-violet-100/60 dark:bg-violet-900/20",
  forecast: "bg-amber-100/60 dark:bg-amber-900/20",
  system: "bg-zinc-100/60 dark:bg-zinc-900/20",
};

export const TM_COLUMNS: TmColumnDef[] = [
  { key: "task_no", label: "Task No", type: "text", width: 140, group: "id" },
  { key: "level", label: "Tier", type: "badge", width: 90, group: "id" },
  { key: "discipline", label: "Discipline", type: "badge", width: 90, group: "id" },
  { key: "team", label: "Team", type: "badge", width: 100, group: "id" },
  { key: "category", label: "Category", type: "text", width: 130, group: "task", editable: true, editorType: "text" },
  { key: "plot", label: "Plot", type: "badge", width: 70, group: "task" },
  { key: "location", label: "Location", type: "text", width: 130, group: "task", editable: true, editorType: "text" },
  { key: "floor_level", label: "Level", type: "text", width: 90, group: "task", editable: true, editorType: "text" },
  { key: "task_name", label: "Task", type: "text", width: 240, group: "task", editable: true, editorType: "text" },
  { key: "risk", label: "Risk", type: "badge", width: 100, group: "task", editable: true, editorType: "select", options: [...RISK_LEVELS] },
  { key: "sub_task_desc", label: "Sub-Task", type: "text", width: 220, group: "task", editable: true, editorType: "text" },
  { key: "pic", label: "PIC", type: "text", width: 120, group: "task", editable: true, editorType: "text" },
  { key: "row_type", label: "Work Type", type: "badge", width: 90, group: "task", editable: true, editorType: "select", options: [...ROW_TYPES] },
  { key: "status_manual", label: "Status", type: "badge", width: 90, group: "status", editable: true, editorType: "select", options: [...STATUS_MANUAL] },
  { key: "auto_judgment", label: "Alarm", type: "badge", width: 120, group: "status" },
  { key: "plan_start", label: "P.Start", type: "date", width: 110, group: "plan", editable: true, editorType: "date" },
  { key: "plan_end", label: "P.Finish", type: "date", width: 110, group: "plan", editable: true, editorType: "date" },
  { key: "plan_days", label: "P.Duration", type: "number", width: 90, group: "plan" },
  { key: "actual_start", label: "A.Start", type: "date", width: 110, group: "actual", editable: true, editorType: "date" },
  { key: "actual_finish", label: "A.Finish", type: "date", width: 110, group: "actual", editable: true, editorType: "date" },
  { key: "actual_duration", label: "A.Duration", type: "number", width: 100, group: "actual" },
  { key: "actual_progress", label: "Actual %", type: "percent", width: 120, group: "actual", editable: true, editorType: "number" },
  { key: "plan_progress", label: "Plan %", type: "percent", width: 120, group: "forecast" },
  { key: "progress_variance", label: "Variance (%p)", type: "percent", width: 120, group: "forecast" },
  { key: "expected_progress_today", label: "T.Plan", type: "percent", width: 100, group: "forecast" },
  { key: "today_gap", label: "T.Diff", type: "percent", width: 100, group: "forecast" },
  { key: "forecast_end", label: "Revised Finish", type: "date", width: 130, group: "forecast", editable: true, editorType: "date" },
  { key: "slip_days", label: "Slip (days)", type: "number", width: 100, group: "forecast" },
  { key: "data_date", label: "Data Date", type: "date", width: 110, group: "system" },
  { key: "source_file", label: "Source File", type: "text", width: 200, group: "system" },
  { key: "imported_at", label: "Imported", type: "date", width: 120, group: "system" },
];

export const TM_SEARCH_FIELDS = [
  "task_no",
  "task_name",
  "sub_task_desc",
  "pic",
  "category",
];

export function inferTmFilterType(t: TmFieldType): TmFilterType {
  if (t === "badge") return "multi-select";
  if (t === "date") return "date-range";
  if (t === "number" || t === "percent") return "number-range";
  return "text";
}

/** 편집 가능 필드 목록 (부모의 actual_progress는 UI 레벨에서 차단) */
export const TM_EDITABLE_FIELDS: string[] = TM_COLUMNS
  .filter((c) => c.editable)
  .map((c) => c.key);

export const TM_AUTO_CALCULATED: string[] = [
  "plan_days",
  "plan_progress",
  "progress_variance",
  "slip_days",
  "auto_judgment",
  "actual_duration",
];

export interface BulkEditableField {
  field: string;
  label: string;
  inputType: "text" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  group: string;
}

const GROUP_LABELS: Record<TmColumnDef["group"], string> = {
  id: "Identification",
  task: "Task",
  status: "Status",
  plan: "Plan",
  actual: "Actual",
  forecast: "Forecast",
  system: "System",
};

export function getBulkEditableFields(): BulkEditableField[] {
  const out: BulkEditableField[] = [];
  for (const c of TM_COLUMNS) {
    if (!c.editable || !c.editorType) continue;
    out.push({
      field: c.key,
      label: c.label,
      inputType: c.editorType,
      options: c.options?.map((v) => ({ value: v, label: v })),
      group: GROUP_LABELS[c.group] ?? c.group,
    });
  }
  return out;
}
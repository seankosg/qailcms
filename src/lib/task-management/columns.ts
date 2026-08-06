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
  | "number-range"
  | "stage-progress";

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
  /** 헤더/필드 라벨 툴팁에 덧붙는 설명(엑셀 헤더에는 영향 없음). */
  note?: string;
}

export const DISCIPLINES = ["ARCH", "ELEC", "MECH", "DESN", "PRJC"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/** 코드 → 한글 표시 라벨 (툴팁/부가 설명용). UI 기본 표시는 코드 자체. */
export const DISCIPLINE_LABEL_KO: Record<Discipline, string> = {
  ARCH: "건축",
  MECH: "설비",
  ELEC: "전기",
  DESN: "설계",
  PRJC: "공무",
};

/** 레거시 값(한글/PascalCase/소문자) → 대문자 코드로 정규화. */
const DISCIPLINE_NORMALIZE: Record<string, Discipline> = {
  "건축": "ARCH", "설비": "MECH", "전기": "ELEC", "설계": "DESN", "공무": "PRJC",
  Arch: "ARCH", Mech: "MECH", Elec: "ELEC", Desn: "DESN", Prjc: "PRJC",
  arch: "ARCH", mech: "MECH", elec: "ELEC", desn: "DESN", prjc: "PRJC",
  ARCH: "ARCH", MECH: "MECH", ELEC: "ELEC", DESN: "DESN", PRJC: "PRJC",
};
export function normalizeDiscipline(v: string | null | undefined): Discipline | null {
  if (!v) return null;
  return DISCIPLINE_NORMALIZE[String(v).trim()] ?? null;
}

export const ROW_TYPES = ["항목", "실행", "승인", "대기"] as const;
export const STATUS_MANUAL = ["예정", "진행", "완료"] as const;
export const RISK_LEVELS = ["Critical", "High", "Med", "Low"] as const;
export const AUTO_JUDGMENTS = ["완료", "정상", "주의", "지연", "악화"] as const;
export const PLOTS = ["C", "D", "G"] as const;
export const LEVELS = ["main", "sub"] as const;

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
  "악화": "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

// Milestone 코드 색상 (Handover / Certificate of Completion / Defect Liability Period)
export const MILESTONE_COLORS: Record<string, string> = {
  HO: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  COC: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  DLP: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

// Admin에서 등록한 신규 마일스톤 코드용 결정적 폴백 팔레트.
// 같은 코드 문자열은 항상 같은 색으로 배정된다.
const MILESTONE_FALLBACK_PALETTE: string[] = [
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
];

export function milestoneColorClass(code: string): string {
  if (!code) return "bg-muted text-foreground";
  const hit = MILESTONE_COLORS[code];
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % MILESTONE_FALLBACK_PALETTE.length;
  return MILESTONE_FALLBACK_PALETTE[idx];
}

// Plan/Actual Overdue 색상 (PASS = 완료 / SAFE / WARNING / RISK)
export const OVERDUE_COLORS: Record<string, string> = {
  PASS: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  SAFE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  WARNING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  RISK: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export const PLOT_COLORS: Record<string, string> = {
  C: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  D: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  G: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const DISCIPLINE_COLORS: Record<string, string> = {
  ARCH: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ELEC: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  MECH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DESN: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  PRJC: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  // 레거시 호환
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
  { key: "stage_progress", label: "Progress", type: "text", width: 100, group: "status" },
  { key: "level", label: "Tier", type: "badge", width: 90, group: "id" },
  { key: "discipline", label: "Discipline", type: "badge", width: 90, group: "id" },
  { key: "team", label: "Team", type: "badge", width: 100, group: "id" },
  { key: "category", label: "Category", type: "text", width: 130, group: "task", editable: true, editorType: "text" },
  { key: "plot", label: "Plot", type: "badge", width: 70, group: "task" },
  { key: "milestone", label: "Milestone", type: "badge", width: 90, group: "task" },
  { key: "location", label: "Location", type: "text", width: 130, group: "task", editable: true, editorType: "text" },
  { key: "floor_level", label: "Level", type: "text", width: 90, group: "task", editable: true, editorType: "text" },
  { key: "auto_judgment", label: "Alarm", type: "badge", width: 100, group: "status" },
  { key: "plan_overdue", label: "Plan Overdue", type: "badge", width: 110, group: "status" },
  { key: "actual_overdue", label: "Actual Overdue", type: "badge", width: 120, group: "status" },
  { key: "task_name", label: "Task", type: "text", width: 240, group: "task", editable: true, editorType: "text" },
  { key: "risk", label: "Risk", type: "badge", width: 100, group: "task", editable: true, editorType: "select", options: [...RISK_LEVELS] },
  { key: "sub_task_desc", label: "Sub-Task", type: "text", width: 220, group: "task", editable: true, editorType: "text" },
  { key: "hdec_pic_name", label: "HDEC PIC", type: "text", width: 120, group: "task", editable: true, editorType: "text" },
  { key: "hdec_eng_name", label: "HDEC ENG", type: "text", width: 120, group: "task", editable: true, editorType: "text" },
  { key: "row_type", label: "Work Type", type: "badge", width: 90, group: "task", editable: true, editorType: "select", options: [...ROW_TYPES] },
  { key: "status_manual", label: "Status", type: "badge", width: 90, group: "status", editable: true, editorType: "select", options: [...STATUS_MANUAL] },
  { key: "plan_start", label: "P.Start", type: "date", width: 110, group: "plan", editable: true, editorType: "date" },
  { key: "plan_end", label: "P.Finish", type: "date", width: 110, group: "plan", editable: true, editorType: "date" },
  { key: "plan_days", label: "P.Duration", type: "number", width: 90, group: "plan" },
  { key: "actual_start", label: "A.Start", type: "date", width: 110, group: "actual", editable: true, editorType: "date" },
  { key: "actual_finish", label: "A.Finish", type: "date", width: 110, group: "actual", editable: true, editorType: "date" },
  { key: "actual_duration", label: "A.Duration", type: "number", width: 100, group: "actual" },
  { key: "actual_progress", label: "Actual %", type: "percent", width: 120, group: "actual", editable: true, editorType: "number" },
  { key: "plan_progress", label: "Plan %", type: "percent", width: 120, group: "forecast" },
  { key: "progress_variance", label: "Cum. Diff", type: "percent", width: 120, group: "forecast" },
  { key: "expected_progress_today", label: "T.Plan", type: "percent", width: 100, group: "forecast" },
  { key: "today_actual", label: "T.Actual", type: "percent", width: 100, group: "forecast", note: "입력일 기준 — 진도율이 CMS 에 입력된 날짜로 집계됩니다. 실제 작업일과 다를 수 있습니다." },
  { key: "today_gap", label: "T.Diff", type: "percent", width: 100, group: "forecast" },
  { key: "forecast_end", label: "Revised Finish", type: "date", width: 130, group: "forecast", editable: true, editorType: "date" },
  { key: "expected_finish", label: "Expected Finish", type: "date", width: 130, group: "forecast" },
  { key: "slip_days", label: "Slip (days)", type: "number", width: 100, group: "forecast" },
  { key: "data_date", label: "Data Date", type: "date", width: 110, group: "system" },
  { key: "source_file", label: "Source File", type: "text", width: 200, group: "system" },
  { key: "imported_at", label: "Imported", type: "date", width: 120, group: "system" },
];

export const TM_SEARCH_FIELDS = [
  "task_no",
  "task_name",
  "sub_task_desc",
  "hdec_pic_name",
  "hdec_eng_name",
  "category",
];

export function inferTmFilterType(t: TmFieldType): TmFilterType {
  if (t === "badge") return "multi-select";
  if (t === "date") return "date-range";
  if (t === "number" || t === "percent") return "number-range";
  return "multi-select";
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
  // 뷰 파생 필드 — 임포트 매핑 대상 아님 (참고용)
  "plan_overdue",
  "actual_overdue",
  "expected_finish",
];

// ---------------------------------------------------------------------------
// Gantt 원본 템플릿 A..T 컬럼 순서 (원본 xlsx `Gantt` 시트 재현용)
// ---------------------------------------------------------------------------

export interface TmGanttOriginalCol {
  /** Excel 컬럼 문자 (A..T) */
  letter: string;
  /** snake_case 필드 키 (null → 예비/여백 컬럼) */
  key: string | null;
  /** 원본 헤더 라벨 (한글) */
  label: string;
}

export const TM_GANTT_ORIGINAL_ORDER: TmGanttOriginalCol[] = [
  // 원본 xlsx: A는 헤더 없이 순번(Sno), B..T가 실제 데이터 컬럼.
  { letter: "A", key: "__sno",             label: "" },
  { letter: "B", key: "task_no",           label: "No" },
  { letter: "C", key: "category",          label: "Category" },
  { letter: "D", key: "plot",              label: "Plot" },
  { letter: "E", key: "task_name",         label: "항목" },
  { letter: "F", key: "risk",              label: "리스크" },
  { letter: "G", key: "sub_task_desc",     label: "단계별 세부 업무" },
  { letter: "H", key: "hdec_pic_name",     label: "HDEC PIC" },
  { letter: "I", key: "hdec_eng_name",     label: "HDEC ENG" },
  { letter: "J", key: "row_type",          label: "유형" },
  { letter: "K", key: "status_manual",     label: "상태" },
  { letter: "L", key: "plan_start",        label: "계획\n시작" },
  { letter: "M", key: "plan_end",          label: "계획\n완료" },
  { letter: "N", key: "plan_days",         label: "계획\n일수" },
  { letter: "O", key: "actual_start",      label: "실제\n시작" },
  { letter: "P", key: "actual_progress",   label: "실적\n진도율" },
  { letter: "Q", key: "plan_progress",     label: "계획\n진도율" },
  { letter: "R", key: "progress_variance", label: "진도차\n(%p)" },
  { letter: "S", key: "forecast_end",      label: "예상\n완료" },
  { letter: "T", key: "slip_days",         label: "차이\n(일)" },
  { letter: "U", key: "auto_judgment",     label: "자동\n판정" },
];

export interface BulkEditableField {
  field: string;
  label: string;
  inputType: "text" | "select" | "date" | "number";
  /** true 이면 UI 는 0~100 (%) 로 입력, 저장 시 100 으로 나눔 */
  isPercent?: boolean;
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

export function getBulkEditableFields(opts?: {
  milestoneOptions?: string[];
  /** admin 계정: 파생/자동계산을 제외한 전 항목을 일괄 편집 대상으로 노출 */
  admin?: boolean;
}): BulkEditableField[] {
  const out: BulkEditableField[] = [];
  for (const c of TM_COLUMNS) {
    if (!c.editable || !c.editorType) continue;
    out.push({
      field: c.key,
      label: c.label,
      inputType: c.editorType,
      isPercent: c.type === "percent",
      options: c.options?.map((v) => ({ value: v, label: v })),
      group: GROUP_LABELS[c.group] ?? c.group,
    });
  }
  // Detail 페이지에서 편집 가능한 항목이지만 TM_COLUMNS 상 editable=false 인 필드들도
  // Bulk Edit 대상에 포함시킨다. (task_no / team / data_date / milestone)
  out.push({
    field: "task_no",
    label: "Task No",
    inputType: "text",
    group: GROUP_LABELS.id,
  });
  out.push({
    field: "team",
    label: "Team",
    inputType: "select",
    options: [...DISCIPLINES].map((v) => ({ value: v, label: v })),
    group: GROUP_LABELS.id,
  });
  out.push({
    field: "data_date",
    label: "Data Date",
    inputType: "date",
    group: GROUP_LABELS.system,
  });
  out.push({
    field: "milestone",
    label: "Milestone",
    inputType: "select",
    options: (opts?.milestoneOptions ?? []).map((v) => ({ value: v, label: v })),
    group: GROUP_LABELS.task,
  });
  if (opts?.admin) {
    const seen = new Set(out.map((f) => f.field));
    for (const c of TM_COLUMNS) {
      if (seen.has(c.key)) continue;
      const ed = tmAdminEditor(c, { milestoneOptions: opts.milestoneOptions });
      if (!ed) continue;
      out.push({
        field: c.key,
        label: c.label,
        inputType: ed.editorType!,
        isPercent: c.type === "percent",
        options: ed.options?.map((v) => ({ value: v, label: v })),
        group: GROUP_LABELS[c.group] ?? c.group,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Admin 전 항목 편집 승격
// ---------------------------------------------------------------------------

/** admin 이라도 편집할 수 없는 필드(자동계산·파생·임포트 메타). */
export const TM_ADMIN_LOCKED_FIELDS: string[] = [
  ...TM_AUTO_CALCULATED,
  "stage_progress",
  "today_actual",
  "today_gap",
  "expected_progress_today",
  "imported_at",
  "source_file",
  "level",
];

/**
 * admin 계정용 편집기 정의. 잠금 필드는 null.
 * 컬럼 정의에 editable 이 없어도 타입에 맞는 편집기를 유도한다.
 */
export function tmAdminEditor(
  c: TmColumnDef,
  opts?: { milestoneOptions?: string[] },
): { editorType: TmColumnDef["editorType"]; options?: string[] } | null {
  if (TM_ADMIN_LOCKED_FIELDS.includes(c.key)) return null;
  if (c.editable && c.editorType) return { editorType: c.editorType, options: c.options };
  switch (c.key) {
    case "team":
    case "discipline":
      return { editorType: "select", options: [...DISCIPLINES] };
    case "plot":
      return { editorType: "select", options: [...PLOTS] };
    case "milestone":
      return { editorType: "select", options: opts?.milestoneOptions ?? [] };
    default:
      break;
  }
  if (c.type === "date") return { editorType: "date" };
  if (c.type === "number" || c.type === "percent") return { editorType: "number" };
  return { editorType: "text" };
}
// ABD (As-Built Drawing) Raw Data 컬럼 정의

export type AbdFieldType = "text" | "number" | "date" | "badge";
export type AbdFilterType = "multi-select" | "text" | "date-range" | "number-range";
export type AbdGroupKey =
  | "identity"
  | "content"
  | "latest"
  | "round1"
  | "round2"
  | "round3"
  | "segments"
  | "flags"
  | "audit";

export interface AbdColumnDef {
  key: string;
  label: string;
  type: AbdFieldType;
  width: number;
  group: AbdGroupKey;
  editable?: boolean;
  editorType?: "text" | "select" | "date" | "number";
  options?: string[];
  origin?: "identity" | "r1" | "r2" | "r3" | "latest" | "system";
  /** true 인 legacy 컬럼은 사용자 컬럼 설정에서 기본 숨김 처리 */
  legacy?: boolean;
  /** 기본 숨김 여부 (신규 legacy 컬럼용) */
  hiddenByDefault?: boolean;
}

export const ABD_TEAMS = [
  { value: "MECH", label: "MECH" },
  { value: "ELEC", label: "ELEC" },
  { value: "ARCH", label: "ARCH" },
] as const;
export type AbdTeam = (typeof ABD_TEAMS)[number]["value"];

/** UI 표시용 라벨(코드 자체). 한글 라벨은 TEAM_LABEL_KO에서 조회. */
export const TEAM_LABEL: Record<string, string> = {
  MECH: "MECH", ELEC: "ELEC", ARCH: "ARCH",
  // 레거시 호환 (DB에 남아있을 수 있는 소문자)
  mech: "MECH", elec: "ELEC", arch: "ARCH",
};
export const TEAM_LABEL_KO: Record<string, string> = {
  MECH: "설비", ELEC: "전기", ARCH: "건축",
};
export const TEAM_COLORS: Record<string, string> = {
  MECH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ELEC: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ARCH: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  // 레거시 호환
  mech: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  elec: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  arch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};
export const TEAM_FALLBACK_COLOR = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

export const STATUS_COLORS: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40",
  B: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40",
  C: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40",
  "NOT YET": "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30",
};

export const PLOT_COLORS: Record<string, string> = {
  C: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  D: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
};

export const ABD_STATUSES = ["A", "B", "C", "NOT YET"] as const;

export const ABD_COLUMNS: AbdColumnDef[] = [
  // Identity
  { key: "sl_no", label: "Sl.No", type: "number", width: 70, group: "identity", origin: "identity" },
  { key: "plot", label: "Plot", type: "badge", width: 70, group: "identity", origin: "identity" },
  { key: "dis", label: "DIS", type: "text", width: 80, group: "identity", origin: "identity" },
  { key: "service", label: "Service", type: "text", width: 160, group: "identity", origin: "identity" },
  { key: "abd_number", label: "ABD Number", type: "text", width: 260, group: "identity", origin: "identity" },
  { key: "abd_ocs_no", label: "ABD OCS No.", type: "text", width: 240, group: "identity", origin: "identity" },
  { key: "batch_no", label: "Batch No.", type: "text", width: 110, group: "identity", editable: true, editorType: "text", origin: "identity" },

  // Content
  { key: "document_title", label: "Document Title", type: "text", width: 340, group: "content", editable: true, editorType: "text", origin: "identity" },
  { key: "hdec_pic_name", label: "HDEC PIC", type: "text", width: 120, group: "content", editable: true, editorType: "text", origin: "identity" },
  { key: "hdec_eng_name", label: "HDEC ENG", type: "text", width: 140, group: "content", editable: true, editorType: "text", origin: "identity" },

  // Latest
  { key: "latest_rev", label: "Latest Rev", type: "text", width: 90, group: "latest", editable: true, editorType: "text", origin: "latest" },
  { key: "latest_status", label: "Latest Status", type: "badge", width: 110, group: "latest", editable: true, editorType: "select", options: [...ABD_STATUSES], origin: "latest" },
  { key: "approval_date", label: "Approval", type: "date", width: 100, group: "latest", editable: true, editorType: "date", origin: "latest" },
  { key: "current_stage", label: "Current Stage", type: "badge", width: 120, group: "latest", origin: "system" },
  { key: "ur_aging_days", label: "UR Aging (d)", type: "number", width: 110, group: "latest", origin: "system" },

  // Round 1
  { key: "r1_draft_start_plan",   label: "R1 DS P",  type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_draft_start_actual", label: "R1 DS A",  type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_draft_finish_plan",  label: "R1 DF P",  type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_draft_finish_actual",label: "R1 DF A",  type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_submission_plan", label: "R1 Sub P", type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_submission_actual", label: "R1 Sub A", type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_dar_plan", label: "R1 DAR P", type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_dar_actual", label: "R1 DAR A", type: "date", width: 100, group: "round1", editable: true, editorType: "date", origin: "r1" },
  { key: "r1_response_result", label: "R1 Result", type: "badge", width: 90, group: "round1", editable: true, editorType: "select", options: ["A","B","C"], origin: "r1" },
  { key: "r1_drafting_plan",  label: "R1 Draft P (legacy)", type: "date", width: 130, group: "round1", editable: true, editorType: "date", origin: "r1", legacy: true, hiddenByDefault: true },
  { key: "r1_drafting_actual",label: "R1 Draft A (legacy)", type: "date", width: 130, group: "round1", editable: true, editorType: "date", origin: "r1", legacy: true, hiddenByDefault: true },

  // Round 2
  { key: "r2_draft_start_plan",   label: "R2 DS P",  type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_draft_start_actual", label: "R2 DS A",  type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_draft_finish_plan",  label: "R2 DF P",  type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_draft_finish_actual",label: "R2 DF A",  type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_submission_plan", label: "R2 Sub P", type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_submission_actual", label: "R2 Sub A", type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_dar_plan", label: "R2 DAR P", type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_dar_actual", label: "R2 DAR A", type: "date", width: 100, group: "round2", editable: true, editorType: "date", origin: "r2" },
  { key: "r2_response_result", label: "R2 Result", type: "badge", width: 90, group: "round2", editable: true, editorType: "select", options: ["A","B","C"], origin: "r2" },
  { key: "r2_drafting_plan",  label: "R2 Draft P (legacy)", type: "date", width: 130, group: "round2", editable: true, editorType: "date", origin: "r2", legacy: true, hiddenByDefault: true },
  { key: "r2_drafting_actual",label: "R2 Draft A (legacy)", type: "date", width: 130, group: "round2", editable: true, editorType: "date", origin: "r2", legacy: true, hiddenByDefault: true },

  // Round 3
  { key: "r3_draft_start_plan",   label: "R3 DS P",  type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_draft_start_actual", label: "R3 DS A",  type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_draft_finish_plan",  label: "R3 DF P",  type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_draft_finish_actual",label: "R3 DF A",  type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_submission_plan", label: "R3 Sub P", type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_submission_actual", label: "R3 Sub A", type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_dar_plan", label: "R3 DAR P", type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_dar_actual", label: "R3 DAR A", type: "date", width: 100, group: "round3", editable: true, editorType: "date", origin: "r3" },
  { key: "r3_response_result", label: "R3 Result", type: "badge", width: 90, group: "round3", editable: true, editorType: "select", options: ["A","B","C"], origin: "r3" },
  { key: "r3_drafting_plan",  label: "R3 Draft P (legacy)", type: "date", width: 130, group: "round3", editable: true, editorType: "date", origin: "r3", legacy: true, hiddenByDefault: true },
  { key: "r3_drafting_actual",label: "R3 Draft A (legacy)", type: "date", width: 130, group: "round3", editable: true, editorType: "date", origin: "r3", legacy: true, hiddenByDefault: true },

  // Segments
  { key: "doc_ax", label: "AX", type: "text", width: 70, group: "segments", origin: "identity" },
  { key: "doc_axx", label: "AXX", type: "text", width: 80, group: "segments", origin: "identity" },
  { key: "doc_nn1", label: "NN1", type: "text", width: 70, group: "segments", origin: "identity" },
  { key: "doc_n", label: "N", type: "text", width: 60, group: "segments", origin: "identity" },
  { key: "doc_nn2", label: "NN2", type: "text", width: 70, group: "segments", origin: "identity" },

  // Flags & audit
  { key: "is_active", label: "Active", type: "badge", width: 80, group: "flags", origin: "system" },
  { key: "data_date", label: "Data Date", type: "date", width: 110, group: "audit", origin: "system" },
  { key: "updated_at", label: "Updated", type: "date", width: 130, group: "audit", origin: "system" },
];

export const ABD_SEARCH_FIELDS = [
  "abd_number", "abd_ocs_no", "batch_no", "document_title", "hdec_pic_name", "hdec_eng_name", "dis", "service",
  "plot", "latest_rev", "latest_status", "doc_ax", "doc_axx", "doc_nn1", "doc_n", "doc_nn2",
] as const;

export function inferAbdFilterType(t: AbdFieldType, key?: string): AbdFilterType {
  if (t === "badge") return "multi-select";
  if (t === "date") return "date-range";
  if (t === "number") return "number-range";
  if (
    key === "plot" || key === "dis" || key === "latest_rev" || key === "latest_status" ||
    key === "batch_no" || key === "hdec_pic_name" || key === "hdec_eng_name" ||
    key === "current_stage"
  ) return "multi-select";
  return "text";
}

export const GROUP_HEADER_BG: Record<AbdGroupKey, string> = {
  identity: "bg-slate-100/80 dark:bg-slate-800/40",
  content: "bg-indigo-100/60 dark:bg-indigo-900/20",
  latest: "bg-emerald-100/60 dark:bg-emerald-900/20",
  round1: "bg-sky-100/60 dark:bg-sky-900/20",
  round2: "bg-cyan-100/60 dark:bg-cyan-900/20",
  round3: "bg-violet-100/60 dark:bg-violet-900/20",
  segments: "bg-zinc-100/60 dark:bg-zinc-900/20",
  flags: "bg-orange-100/60 dark:bg-orange-900/20",
  audit: "bg-neutral-100/60 dark:bg-neutral-900/20",
};
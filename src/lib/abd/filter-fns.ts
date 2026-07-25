// ABD Raw Data 컬럼 필터 유틸
export const EMPTY_TOKEN = "__EMPTY__";

export const TEXT_FILTER_FIELDS = new Set<string>([
  "abd_number",
  "abd_ocs_no",
  "document_title",
  "service",
]);

export const DATE_FILTER_FIELDS = new Set<string>([
  "approval_date",
  "data_date",
  "updated_at",
  "r1_draft_finish_plan", "r1_draft_finish_actual", "r1_submission_plan", "r1_submission_actual", "r1_dar_plan", "r1_dar_actual",
  "r2_draft_finish_plan", "r2_draft_finish_actual", "r2_submission_plan", "r2_submission_actual", "r2_dar_plan", "r2_dar_actual",
  "r3_draft_finish_plan", "r3_draft_finish_actual", "r3_submission_plan", "r3_submission_actual", "r3_dar_plan", "r3_dar_actual",
]);

export const NUMBER_FILTER_FIELDS = new Set<string>(["sl_no"]);

export const BOOL_FILTER_FIELDS = new Set<string>(["is_active"]);

export const FACET_FIELDS = new Set<string>([
  "plot", "dis", "latest_rev", "latest_status", "hdec_pic_name", "hdec_eng_name", "doc_ax", "doc_axx",
]);

export function tokenizeAnd(text: string): string[] {
  return String(text ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}
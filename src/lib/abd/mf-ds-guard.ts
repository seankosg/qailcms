/**
 * ABD Gate 1 — Master Reference(MF) 미확인 도면의 Draft Start 실적일 입력 차단 (단일 소스).
 *
 * 허용 조건 = mf_check=true AND mf_types 1개 이상 AND mf_reference 비어있지 않음.
 * DB 트리거 `abd_guard_ds_actual_requires_mf` / 함수 `abd_mf_ready` 와 동일 규칙이며,
 * 클라이언트·서버는 사전 차단·안내 용도로만 사용한다(최종 관문은 DB).
 */
export interface MfStateLike {
  mf_check?: boolean | null;
  mf_types?: string[] | null;
  mf_reference?: string | null;
}

/** 문서 §4.2 MF Type 목록 (기타 포함) */
export const MF_TYPES = [
  "TAC",
  "Program Schedule",
  "Site Verification",
  "Approved INR",
  "T&C Record",
  "Approved Shop Drawing",
  "Equipment Schedule",
  "기타",
] as const;

export function isMfReady(row: MfStateLike | null | undefined): boolean {
  if (!row) return false;
  if (!row.mf_check) return false;
  if (!Array.isArray(row.mf_types) || row.mf_types.length === 0) return false;
  return String(row.mf_reference ?? "").trim() !== "";
}

export const DS_ACTUAL_FIELDS = [
  "r1_draft_start_actual",
  "r2_draft_start_actual",
  "r3_draft_start_actual",
] as const;

export function isDsActualField(field: string): boolean {
  return (DS_ACTUAL_FIELDS as readonly string[]).includes(field);
}

/** 해당 DS 실적일 필드가 MF 미확인으로 차단되는가 (모든 라운드 공통). */
export function isDsActualBlocked(row: MfStateLike | null | undefined, field: string): boolean {
  if (!isDsActualField(field)) return false;
  return !isMfReady(row);
}

export const MF_DS_BLOCK_MESSAGE =
  "Master Reference 확인이 완료되지 않았습니다. MF 종류와 Reference를 입력한 후 MF Check를 완료하십시오.";

/** 감사 상태 표시 라벨 (문서 §6.2) */
export const AUDIT_STATUSES = [
  "not_audited",
  "audit_selected",
  "audit_passed",
  "audit_failed",
  "correction_required",
] as const;
export type AbdAuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_STATUS_LABEL: Record<string, string> = {
  not_audited: "Not Audited",
  audit_selected: "Audit Selected",
  audit_passed: "Audit Passed",
  audit_failed: "Audit Failed",
  correction_required: "Correction Required",
};

export const AUDIT_STATUS_TONE: Record<string, string> = {
  not_audited: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
  audit_selected: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  audit_passed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  audit_failed: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  correction_required: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};
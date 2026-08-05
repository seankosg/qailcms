/**
 * ABD — OCS 미완료(Pending) 도면의 Draft Finish 실적일 입력 차단 규칙 (단일 소스).
 *
 * 초록(허용) 조건 = OCS 코멘트가 없거나(none/total 0) 전부 Complied(ok).
 * 빨강(차단) 조건 = ocs_check='pending' 또는 미이행 건수(total-complied) > 0.
 *
 * DB 트리거 `abd_guard_df_actual_requires_ocs` 와 동일 규칙이며,
 * 클라이언트/서버는 사전 차단·안내 용도로만 사용한다(최종 관문은 DB).
 */
export interface OcsStateLike {
  ocs_check?: string | null;
  ocs_total?: number | null;
  ocs_complied?: number | null;
}

export function ocsPendingCount(row: OcsStateLike | null | undefined): number {
  const total = Number(row?.ocs_total ?? 0) || 0;
  const done = Number(row?.ocs_complied ?? 0) || 0;
  return Math.max(0, total - done);
}

export function isOcsPending(row: OcsStateLike | null | undefined): boolean {
  if (!row) return false;
  if (ocsPendingCount(row) > 0) return true;
  return String(row.ocs_check ?? "") === "pending";
}

export const DF_ACTUAL_FIELDS = [
  "r1_draft_finish_actual",
  "r2_draft_finish_actual",
  "r3_draft_finish_actual",
] as const;

export function isDfActualField(field: string): boolean {
  return (DF_ACTUAL_FIELDS as readonly string[]).includes(field);
}

/** `r2_draft_finish_actual` → 2 */
export function dfActualRound(field: string): 1 | 2 | 3 | null {
  const m = /^r([123])_draft_finish_actual$/.exec(field);
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

/**
 * 활성 라운드 판정 — DB 정본 `abd_judge_v1`(lines 77-85)과 동일 규칙의 클라이언트 미러.
 * 실적일이 하나라도 있거나 직전 라운드 회신 결과가 B/C 면 다음 라운드로 넘어간다.
 */
export function abdActiveRound(row: Record<string, any> | null | undefined): 1 | 2 | 3 {
  if (!row) return 1;
  const has = (n: number) =>
    !!(row[`r${n}_draft_start_actual`] || row[`r${n}_draft_finish_actual`] ||
       row[`r${n}_submission_actual`] || row[`r${n}_dar_actual`]);
  const rr = (n: number) => {
    const dar = row[`r${n}_dar_actual`];
    const v = dar ? String(row[`r${n}_response_result`] ?? "").toUpperCase() : "";
    return v === "B" || v === "C";
  };
  if (has(3) || rr(2)) return 3;
  if (has(2) || rr(1)) return 2;
  return 1;
}

/** 해당 DF 실적일 필드가 OCS 미완료로 차단되는가 (현재 라운드만 차단). */
export function isDfActualBlocked(row: Record<string, any> | null | undefined, field: string): boolean {
  const n = dfActualRound(field);
  if (n == null) return false;
  if (!isOcsPending(row as OcsStateLike)) return false;
  return abdActiveRound(row) === n;
}

export const OCS_DF_BLOCK_MESSAGE =
  "OCS 점검이 완료되지 않아 Draft Finish 실적일을 입력할 수 없습니다. OCS 코멘트를 모두 Complied 처리한 뒤 입력하세요.";

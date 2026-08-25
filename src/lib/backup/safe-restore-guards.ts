/**
 * 안전 복원 서버 관문 — 순수/최소 의존 함수 정본.
 *
 * - createServerFn 파일을 얇게 유지하기 위해 판정 로직만 분리한다.
 * - HP2/HP3 엔진 동작은 변경하지 않는다. 여기서는 "허용 여부"만 판정한다.
 */

/** 최종 확인 문자열 정본: `RESTORE <scope> <run_id 앞 8자리>` */
export function buildRestoreConfirmation(scope: string, runId: string): string {
  return `RESTORE ${scope} ${runId.slice(0, 8)}`;
}

/** System Administrator 단독 권한 검사. 실패 시 즉시 throw. */
export async function assertSystemAdmin(
  supabase: { rpc: (fn: any, args: any) => PromiseLike<{ data: any; error: { message: string } | null }> },
  userId: string,
) {
  const { data, error } = await supabase.rpc("is_system_admin", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("안전 복원은 System Administrator 계정만 수행할 수 있습니다.");
}

/** 반영(apply) 허용 여부 — 서버가 재조회한 run 행만 근거로 판정한다. */
export function assertApplyAllowed(
  run: Record<string, any>,
  input: { confirmation: string; expected_overall_digest: string },
) {
  if (run.status !== "staging_verified") {
    throw new Error(`RESTORE_APPLY_NOT_CLAIMABLE: status=${run.status}`);
  }
  const expected = buildRestoreConfirmation(String(run.requested_scope ?? ""), String(run.id));
  if (String(input.confirmation ?? "").trim() !== expected) {
    throw new Error("RESTORE_CONFIRMATION_MISMATCH");
  }
  if (!run.staging_overall_digest || run.staging_overall_digest !== input.expected_overall_digest) {
    throw new Error("RESTORE_STAGING_DIGEST_MISMATCH");
  }
  if (!run.safety_snapshot_id) throw new Error("RESTORE_SAFETY_SNAPSHOT_MISSING");
}

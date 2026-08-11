/**
 * run_id 멱등성 결정 로직 (순수 함수).
 *
 * `backup_claim_run` RPC 는 INSERT ... ON CONFLICT DO NOTHING 결과(claimed)와
 * 기존 행 상태를 함께 돌려준다. 여기서는 그 결과로 서버가 취할 행동만 결정한다.
 */
export type BackupClaim = {
  claimed?: boolean;
  status?: string | null;
  snapshot_id?: string | null;
  error_message?: string | null;
};

export type BackupClaimAction =
  | { kind: "run" }
  | { kind: "reuse"; snapshotId: string }
  | { kind: "join"; status: string }
  | { kind: "failed"; message: string };

export function resolveBackupClaim(claim: BackupClaim): BackupClaimAction {
  if (claim.claimed) return { kind: "run" };
  if (claim.status === "success" && claim.snapshot_id) {
    return { kind: "reuse", snapshotId: claim.snapshot_id };
  }
  if (claim.status === "failed") {
    return {
      kind: "failed",
      message: `이 run 은 이미 실패로 종료되었습니다. 새 Retry 는 새 run ID 로 시작하세요. (원문: ${claim.error_message ?? "-"})`,
    };
  }
  return { kind: "join", status: claim.status ?? "running" };
}

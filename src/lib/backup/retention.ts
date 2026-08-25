/**
 * 보관기간 정리 후보 계산 — 순수 함수 정본.
 * 미리보기(preview)와 실제 실행(cleanup)이 반드시 이 함수 하나를 공유한다.
 * 계산식 자체는 기존 cleanupOldSnapshots 로직과 동일하다(변경 금지).
 */
export type RetentionSnapshot = {
  id: string;
  name?: string | null;
  created_at: string;
  size_bytes?: number | null;
  is_locked?: boolean | null;
  triggered_by?: string | null;
};

/**
 * 9083c2bd 계약: 잠금해제된 pre-import Snapshot 은 생성 24시간 후 자동 정리한다.
 * - 관리자가 잠근 pre-import Snapshot 은 제외한다.
 * - 일반·정기 Snapshot 의 보관정책(planRetentionCleanup)은 변경하지 않는다.
 */
export const PRE_IMPORT_RETENTION_HOURS = 24;

export function planPreImportCleanup<T extends RetentionSnapshot>(
  snapshots: T[],
  opts?: { now?: number },
): { cutoff: string; candidates: T[]; locked_excluded_count: number } {
  const now = opts?.now ?? Date.now();
  const cutoff = new Date(now - PRE_IMPORT_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  const preImport = snapshots.filter((s) => s.triggered_by === "pre-import");
  return {
    cutoff,
    candidates: preImport.filter((s) => !s.is_locked && s.created_at < cutoff),
    locked_excluded_count: preImport.filter((s) => !!s.is_locked).length,
  };
}

export type RetentionPlan<T extends RetentionSnapshot> = {
  retention_days: number;
  keep_minimum_count: number;
  cutoff: string;
  candidates: T[];
  candidate_count: number;
  estimated_bytes: number;
  locked_excluded_count: number;
  remaining_unlocked_after: number;
};

export function planRetentionCleanup<T extends RetentionSnapshot>(
  snapshots: T[],
  opts: { retentionDays: number; keepMinimum: number; now?: number },
): RetentionPlan<T> {
  const retentionDays = opts.retentionDays;
  const keepMinimum = opts.keepMinimum;
  const now = opts.now ?? Date.now();
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const ordered = snapshots.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const candidatePool = ordered.filter((s) => !s.is_locked && s.created_at < cutoff);
  const lockedCount = ordered.filter((s) => !!s.is_locked).length;
  const unprotectedCount = ordered.length - lockedCount;

  const candidates: T[] = [];
  let remainingAfterDelete = unprotectedCount;
  for (const s of candidatePool) {
    if (remainingAfterDelete <= keepMinimum) break;
    candidates.push(s);
    remainingAfterDelete--;
  }

  return {
    retention_days: retentionDays,
    keep_minimum_count: keepMinimum,
    cutoff,
    candidates,
    candidate_count: candidates.length,
    estimated_bytes: candidates.reduce((sum, s) => sum + (s.size_bytes ?? 0), 0),
    locked_excluded_count: lockedCount,
    remaining_unlocked_after: remainingAfterDelete,
  };
}

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
};

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

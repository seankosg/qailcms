// 파생 계산 유틸리티 — DB에 저장하지 않고 클라이언트에서 계산되는 값들

export interface TaskThresholds {
  behind_warn_gap: number; // -0.05
  behind_late_gap: number; // -0.15
  slip_warn_days: number; // 3
  slip_late_days: number; // 14
}

export const DEFAULT_THRESHOLDS: TaskThresholds = {
  behind_warn_gap: -0.05,
  behind_late_gap: -0.15,
  slip_warn_days: 3,
  slip_late_days: 14,
};

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 오늘 기준 계획 진도율. 계획 기간이 없거나 0 이하이면 완료여부로 판단. */
export function expectedProgressToday(row: {
  plan_start?: string | null;
  plan_end?: string | null;
}): number {
  const start = parseDate(row.plan_start);
  const end = parseDate(row.plan_end);
  if (!start || !end) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const total = end.getTime() - start.getTime();
  if (total <= 0) return today >= end.getTime() ? 1 : 0;
  const elapsed = today - start.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}

export function todayGap(row: {
  actual_progress?: number | null;
  plan_start?: string | null;
  plan_end?: string | null;
}): number {
  const actual = Number(row.actual_progress ?? 0);
  const expected = expectedProgressToday(row);
  return actual - expected;
}

/** 임계값 기반 판정 (DB의 calc_auto_judgment_value 와 동일한 규칙) */
export function computeJudgment(
  row: {
    actual_progress?: number | null;
    plan_start?: string | null;
    plan_end?: string | null;
    slip_days?: number | null;
  },
  t: TaskThresholds = DEFAULT_THRESHOLDS,
): string {
  const actual = Number(row.actual_progress ?? 0);
  if (actual >= 1) return "완료";
  const gap = todayGap(row);
  const slip = Number(row.slip_days ?? 0);
  if (gap < t.behind_late_gap || slip > t.slip_late_days) return "위험";
  if (gap < t.behind_warn_gap || slip > t.slip_warn_days) return "지연";
  if (gap < 0) return "주의";
  return "정상";
}

export const JUDGMENT_ORDER: Record<string, number> = {
  위험: 0,
  지연: 1,
  주의: 2,
  정상: 3,
  완료: 4,
};

/** 판정 우선순위 비교 (worst 우선) */
export function worstJudgment(list: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestRank = Infinity;
  for (const j of list) {
    if (!j) continue;
    const r = JUDGMENT_ORDER[j] ?? 99;
    if (r < bestRank) {
      bestRank = r;
      best = j;
    }
  }
  return best;
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(Number(v))) return "";
  return `${(Number(v) * 100).toFixed(digits)}%`;
}
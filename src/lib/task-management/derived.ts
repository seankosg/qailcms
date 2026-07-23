// 파생 계산 유틸리티 — DB에 저장하지 않고 클라이언트에서 계산되는 값들
// 3-스테이지(Start/WIP/Finish) 판정 로직. T.Plan = Data Date 당일의 일할 계획진도율.

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

export type JudgmentStageKey = "start" | "wip" | "finish";

export interface JudgmentRow {
  plan_start?: string | null;
  plan_end?: string | null;
  plan_days?: number | null;
  actual_start?: string | null;
  actual_finish?: string | null;
  actual_progress?: number | null;
  plan_progress?: number | null;
  slip_days?: number | null;
  data_date?: string | null;
  auto_judgment?: string | null;
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayUtc(): Date {
  // Doha (Asia/Qatar, UTC+3) calendar day, expressed as a UTC-midnight Date
  // so subsequent arithmetic (daysDiff) works consistently.
  const now = new Date(Date.now() + 3 * 60 * 60_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function resolveAsOf(row: JudgmentRow, asOf?: string): Date {
  return parseDate(asOf) ?? parseDate(row.data_date ?? null) ?? todayUtc();
}

function daysDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** T.Plan — Data Date(또는 asOf) 당일의 계획 진도율 (0..1).
 *  기본식: (asOf - plan_start) / plan_days.
 *  plan_days 가 없으면 (plan_end - plan_start) 로 대체.
 *  계산 불가 시 null 반환.
 */
export function computeTPlan(row: JudgmentRow, asOf?: string): number | null {
  const start = parseDate(row.plan_start);
  if (!start) return null;
  const asOfD = resolveAsOf(row, asOf);
  let durationDays: number | null = null;
  const pd = row.plan_days == null ? null : Number(row.plan_days);
  if (pd != null && !Number.isNaN(pd) && pd > 0) {
    durationDays = pd;
  } else {
    const end = parseDate(row.plan_end);
    if (end) durationDays = Math.max(1, daysDiff(start, end));
  }
  if (!durationDays) return null;
  const elapsed = daysDiff(start, asOfD);
  return Math.max(0, Math.min(1, elapsed / durationDays));
}

/** asOf(또는 오늘) 기준 T.Plan. asOf 미지정 시 row.data_date → today 순으로 폴백. */
export function expectedProgressToday(row: JudgmentRow, asOf?: string): number {
  return computeTPlan(row, asOf) ?? 0;
}

/** asOf(또는 오늘) 기준 Actual% - T.Plan. */
export function todayGap(row: JudgmentRow, asOf?: string): number {
  const actual = Number(row.actual_progress ?? 0);
  return actual - expectedProgressToday(row, asOf);
}

/** 누계 계획진도율 (Cum. Plan) — plan_progress 우선, NULL 시 computeTPlan 폴백.
 *  computeVariance 와 동일한 분모. 대시보드/트리/리더보드 공통 사용. */
export function cumPlanProgress(row: JudgmentRow, asOf?: string): number {
  const rawPlan = row.plan_progress;
  if (rawPlan != null && !Number.isNaN(Number(rawPlan))) {
    return Math.max(0, Math.min(1, Number(rawPlan)));
  }
  return computeTPlan(row, asOf) ?? 0;
}

/** 누계 실적 (0..1 clamp). computeVariance 와 동일한 피감수. */
export function cumActualProgress(row: JudgmentRow): number {
  return Math.max(0, Math.min(1, Number(row.actual_progress ?? 0)));
}

/** Cum. Diff — 누계 실적(Actual %) − 누계 계획(Plan %, row.plan_progress).
 *  단일 소스: Variance(=Cum. Diff), Alarm(WIP), Behind Schedule, Critical Delay 모두 이 값 사용.
 *  plan_progress 가 NULL 이면 computeTPlan(시간경과율)으로 폴백. 둘 다 없으면 null 반환. */
export function computeVariance(row: JudgmentRow, asOf?: string): number | null {
  const actual = Math.max(0, Math.min(1, Number(row.actual_progress ?? 0)));
  const rawPlan = row.plan_progress;
  let plan: number | null;
  if (rawPlan != null && !Number.isNaN(Number(rawPlan))) {
    plan = Math.max(0, Math.min(1, Number(rawPlan)));
  } else {
    plan = computeTPlan(row, asOf);
  }
  if (plan == null) return null;
  return actual - plan;
}

/** T.Plan(일할 계획) — 하루치 계획 증분 = 1 / duration_days (달력일 기준).
 *  plan_days 우선, 없으면 plan_end - plan_start + 1. 계산 불가 시 null. */
export function computeDailyPlan(row: JudgmentRow): number | null {
  const pd = row.plan_days == null ? null : Number(row.plan_days);
  if (pd != null && !Number.isNaN(pd) && pd > 0) return 1 / pd;
  const s = parseDate(row.plan_start);
  const e = parseDate(row.plan_end);
  if (!s || !e) return null;
  const days = Math.max(1, daysDiff(s, e) + 1);
  return 1 / days;
}

/** T.Diff(일할) — T.Actual − T.Plan. T.Plan 계산 불가 시 null. */
export function computeDailyDiff(
  row: JudgmentRow,
  tActual: number | null | undefined,
): number | null {
  const dp = computeDailyPlan(row);
  if (dp == null) return null;
  const a = Number(tActual ?? 0) || 0;
  return a - dp;
}

export const JUDGMENT_ORDER: Record<string, number> = {
  위험: 0,
  지연: 1,
  주의: 2,
  정상: 3,
  완료: 4,
};

/** 판정 우선순위 비교 (worst 우선). */
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

/** 스테이지별 판정. */
export function getStageJudgment(
  row: JudgmentRow,
  stage: JudgmentStageKey,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): string {
  const asOfD = resolveAsOf(row, asOf);

  if (stage === "start") {
    if (
      row.actual_start ||
      Number(row.actual_progress ?? 0) >= 1 ||
      row.auto_judgment === "완료"
    )
      return "완료";
    const ps = parseDate(row.plan_start);
    if (!ps || ps.getTime() > asOfD.getTime()) return "정상";
    const d = daysDiff(ps, asOfD);
    if (d > t.slip_late_days) return "위험";
    if (d > t.slip_warn_days) return "지연";
    return "주의";
  }

  if (stage === "wip") {
    const actual = Number(row.actual_progress ?? 0);
    if (actual >= 1) return "완료";
    // WIP 판정도 Cum. Diff(=Variance) 단일 소스 사용.
    const gap = computeVariance(row, asOf);
    if (gap == null) return "정상";
    if (gap < t.behind_late_gap) return "위험";
    if (gap < t.behind_warn_gap) return "지연";
    if (gap < 0) return "주의";
    return "정상";
  }

  // finish
  if (Number(row.actual_progress ?? 0) >= 1 || row.auto_judgment === "완료")
    return "완료";
  const pe = parseDate(row.plan_end);
  if (!pe || pe.getTime() > asOfD.getTime()) return "정상";
  const slip = daysDiff(pe, asOfD);
  if (slip > t.slip_late_days) return "위험";
  if (slip > t.slip_warn_days) return "지연";
  if (slip > 0) return "주의";
  return "정상";
}

/** 3-스테이지 worstOf. 착수 완료 시 Start 스테이지는 후보에서 제외. */
export function computeJudgment(
  row: JudgmentRow,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): string {
  const jStart = getStageJudgment(row, "start", t, asOf);
  const jWip = getStageJudgment(row, "wip", t, asOf);
  const jFinish = getStageJudgment(row, "finish", t, asOf);
  if (jWip === "완료" && jFinish === "완료") return "완료";
  const candidates: string[] = [];
  if (!row.actual_start) candidates.push(jStart);
  candidates.push(jWip, jFinish);
  return worstJudgment(candidates) ?? "정상";
}

/** 행 단위 지연 판정 = 판정이 지연 또는 위험. */
export function isTaskDelayed(
  row: JudgmentRow,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): boolean {
  const j = computeJudgment(row, t, asOf);
  return j === "지연" || j === "위험";
}

/** Start 는 완료됐지만 계획보다 늦게 시작한 마커. */
export function isStartedLate(row: JudgmentRow): boolean {
  if (!row.actual_start || !row.plan_start) return false;
  return String(row.actual_start).slice(0, 10) > String(row.plan_start).slice(0, 10);
}

/** Finish 완료됐지만 계획보다 늦게 완료된 마커. */
export function isFinishedLate(row: JudgmentRow): boolean {
  if (!row.actual_finish || !row.plan_end) return false;
  return String(row.actual_finish).slice(0, 10) > String(row.plan_end).slice(0, 10);
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(Number(v))) return "";
  return `${(Number(v) * 100).toFixed(digits)}%`;
}
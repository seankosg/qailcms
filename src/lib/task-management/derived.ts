// 파생 계산 유틸리티 — DB에 저장하지 않고 클라이언트에서 계산되는 값들
// 3-스테이지(Start/WIP/Finish) 판정 로직. T.Plan = Data Date 당일의 일할 계획진도율.

export interface TaskThresholds {
  /** 0 ≤ gap < caution_gap_buffer 일 때 '주의' (기본 +0.05 = +5%p 여유) */
  caution_gap_buffer: number;
  /** gap < worsen_gap 일 때 '악화' (기본 -0.15 = -15%p) */
  worsen_gap: number;
}

/** 서버값(tm_thresholds RPC) 로딩 전 임시 표시용 폴백.
 *  판정 정본은 항상 서버 tm_thresholds() 이며, 이 리터럴은 판정 결과에 개입하지 않는다. */
export const DEFAULT_THRESHOLDS: TaskThresholds = {
  caution_gap_buffer: 0.05,
  worsen_gap: -0.15,
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
  /** DB 저장 파생 (tm_compute_derived 결과). asOf 미지정 시 신뢰. */
  cum_plan_pct?: number | null;
  cum_actual_pct?: number | null;
  gap_pct?: number | null;
  delay_days?: number | null;
  alarm_reason?: string | null;
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

/** As-of(판정 기준일) 해석 — 단일 규칙.
 *  선택값(asOf)이 정본이며, 없으면 오늘(Asia/Qatar).
 *  row.data_date(실적 관측 컷오프)는 판정 계산에 개입하지 않는다.
 *  Actual% 값 자체가 그 시점 관측치라는 형태로만 반영된다. */
function resolveAsOf(_row: JudgmentRow, asOf?: string): Date {
  return parseDate(asOf) ?? todayUtc();
}

function daysDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** T.Plan — Data Date(또는 asOf) 당일의 누계 계획 진도율 (0..1).
 *  DB 표준식과 일치: ((asOf - plan_start) + 1) / plan_days (달력일).
 *  계산 불가 시 null 반환. */
export function computeTPlan(row: JudgmentRow, asOf?: string): number | null {
  const start = parseDate(row.plan_start);
  if (!start) return null;
  const asOfD = resolveAsOf(row, asOf);
  let durationDays: number | null = null;
  // 정본: 자기 계획창(plan_end - plan_start + 1). plan_days 는 날짜 결손 시에만 폴백.
  // (Main 의 plan_days 는 하위 합산치라 자기 창 평가에 쓰면 계획%가 과소평가된다.)
  const endForDur = parseDate(row.plan_end);
  if (endForDur) {
    durationDays = Math.max(1, daysDiff(start, endForDur) + 1);
  } else {
    const pd = row.plan_days == null ? null : Number(row.plan_days);
    if (pd != null && !Number.isNaN(pd) && pd > 0) durationDays = pd;
  }
  if (!durationDays) return null;
  const end = parseDate(row.plan_end);
  if (asOfD.getTime() < start.getTime()) return 0;
  if (end && asOfD.getTime() >= end.getTime()) return 1;
  const elapsedInc = daysDiff(start, asOfD) + 1; // +1 = DB 공식과 일치
  return Math.max(0, Math.min(1, elapsedInc / durationDays));
}

/** 하위 가중치 w — 실적 롤업(update_task_summary)과 동일: max(plan_end-plan_start+1, 1). */
function subWeight(row: JudgmentRow): number {
  const s = parseDate(row.plan_start);
  const e = parseDate(row.plan_end);
  if (!s || !e) return 1;
  return Math.max(1, daysDiff(s, e) + 1);
}

/** 하위 보유 Main 의 누계 계획% = Σ wₖ·tplanₖ / Σ wₖ (실적과 동일 가중 체계).
 *  하위가 없거나 평가 불가하면 null. 서버 tm_main_tplan 과 동일 정의. */
export function computeWeightedTPlan(kids: JudgmentRow[], asOf?: string): number | null {
  if (!kids || kids.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const k of kids) {
    const w = subWeight(k);
    den += w;
    num += w * (computeTPlan(k, asOf) ?? 0);
  }
  if (den <= 0) return null;
  return Math.max(0, Math.min(1, num / den));
}

/** gap 주입형 판정 사다리 — 서버 tm_kpi_judgment_g 와 동일. */
export function judgeFromGap(
  row: JudgmentRow,
  gap: number | null,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): string {
  const actual = normActual(row.actual_progress);
  if (actual >= 1 || row.actual_finish) return "완료";
  // 서버 정본(tm_kpi_judgment_g)과 동일: 착수 여부는 실적%만으로 판단한다.
  const started = actual > 0;
  const ps = parseDate(row.plan_start);
  const asOfD = resolveAsOf(row, asOf);
  if (ps && ps.getTime() > asOfD.getTime() && !started) return "정상";
  if (gap == null) return "정상";
  if (gap < t.worsen_gap) return "악화";
  if (gap < 0) return "지연";
  if (gap < t.caution_gap_buffer) return "주의";
  return "정상";
}

/** 하위 보유 Main 의 누계 계획% (없으면 자기 창 tplan). */
export function mainCumPlanProgress(
  main: JudgmentRow,
  kids: JudgmentRow[],
  asOf?: string,
): number {
  const w = computeWeightedTPlan(kids, asOf);
  if (w != null) return w;
  return computeTPlan(main, asOf) ?? 0;
}

/** 하위 보유 Main 의 Cum.Diff (동일 가중 실적 − 동일 가중 계획). */
export function mainVariance(
  main: JudgmentRow,
  kids: JudgmentRow[],
  asOf?: string,
): number | null {
  const plan = kids.length > 0 ? computeWeightedTPlan(kids, asOf) : computeTPlan(main, asOf);
  if (plan == null) return null;
  return normActual(main.actual_progress) - plan;
}

/** actual_progress 를 [0,1] 로 정규화. DB 오염(30 저장 등)에도 안전. */
function normActual(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  const scaled = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

/** asOf(또는 오늘·Asia/Qatar) 기준 T.Plan. row.data_date 는 개입하지 않는다. */
export function expectedProgressToday(row: JudgmentRow, asOf?: string): number {
  return computeTPlan(row, asOf) ?? 0;
}

/** asOf(또는 오늘) 기준 Actual% - T.Plan. */
export function todayGap(row: JudgmentRow, asOf?: string): number {
  const actual = normActual(row.actual_progress);
  return actual - expectedProgressToday(row, asOf);
}

/** 누계 계획진도율 (Cum. Plan) — 정본은 "현재본 계획(plan_start/end/days)을 as-of 로 평가한 값".
 *  저장된 plan_progress 는 임포트 시점 스냅샷일 뿐이므로 표시·판정 소스로 쓰지 않는다.
 *  computeVariance 와 동일한 분모. 대시보드/트리/리더보드 공통 사용. */
export function cumPlanProgress(row: JudgmentRow, asOf?: string): number {
  return computeTPlan(row, asOf) ?? 0;
}

/** 누계 실적 (0..1 clamp). computeVariance 와 동일한 피감수. */
export function cumActualProgress(row: JudgmentRow): number {
  return normActual(row.actual_progress);
}

/** Cum. Diff — 누계 실적(Actual %) − 누계 계획(as-of 평가 Plan %).
 *  단일 소스: Variance(=Cum. Diff), Alarm(WIP), Behind Schedule, Critical Delay 모두 이 값 사용.
 *  계획 정보(plan_start + 기간)가 없어 평가 불가하면 null 반환. */
export function computeVariance(row: JudgmentRow, asOf?: string): number | null {
  const actual = normActual(row.actual_progress);
  const plan = computeTPlan(row, asOf);
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
  악화: 0,
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

/** Start 스테이지 세분 판정 (표시 전용). */
export type StartJudgment = "정상완료" | "지연완료" | "지연진행" | "정상";

export function getStartJudgment(row: JudgmentRow, asOf?: string): StartJudgment {
  const asOfD = resolveAsOf(row, asOf);
  const as = parseDate(row.actual_start);
  const ps = parseDate(row.plan_start);
  if (as) {
    if (ps && as.getTime() > ps.getTime()) return "지연완료";
    return "정상완료";
  }
  if (ps && ps.getTime() <= asOfD.getTime()) return "지연진행";
  return "정상";
}

/** 스테이지별 판정 (통합 판정에서 사용). Start/WIP/Finish 모두 gap 단일 소스 기반. */
export function getStageJudgment(
  row: JudgmentRow,
  stage: JudgmentStageKey,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): string {
  const actual = normActual(row.actual_progress);
  const started = actual > 0;
  // Start 스테이지 완료 판단만 실착수일도 인정한다(스테이지 정의상 실적일 기준).
  const startedForStage = !!row.actual_start || actual > 0;

  if (stage === "start") {
    if (startedForStage || row.auto_judgment === "완료") return "완료";
    const sj = getStartJudgment(row, asOf);
    return sj === "지연진행" ? "지연" : "정상";
  }

  // WIP / Finish 는 동일 gap 축으로 판정 (완료 조건만 다름)
  if (actual >= 1) return "완료";

  if (stage === "finish") {
    // 미완료 상태에서 plan_end 도래 전이면 정상 취급.
    const asOfD = resolveAsOf(row, asOf);
    const pe = parseDate(row.plan_end);
    if (pe && pe.getTime() > asOfD.getTime() && !started) return "정상";
  }

  const gap = computeVariance(row, asOf);
  if (gap == null) return "정상";
  if (gap < t.worsen_gap) return "악화";
  if (gap < 0) return "지연";
  if (gap < t.caution_gap_buffer) return "주의";
  return "정상";
}

/** 3-스테이지 worstOf. 착수 완료 시 Start 스테이지는 후보에서 제외. */
export function computeJudgment(
  row: JudgmentRow,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): string {
  // 저장 판정(auto_judgment)은 임포트 시점 스냅샷이므로 읽기 시 판정 소스로 쓰지 않는다.
  // 항상 as-of(미지정 시 오늘·Asia/Qatar) 기준으로 재계산한다.
  const actual = normActual(row.actual_progress);
  if (actual >= 1) return "완료";
  const started = actual > 0;
  if (!started) {
    // 미착수: 서버 정본 tm_kpi_judgment 와 동일 의미론.
    // 계획 착수일이 아직 도래하지 않았으면 '정상',
    // 도래했다면 gap 축(주의/지연/악화)으로 판정한다. (무조건 '지연' 고정 분기 폐지)
    const ps = parseDate(row.plan_start);
    const asOfD = resolveAsOf(row, asOf);
    if (!ps || ps.getTime() > asOfD.getTime()) return "정상";
    const gap = computeVariance(row, asOf);
    if (gap == null) return "정상";
    if (gap < t.worsen_gap) return "악화";
    if (gap < 0) return "지연";
    if (gap < t.caution_gap_buffer) return "주의";
    return "정상";
  }
  // 착수 이후: WIP/Finish 는 동일 gap 축이므로 WIP 결과가 곧 통합 판정.
  return getStageJudgment(row, "wip", t, asOf);
}

/** 행 단위 지연 판정 = 판정이 지연 또는 악화. */
export function isTaskDelayed(
  row: JudgmentRow,
  t: TaskThresholds = DEFAULT_THRESHOLDS,
  asOf?: string,
): boolean {
  const j = computeJudgment(row, t, asOf);
  return j === "지연" || j === "악화";
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
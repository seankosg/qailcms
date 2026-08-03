import {
  ALL_TASK_TIMELINE_STAGE_KEYS,
  addDays,
  daysBetween,
  getTaskStagePlannedDate,
  isTaskStageActualUpTo,
  isTaskStageDelayedAsOf,
  isTaskStagePlannedUpTo,
  weekStartIso,
  type TaskItem,
  type TaskScheduleStage,
} from "./schedule-utils";
import {
  cumPlanProgress,
  cumActualProgress,
  getStageJudgment,
  isTaskDelayed,
  computeVariance,
  computeJudgment,
  DEFAULT_THRESHOLDS,
  type TaskThresholds,
} from "./derived";
import { ALL_TASK_STAGE_KEYS } from "./schedule-utils";

export type OwnerDim = "team" | "hdec_pic_name" | "hdec_eng_name";

/**
 * 서버 정본(tm_rows_as_of) 병합 필드.
 * 존재하면 클라 재계산보다 우선한다 — 판정식 불변, 소스만 정본 교체.
 */
interface SrvFields {
  srv_judgment?: string | null;
  srv_plan_pct?: number | null;   // 0..1
  srv_actual_pct?: number | null; // 0..1
}

function srvOf(it: unknown): SrvFields {
  return (it ?? {}) as SrvFields;
}

/** 정본 판정(있으면) → 없으면 클라 판정. */
export function resolveJudgment(
  it: TaskItem,
  thresholds: TaskThresholds | undefined,
  asOfDate: string,
): string {
  const s = srvOf(it).srv_judgment;
  if (s != null && s !== "") return s;
  return computeJudgment(it, thresholds ?? DEFAULT_THRESHOLDS, asOfDate);
}

/** 정본 지연(지연|악화). */
export function resolveIsDelayed(
  it: TaskItem,
  thresholds: TaskThresholds | undefined,
  asOfDate: string,
): boolean {
  const j = resolveJudgment(it, thresholds, asOfDate);
  return j === "지연" || j === "악화";
}

/** 정본 계획%(있으면) → 없으면 클라 as-of 계산. */
export function resolvePlanPct(it: TaskItem, asOfDate: string): number {
  const v = srvOf(it).srv_plan_pct;
  return v == null ? cumPlanProgress(it, asOfDate) : Number(v);
}

function resolveActualPct(it: TaskItem): number {
  const v = srvOf(it).srv_actual_pct;
  return v == null ? cumActualProgress(it) : Number(v);
}

export interface DelayTopItem {
  id: string;
  taskNo: string;
  taskName: string;
  discipline: string;
  team: string;
  hdecPic: string;
  hdecEng: string;
  stage: TaskScheduleStage; // 대표(현재 진행/지연) 스테이지 — 표시용
  plannedDate: string;
  daysLate: number;         // 대표 스테이지의 지연일 — 참고 컬럼
  judgment: string | null;  // 태스크 단위 통합 판정 ('지연' | '악화')
  actualProgress: number;
  planPct: number;
  actualPct: number;
  diffPp: number;
  gap: number;              // 정렬 정본: computeVariance ×100 (pp). 음수일수록 나쁨.
}

/**
 * 지연 Top N — 태스크 단위(중복 등장 없음).
 * 모집단: 통합 판정 `computeJudgment` 결과가 '지연' 또는 '악화'인 태스크.
 * 정렬 정본: gap 오름차순(가장 나쁜 격차 순). 동률 시 delayDays 큰 순.
 * `daysLate` 는 참고 컬럼으로만 표시 — 정렬 키로 사용하지 않음.
 */
export function computeDelayTopN(
  items: TaskItem[],
  asOfDate: string,
  limit = 20,
  thresholds: TaskThresholds = DEFAULT_THRESHOLDS,
): DelayTopItem[] {
  const out: DelayTopItem[] = [];
  for (const it of items) {
    // 태스크 단위 통합 판정 정본 (서버 as-of 결과 우선)
    const taskJ = resolveJudgment(it, thresholds, asOfDate);
    if (taskJ !== "지연" && taskJ !== "악화") continue;

    const planPct = resolvePlanPct(it, asOfDate) * 100;
    const actualPct = resolveActualPct(it) * 100;
    const diffPp = actualPct - planPct;

    // 대표 스테이지: 지연/악화인 스테이지 중 daysLate 가 가장 큰 것.
    // 없으면(gap 축만 지연) start→wip→finish 중 미완료 첫 스테이지.
    let bestStage: TaskScheduleStage = "wip";
    let bestPlanned = "";
    let bestDays = -Infinity;
    for (const st of ALL_TASK_STAGE_KEYS) {
      const stageJ = getStageJudgment(it, st, thresholds, asOfDate);
      if (stageJ !== "지연" && stageJ !== "악화") continue;
      const planned =
        st === "wip"
          ? (it.plan_start ? it.plan_start.slice(0, 10) : asOfDate)
          : getTaskStagePlannedDate(it, st) ?? asOfDate;
      const d = daysBetween(planned, asOfDate);
      if (d > bestDays) {
        bestDays = d;
        bestStage = st;
        bestPlanned = planned;
      }
    }
    if (bestDays === -Infinity) {
      // gap 축 판정만 지연 — 대표는 finish(plan_end) 로 표시.
      bestStage = "finish";
      bestPlanned = getTaskStagePlannedDate(it, "finish") ?? (it.plan_end ? it.plan_end.slice(0, 10) : asOfDate);
      bestDays = Math.max(0, daysBetween(bestPlanned, asOfDate));
    }

    out.push({
      id: it.id,
      taskNo: it.task_no ?? "",
      taskName: it.task_name ?? "",
      discipline: it.discipline ?? "",
      team: it.team ?? "",
      hdecPic: it.hdec_pic_name ?? "",
      hdecEng: it.hdec_eng_name ?? "",
      stage: bestStage,
      plannedDate: bestPlanned,
      daysLate: bestDays,
      judgment: taskJ,
      actualProgress: Number(it.actual_progress ?? 0),
      planPct,
      actualPct,
      diffPp,
      gap: diffPp,
    });
  }
  // 정렬 정본: gap asc (가장 나쁜 격차 상단), 동률 시 daysLate desc.
  out.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap - b.gap;
    return b.daysLate - a.daysLate;
  });
  return out.slice(0, limit);
}

export interface OwnerLeaderboardRow {
  key: string;
  totalStages: number;
  doneStages: number;
  delayedStages: number;   // 하위 호환용 필드 — 값은 delayedTasks 와 동일하도록 채운다.
  delayedTasks: number;    // 정본: 통합 판정('지연'|'악화') 태스크 수
  plannedStages: number; // 계획상 asOf 시점까지 도달해야 할 스테이지 수
  planPct: number; // plannedStages / totalStages
  actualPct: number; // doneStages / totalStages
  diffPp: number; // (actualPct - planPct) * 100
  taskCount: number;
  delayedTaskIds: Set<string>;
}

export function computeOwnerLeaderboard(
  items: TaskItem[],
  asOfDate: string,
  dim: OwnerDim,
  thresholds: TaskThresholds = DEFAULT_THRESHOLDS,
): OwnerLeaderboardRow[] {
  const map = new Map<string, OwnerLeaderboardRow>();
  const NONE = "(미지정)";
  for (const it of items) {
    const raw = (it as any)[dim];
    const key = raw ? String(raw).trim() || NONE : NONE;
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        totalStages: 0,
        doneStages: 0,
        delayedStages: 0,
        delayedTasks: 0,
        plannedStages: 0,
        planPct: 0,
        actualPct: 0,
        diffPp: 0,
        taskCount: 0,
        delayedTaskIds: new Set<string>(),
      };
      map.set(key, row);
    }
    row.taskCount++;
    // 타임라인 스테이지(Start/Finish) 도달률 — 평균 진도 참고용 유지.
    for (const st of ALL_TASK_TIMELINE_STAGE_KEYS) {
      row.totalStages++;
      if (isTaskStagePlannedUpTo(it, st, asOfDate)) row.plannedStages++;
      if (isTaskStageActualUpTo(it, st, asOfDate)) row.doneStages++;
      // 스테이지 단위 지연 카운트 제거 — 정본은 태스크 단위(isTaskDelayed).
    }
    if (resolveIsDelayed(it, thresholds, asOfDate)) row.delayedTaskIds.add(it.id);
  }
  const rows = Array.from(map.values());
  // planPct/actualPct 는 T.Plan / Actual% 의 담당자 평균으로 계산 (스테이지 수 대비 아님).
  const memberSum = new Map<string, { plan: number; actual: number; n: number }>();
  for (const it of items) {
    const raw = (it as any)[dim];
    const key = raw ? String(raw).trim() || NONE : NONE;
    const cur = memberSum.get(key) ?? { plan: 0, actual: 0, n: 0 };
    cur.plan += resolvePlanPct(it, asOfDate);
    cur.actual += resolveActualPct(it);
    cur.n += 1;
    memberSum.set(key, cur);
  }
  for (const r of rows) {
    const m = memberSum.get(r.key);
    if (m && m.n > 0) {
      r.planPct = (m.plan / m.n) * 100;
      r.actualPct = (m.actual / m.n) * 100;
    }
    r.diffPp = r.actualPct - r.planPct;
    // 정본 지연 태스크 수 = delayedTaskIds.size. delayedStages 는 하위 호환용으로 동일 값 보관.
    r.delayedTasks = r.delayedTaskIds.size;
    r.delayedStages = r.delayedTaskIds.size;
  }
  rows.sort((a, b) => a.diffPp - b.diffPp); // 가장 뒤처진 담당자 상단
  return rows;
}

export interface WeeklyDelayPoint {
  weekStart: string;
  newDelays: number;
  recovered: number;
  net: number;
  openDelays: number;
}

/**
 * 주별 신규 지연 vs 회복 트렌드.
 * - 각 주말(주 시작+6일)을 asOf로 보고 스테이지별 지연 상태 스냅샷.
 * - 이전 주에는 지연이 아니었다가 이번 주에 지연 → newDelays.
 * - 이전 주에는 지연이었다가 이번 주에 완료 → recovered.
 * - 이번 주에 여전히 지연 상태 → openDelays.
 */
export function computeWeeklyDelayTrend(
  items: TaskItem[],
  today: string,
  weeks = 12,
): WeeklyDelayPoint[] {
  const thisWeek = weekStartIso(today);
  const points: WeeklyDelayPoint[] = [];
  const stateBefore = new Map<string, boolean>(); // key = id::stage, value: was delayed prev week
  const stateBeforeDone = new Map<string, boolean>();
  const startWeek = addDays(thisWeek, -7 * (weeks - 1));
  let cursor = startWeek;
  for (let w = 0; w < weeks; w++) {
    const asOf = addDays(cursor, 6);
    let newDelays = 0;
    let recovered = 0;
    let open = 0;
    for (const it of items) {
      const key = it.id;
      const delayed = isTaskDelayed(it, undefined, asOf);
      // R2-2: 완료 정본 = actual_finish 단독 + 주차 날짜 게이트.
      const done =
        (it as any).actual_finish != null &&
        String((it as any).actual_finish).slice(0, 10) <= asOf;
      const prevDelayed = stateBefore.get(key) ?? false;
      const prevDone = stateBeforeDone.get(key) ?? false;
      if (delayed && !prevDelayed) newDelays++;
      if (!prevDone && done && prevDelayed) recovered++;
      if (delayed) open++;
      stateBefore.set(key, delayed);
      stateBeforeDone.set(key, done);
    }
    points.push({
      weekStart: cursor,
      newDelays,
      recovered,
      net: newDelays - recovered,
      openDelays: open,
    });
    cursor = addDays(cursor, 7);
  }
  return points;
}

export interface JudgmentStageBreakdown {
  judgmentCounts: Record<string, number>;
  stageJudgment: Array<{
    stage: TaskScheduleStage;
    counts: Record<string, number>;
    total: number;
  }>;
}

const JUDGMENT_KEYS = ["완료", "정상", "주의", "지연", "악화"] as const;

export function computeJudgmentStageBreakdown(
  items: TaskItem[],
  asOfDate: string,
  thresholds?: TaskThresholds,
): JudgmentStageBreakdown {
  const judgmentCounts: Record<string, number> = {
    완료: 0,
    정상: 0,
    주의: 0,
    지연: 0,
    악화: 0,
  };
  for (const it of items) {
    // 정본 판정(srv_judgment) → 없으면 클라 판정. 저장된 auto_judgment 스냅샷 사용 금지.
    const j = String(resolveJudgment(it, thresholds, asOfDate) ?? "").trim();
    if (j in judgmentCounts) judgmentCounts[j]++;
  }
  const stageJudgment = ALL_TASK_STAGE_KEYS.map((stage) => {
    const counts: Record<string, number> = {
      완료: 0,
      정상: 0,
      주의: 0,
      지연: 0,
      악화: 0,
    };
    let total = 0;
    for (const it of items) {
      const j = getStageJudgment(it, stage, undefined, asOfDate);
      if (j in counts) counts[j]++;
      total++;
    }
    return { stage, counts, total };
  });
  return { judgmentCounts, stageJudgment };
}

export const JUDGMENT_KEY_ORDER = JUDGMENT_KEYS;